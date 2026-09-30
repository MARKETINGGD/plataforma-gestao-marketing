// Teste de integração (servidor de verdade, mesmo padrão de
// demandasComentarios78.test.js) da 79ª rodada, pedido direto da Raquel:
//
//   "em demandas, deixa a opção de usar mais de uma marca no card, em vez
//   de ser so de bacco, ou spo Ghel, poder marcar mais de uma."
//
//   "e quando o card tiver mais de uma marca, o check list, deve ter a
//   opção de dizer de qual marca é o check"
//
// Testado aqui: criar/editar um card com 2+ marcas (`brands`, array);
// compatibilidade com dado ANTIGO (campo `brand`, string única, de antes
// desta rodada) migrando sozinho na leitura; filtro do relatório
// Acompanhamento Equipe (`brandFilter`) encontrando um card multi-marca;
// e o campo `brand` de cada item do checklist (criação e edição).
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-demandas-multimarca-79';
process.env.PORT = '4343';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4343';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-demandas-multimarca-79-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

async function run() {
  let failures = 0;
  function check(label, cond) {
    console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
    if (!cond) failures++;
  }

  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const BASE = 'http://localhost:4343';
  const db = require('../db');

  async function login(username, password) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then((r) => r.json());
    return res.token;
  }
  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  let adminToken;
  if (statusRes.needsSetup) {
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin Teste', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
  } else {
    adminToken = await login('admin', '123456');
  }
  check('login/setup do admin devolveu token', !!adminToken);
  const adminUser = await fetch(`${BASE}/api/auth/me`, { headers: hj(adminToken) }).then((r) => r.json()).then((d) => d.user);
  await fetch(`${BASE}/api/auth/users/${adminUser.id}`, { method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ cargo: 'coordenador' }) });

  const analista = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'analistamm79', password: '123456', name: 'Analista MultiMarca', cargo: 'analista' })
  }).then((r) => r.json()).then((d) => d.user);
  const analistaToken = await login('analistamm79', '123456');

  // ---------- 1. Criar card com 2 marcas ----------
  const created = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({
      title: 'Card 2 marcas 79', brands: ['debacco', 'ghelplus'],
      assigneeIds: [analista.id], responsibleId: analista.id
    })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('card criado com sucesso', !!(created && created.id));
  check('card veio com as 2 marcas em "brands"', Array.isArray(created.brands) && created.brands.length === 2
    && created.brands.includes('debacco') && created.brands.includes('ghelplus'));
  check('campo "brand" (compat) devolve a primeira marca', created.brand === 'debacco');

  // ---------- 2. Marca inválida é descartada, sem travar a criação ----------
  const createdComLixo = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({
      title: 'Card com marca invalida 79', brands: ['debacco', 'marca-que-nao-existe', 'debacco'],
      assigneeIds: [analista.id], responsibleId: analista.id
    })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('marca inválida descartada e repetida sem duplicar', Array.isArray(createdComLixo.brands) && createdComLixo.brands.length === 1 && createdComLixo.brands[0] === 'debacco');

  // ---------- 3. Compatibilidade com dado ANTIGO (campo `brand` string, sem `brands`) ----------
  const legacyId = 'legacy-demanda-79-test';
  db.get('demandas').push({
    id: legacyId, title: 'Card antigo (antes da 79a rodada)', status: 'a_fazer', visibility: 'geral',
    archived: false, assigneeIds: [analista.id], responsibleId: analista.id, labelIds: [],
    checklist: [], files: [], brand: 'ghelplus', createdAt: new Date().toISOString(),
    createdBy: analista.id, createdByName: analista.name
  }).write();
  const list = await fetch(`${BASE}/api/demandas`, { headers: hj(analistaToken) }).then((r) => r.json()).then((d) => d.demandas);
  const legacyRow = list.find((d) => d.id === legacyId);
  check('card antigo (sem brands) foi encontrado na listagem', !!legacyRow);
  check('card antigo migrou "brand" pra "brands":[...] sozinho na leitura', legacyRow && Array.isArray(legacyRow.brands) && legacyRow.brands.length === 1 && legacyRow.brands[0] === 'ghelplus');

  // ---------- 4. Editar pra tirar uma marca (PUT) ----------
  const edited = await fetch(`${BASE}/api/demandas/${created.id}`, {
    method: 'PUT', headers: hj(analistaToken), body: JSON.stringify({ brands: ['ghelplus'] })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('PUT trocou pra 1 marca só', Array.isArray(edited.brands) && edited.brands.length === 1 && edited.brands[0] === 'ghelplus');

  // Devolve pra 2 marcas pra testar o resto (checklist, filtro) com o caso multi-marca de verdade.
  const back2 = await fetch(`${BASE}/api/demandas/${created.id}`, {
    method: 'PUT', headers: hj(analistaToken), body: JSON.stringify({ brands: ['debacco', 'ghelplus'] })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('PUT devolveu pra 2 marcas', back2.brands.length === 2);

  // ---------- 5. Checklist: item pode dizer de qual marca é ----------
  const itemAdd = await fetch(`${BASE}/api/demandas/${created.id}/checklist`, {
    method: 'POST', headers: hj(analistaToken), body: JSON.stringify({ text: 'Arte De Bacco', brand: 'debacco' })
  }).then((r) => r.json()).then((d) => d.demanda);
  const item1 = itemAdd.checklist.find((it) => it.text === 'Arte De Bacco');
  check('item do checklist criado já com a marca certa', !!item1 && item1.brand === 'debacco');

  const itemAdd2 = await fetch(`${BASE}/api/demandas/${created.id}/checklist`, {
    method: 'POST', headers: hj(analistaToken), body: JSON.stringify({ text: 'Arte GhelPlus', brand: 'ghelplus' })
  }).then((r) => r.json()).then((d) => d.demanda);
  const item2 = itemAdd2.checklist.find((it) => it.text === 'Arte GhelPlus');
  check('2º item do checklist com a outra marca', !!item2 && item2.brand === 'ghelplus');

  const itemSemMarca = await fetch(`${BASE}/api/demandas/${created.id}/checklist`, {
    method: 'POST', headers: hj(analistaToken), body: JSON.stringify({ text: 'Sem marca especifica' })
  }).then((r) => r.json()).then((d) => d.demanda);
  const item3 = itemSemMarca.checklist.find((it) => it.text === 'Sem marca especifica');
  check('item do checklist sem marca fica null (nunca undefined/quebrado)', !!item3 && item3.brand === null);

  // Edita a marca de um item já existente.
  const itemEdit = await fetch(`${BASE}/api/demandas/${created.id}/checklist/${item1.id}`, {
    method: 'PUT', headers: hj(analistaToken), body: JSON.stringify({ brand: 'ghelplus' })
  }).then((r) => r.json()).then((d) => d.demanda);
  const item1After = itemEdit.checklist.find((it) => it.id === item1.id);
  check('marca do item já existente pode ser trocada', item1After && item1After.brand === 'ghelplus');

  // Limpa a marca de volta pra null.
  const itemClear = await fetch(`${BASE}/api/demandas/${created.id}/checklist/${item1.id}`, {
    method: 'PUT', headers: hj(analistaToken), body: JSON.stringify({ brand: null })
  }).then((r) => r.json()).then((d) => d.demanda);
  const item1Cleared = itemClear.checklist.find((it) => it.id === item1.id);
  check('marca do item pode ser limpa de volta (null)', item1Cleared && item1Cleared.brand === null);

  // ---------- 6. Card criado já com checklist (POST /, draft do front) aceita marca por item ----------
  const createdComChecklist = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({
      title: 'Card com checklist de marca na criacao 79', brands: ['duranox', 'boutiqueinox'],
      assigneeIds: [analista.id], responsibleId: analista.id,
      checklist: [{ text: 'Item Duranox', brand: 'duranox' }, { text: 'Item Boutique', brand: 'boutiqueinox' }]
    })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('checklist montado antes de salvar já vem com a marca de cada item', createdComChecklist.checklist.length === 2
    && createdComChecklist.checklist.find((it) => it.text === 'Item Duranox').brand === 'duranox'
    && createdComChecklist.checklist.find((it) => it.text === 'Item Boutique').brand === 'boutiqueinox');

  // ---------- 7. Filtro do Acompanhamento Equipe acha card multi-marca ----------
  const reportGhelplus = await fetch(`${BASE}/api/demandas/team-report?brand=ghelplus`, { headers: hj(adminToken) }).then((r) => r.json());
  const reportDebacco = await fetch(`${BASE}/api/demandas/team-report?brand=debacco`, { headers: hj(adminToken) }).then((r) => r.json());
  check('filtro "ghelplus" encontra o card marcado De Bacco+GhelPlus', reportGhelplus.demandas.some((d) => d.id === created.id));
  check('filtro "debacco" TAMBÉM encontra o mesmo card (as 2 marcas contam)', reportDebacco.demandas.some((d) => d.id === created.id));
  const cardNoReport = reportGhelplus.demandas.find((d) => d.id === created.id);
  check('card devolvido pelo relatório já vem com "brands" (array)', cardNoReport && Array.isArray(cardNoReport.brands) && cardNoReport.brands.length === 2);

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;

  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(process.exitCode);
}

run().catch((e) => {
  console.error(e);
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(1);
});
