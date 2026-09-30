// Teste de integração (servidor de verdade, mesmo padrão de
// publicarAgora.test.js) da 79ª rodada, pedido da Raquel:
//
//   "Em brindes- retiradas internas, a tabela deve deixar adicionar mais
//   de um item por retirada, por que tem retiradas que são pegos várias
//   itens." -- testado aqui: criar uma retirada com 2+ itens de uma vez,
//   confirmar que fica tudo num registro só, e que registros ANTIGOS (de
//   antes dessa rodada, sem `items`) continuam sendo lidos certinho
//   (migração "on read").
//
//   "Em expositores- coloque filtro tbm, modelo, data, fornecedor,
//   status. O status tbm deve ter a opção de ser editado." -- testado
//   aqui: fornecedor orçado agora aceita uma `data`, e o status
//   ("escolhido") pode ser marcado E desmarcado (antes só dava pra
//   marcar, nunca desfazer sem escolher outro fornecedor no lugar).
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-relatorios-filtros-79';
process.env.PORT = '4329';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4329';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-relatorios-filtros-79-test');
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

  const BASE = 'http://localhost:4329';
  const db = require('../db');

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  let token;
  if (statusRes.needsSetup) {
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin Teste', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    token = setupRes.token;
  } else {
    token = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456' })
    }).then((r) => r.json()).then((d) => d.token);
  }
  check('login/setup do admin devolveu token', !!token);
  function hj() { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }

  // ---------- 1. Retiradas Internas: múltiplos itens numa retirada só ----------
  const post1 = await fetch(`${BASE}/api/retiradas-internas`, {
    method: 'POST', headers: hj(),
    body: JSON.stringify({
      brand: 'ghelplus', date: '2026-09-30', withdrawnByName: 'Maria Teste', motivo: 'Uso interno',
      items: [
        { item: 'Caneta Metálica 79a', group: 'Canetas', quantidade: 3 },
        { item: 'Copo Térmico 79a', group: 'Copos', quantidade: 2 }
      ]
    })
  }).then((r) => r.json());
  check('retirada com 2 itens criada com sucesso', post1.item && Array.isArray(post1.item.items));
  check('os 2 itens vieram com nome e quantidade certos', post1.item && post1.item.items.length === 2
    && post1.item.items[0].item === 'Caneta Metálica 79a' && post1.item.items[0].quantidade === 3
    && post1.item.items[1].item === 'Copo Térmico 79a' && post1.item.items[1].quantidade === 2);
  check('cada item novo ganhou um catalogItemId (cadastrado no catálogo geral)', post1.item && post1.item.items.every((it) => !!it.catalogItemId));
  const catalogAfter = db.get('brindesCatalog').filter({ item: 'Caneta Metálica 79a' }).value();
  check('item novo realmente entrou no catálogo geral de Brindes', catalogAfter.length === 1);

  // Rejeita retirada sem nenhum item.
  const post2 = await fetch(`${BASE}/api/retiradas-internas`, {
    method: 'POST', headers: hj(),
    body: JSON.stringify({ brand: 'ghelplus', date: '2026-09-30', withdrawnByName: 'Sem Item', items: [] })
  });
  check('retirada sem nenhum item é recusada (erro claro)', post2.status !== 200);

  // Registro ANTIGO (de antes da 79ª rodada, sem `items`) -- gravado
  // direto no banco pra simular um registro que já existia -- confirma
  // que a leitura migra pra `items` sozinha, sem quebrar nada.
  const legacyId = 'legacy-retirada-79-test';
  db.get('retiradasInternas').push({
    id: legacyId, brand: 'ghelplus', date: '2026-01-10',
    catalogItemId: null, item: 'Item Antigo Sem Array', withdrawnBy: null,
    withdrawnByName: 'Registro Antigo', withdrawnByFreeText: true, quantidade: 5,
    motivo: 'Registro de antes da 79ª rodada', createdAt: '2026-01-10T00:00:00.000Z', createdBy: 'x', createdByName: 'x'
  }).write();
  const listGhelplus = await fetch(`${BASE}/api/retiradas-internas?brand=ghelplus`, { headers: hj() }).then((r) => r.json());
  const legacyRow = listGhelplus.items.find((r) => r.id === legacyId);
  check('registro antigo (sem items) foi encontrado na listagem', !!legacyRow);
  check('registro antigo migrou pra items:[...] sozinho na leitura', legacyRow && Array.isArray(legacyRow.items) && legacyRow.items.length === 1
    && legacyRow.items[0].item === 'Item Antigo Sem Array' && legacyRow.items[0].quantidade === 5);

  // ---------- 2. Expositores Orçamentos: fornecedor com data + status editável nos 2 sentidos ----------
  const orc = await fetch(`${BASE}/api/expositores/orcamentos`, {
    method: 'POST', headers: hj(), body: JSON.stringify({ brand: 'debacco', nome: 'Expositor Teste 79a', anoLancamento: 2027 })
  }).then((r) => r.json()).then((d) => d.item);
  check('expositor orçado criado', !!orc && !!orc.id);

  const fornAdd = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/fornecedores`, {
    method: 'POST', headers: hj(),
    body: JSON.stringify({ fornecedor: 'Fornecedor Teste 79a', data: '2026-09-15', valor: 1000, material: 'Madeira', prazoEntrega: '30 dias', pedidoMinimo: '10 un.' })
  }).then((r) => r.json());
  const fornId = fornAdd.item.fornecedores[0].id;
  check('fornecedor criado já com a data da cotação', fornAdd.item.fornecedores[0].data === '2026-09-15');
  check('fornecedor criado começa como não escolhido (pendente)', fornAdd.item.fornecedores[0].escolhido === false);

  const fornEscolhe = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/fornecedores/${fornId}`, {
    method: 'PUT', headers: hj(), body: JSON.stringify({ escolhido: true })
  }).then((r) => r.json());
  check('fornecedor marcado como escolhido', fornEscolhe.item.fornecedores.find((f) => f.id === fornId).escolhido === true);

  // 79ª rodada: "o status tbm deve ter a opção de ser editado" -- antes
  // não existia jeito de DESMARCAR (só escolher outro no lugar). Confirma
  // que agora dá pra voltar pro pendente direto.
  const fornDesmarca = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/fornecedores/${fornId}`, {
    method: 'PUT', headers: hj(), body: JSON.stringify({ escolhido: false })
  }).then((r) => r.json());
  check('fornecedor pode ser DESMARCADO de volta pro pendente (novidade da 79ª rodada)', fornDesmarca.item.fornecedores.find((f) => f.id === fornId).escolhido === false);

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
