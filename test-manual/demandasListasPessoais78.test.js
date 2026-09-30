// Teste de integração (servidor de verdade) da 78ª rodada -- pedidos da
// Raquel sobre a Área Pessoal de Demandas:
//
//   1. "Quem criou a demanda e marcou o outro colega, não precisa ter o
//      card duplicado e uma lista com o nome da pessoa marcada, o card
//      deve aparecer na lista pessoal de quem foi marcado e aparecer no
//      card de quem marcou, apenas isso." (pendência #28)
//   2. "Na área pessoal, deve ter a opção de criar listas e nomear elas...
//      isso deve valer apenas para a área pessoal." (pendência #29)
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-demandas-listas-pessoais-78';
process.env.PORT = '4341';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4341';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-demandas-listas-pessoais-78-test');
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

  const BASE = 'http://localhost:4341';

  async function login(username, password) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then((r) => r.json());
    return res.token;
  }

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

  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }
  function h(token) { return { Authorization: `Bearer ${token}` }; }
  async function createUser(username, name) {
    const res = await fetch(`${BASE}/api/auth/users`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ username, password: '123456', name, cargo: 'analista' })
    }).then((r) => r.json());
    return res.user;
  }
  const ana = await createUser('analp78', 'Ana LP78');
  const bia = await createUser('bialp78', 'Bia LP78');
  check('2 usuários de teste criados', !!(ana && bia));
  const anaToken = await login('analp78', '123456');
  const biaToken = await login('bialp78', '123456');

  // ---------- Listas: lista padrão automática ----------
  const anaListsInitial = await fetch(`${BASE}/api/demandas/personal-lists`, { headers: h(anaToken) }).then((r) => r.json());
  check('Ana começa com 1 lista padrão ("Minhas tarefas")', anaListsInitial.lists.length === 1 && anaListsInitial.lists[0].name === 'Minhas tarefas');
  const anaDefaultListId = anaListsInitial.lists[0].id;

  // Ana cria uma lista customizada.
  const novaLista = await fetch(`${BASE}/api/demandas/personal-lists`, {
    method: 'POST', headers: hj(anaToken), body: JSON.stringify({ name: 'Urgente' })
  }).then((r) => r.json());
  check('Ana consegue criar uma lista nomeada', novaLista.list && novaLista.list.name === 'Urgente');
  const anaUrgenteId = novaLista.list.id;

  const anaListsAfter = await fetch(`${BASE}/api/demandas/personal-lists`, { headers: h(anaToken) }).then((r) => r.json());
  check('Ana agora tem 2 listas', anaListsAfter.lists.length === 2);

  // Renomear.
  const renameRes = await fetch(`${BASE}/api/demandas/personal-lists/${anaUrgenteId}`, {
    method: 'PUT', headers: hj(anaToken), body: JSON.stringify({ name: 'Urgentíssimo' })
  });
  check('Ana consegue renomear a própria lista (200)', renameRes.status === 200);

  // Bia não pode renomear/apagar lista da Ana.
  const biaRenameAlheia = await fetch(`${BASE}/api/demandas/personal-lists/${anaUrgenteId}`, {
    method: 'PUT', headers: hj(biaToken), body: JSON.stringify({ name: 'Hackeado' })
  });
  check('Bia NÃO consegue renomear lista da Ana (404 -- não é dela)', biaRenameAlheia.status === 404);
  const biaDeleteAlheia = await fetch(`${BASE}/api/demandas/personal-lists/${anaUrgenteId}`, { method: 'DELETE', headers: h(biaToken) });
  check('Bia NÃO consegue apagar lista da Ana (404 -- não é dela)', biaDeleteAlheia.status === 404);

  // ---------- Card duplicado / lista com nome de outra pessoa (pendência #28) ----------
  const demanda = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(anaToken),
    body: JSON.stringify({
      title: 'Card pessoal compartilhado', visibility: 'pessoal',
      assigneeIds: [ana.id, bia.id], responsibleId: ana.id, personalListId: anaUrgenteId
    })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('demanda pessoal compartilhada criada', !!demanda.id);
  check('vem na lista "Urgentíssimo" escolhida pela Ana (quem criou)', demanda.personalListId === anaUrgenteId);

  const anaBoard = await fetch(`${BASE}/api/demandas?scope=pessoal&archived=false`, { headers: h(anaToken) }).then((r) => r.json()).then((d) => d.demandas);
  const anaCopies = anaBoard.filter((d) => d.id === demanda.id);
  check('no quadro da Ana, o card aparece EXATAMENTE 1 vez (não duplicado)', anaCopies.length === 1);

  const biaBoard = await fetch(`${BASE}/api/demandas?scope=pessoal&archived=false`, { headers: h(biaToken) }).then((r) => r.json()).then((d) => d.demandas);
  const biaCopies = biaBoard.filter((d) => d.id === demanda.id);
  check('no quadro da Bia (marcada, não criou), o card também aparece exatamente 1 vez', biaCopies.length === 1);
  const biaListsInitial = await fetch(`${BASE}/api/demandas/personal-lists`, { headers: h(biaToken) }).then((r) => r.json());
  check('a Bia continua só com a própria lista padrão (nenhuma lista nova criada com o nome dela nem da Ana)', biaListsInitial.lists.length === 1);
  check('pra Bia, o card cai na lista padrão DELA (nunca na "Urgentíssimo" da Ana)', biaCopies[0].personalListId === biaListsInitial.lists[0].id);
  check('a lista da Bia é uma lista DIFERENTE da lista da Ana (privacidade -- nunca a mesma linha)', biaCopies[0].personalListId !== anaCopies[0].personalListId);

  // Bia organiza o card na PRÓPRIA lista nova, sem afetar a Ana.
  const biaLista2 = await fetch(`${BASE}/api/demandas/personal-lists`, {
    method: 'POST', headers: hj(biaToken), body: JSON.stringify({ name: 'Pra hoje' })
  }).then((r) => r.json()).then((d) => d.list);
  await fetch(`${BASE}/api/demandas/${demanda.id}/personal-list`, {
    method: 'PUT', headers: hj(biaToken), body: JSON.stringify({ listId: biaLista2.id })
  });
  const anaBoardAfter = await fetch(`${BASE}/api/demandas?scope=pessoal&archived=false`, { headers: h(anaToken) }).then((r) => r.json()).then((d) => d.demandas);
  const anaCardAfter = anaBoardAfter.find((d) => d.id === demanda.id);
  check('Ana continua vendo o card na PRÓPRIA lista (Urgentíssimo), sem mudar quando a Bia reorganiza a dela', anaCardAfter.personalListId === anaUrgenteId);
  const biaBoardAfter = await fetch(`${BASE}/api/demandas?scope=pessoal&archived=false`, { headers: h(biaToken) }).then((r) => r.json()).then((d) => d.demandas);
  const biaCardAfter = biaBoardAfter.find((d) => d.id === demanda.id);
  check('a Bia agora vê o card na lista nova dela ("Pra hoje")', biaCardAfter.personalListId === biaLista2.id);

  // Bia não pode mover o card pra uma lista que não é dela (ex.: tentar
  // "roubar" a lista da Ana).
  const biaMovePraListaAlheia = await fetch(`${BASE}/api/demandas/${demanda.id}/personal-list`, {
    method: 'PUT', headers: hj(biaToken), body: JSON.stringify({ listId: anaUrgenteId })
  });
  check('Bia não consegue mover o card pra uma lista que não é dela (400)', biaMovePraListaAlheia.status === 400);

  // ---------- Excluir lista: cards voltam pra padrão, última lista protegida ----------
  await fetch(`${BASE}/api/demandas/personal-lists/${anaUrgenteId}`, { method: 'DELETE', headers: h(anaToken) });
  const anaBoardAfterDelete = await fetch(`${BASE}/api/demandas?scope=pessoal&archived=false`, { headers: h(anaToken) }).then((r) => r.json()).then((d) => d.demandas);
  const anaCardAfterDelete = anaBoardAfterDelete.find((d) => d.id === demanda.id);
  check('depois de apagar a lista "Urgentíssimo", o card da Ana volta pra lista padrão dela', anaCardAfterDelete.personalListId === anaDefaultListId);

  const deleteLastList = await fetch(`${BASE}/api/demandas/personal-lists/${anaDefaultListId}`, { method: 'DELETE', headers: h(anaToken) });
  check('não deixa apagar a ÚLTIMA lista que resta (400)', deleteLastList.status === 400);

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;

  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(process.exitCode);
}

run().catch((e) => {
  console.error(e);
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  process.exit(1);
});
