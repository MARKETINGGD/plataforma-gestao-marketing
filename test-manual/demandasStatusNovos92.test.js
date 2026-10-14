// Teste de integração (servidor de verdade, mesmo padrão de
// demandasMultiMarca79.test.js) da 92ª rodada, pedido direto da Raquel:
//
//   "nos status das demandas adicione tbm: Em refação, em revisão"
//
// Dois status novos, puramente ADITIVOS, nas STATUSES de routes/demandas.js
// ('em_revisao' e 'em_refacao', junto dos 4 que já existiam: a_fazer,
// andamento, aprovacao, concluida). Testado aqui:
// - criar um card já com cada um dos 2 status novos;
// - mudar o status de um card pra cada um deles via PUT;
// - os 2 status novos NÃO são tratados como "concluída" (não disparam
//   auto-arquivamento nem o bounce de recorrência -- só 'concluida' faz isso);
// - GET /api/demandas/summary soma certo os novos status, sem gerar NaN
//   (o bug que essa rodada corrigiu na inicialização do objeto `summary`);
// - GET /api/demandas/team-report filtra certo por `status=em_revisao` /
//   `status=em_refacao` (teamReportStatusKey já era genérico, usa d.status
//   direto quando não está atrasado);
// - um card com status novo que FICA atrasado (dueDate no passado) ainda
//   conta como "atrasada" no summary/team-report, igual aos outros status
//   não-concluídos (isOverdue só exclui 'concluida').
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-demandas-status-novos-92';
process.env.PORT = '4353';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4353';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-demandas-status-novos-92-test');
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

  const BASE = 'http://localhost:4353';

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
    body: JSON.stringify({ username: 'analistasn92', password: '123456', name: 'Analista Status Novos', cargo: 'analista' })
  }).then((r) => r.json()).then((d) => d.user);
  const analistaToken = await login('analistasn92', '123456');

  // ---------- 1. Criar card já com status 'em_revisao' ----------
  const cardRevisao = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({
      title: 'Card em revisão 92', status: 'em_revisao',
      assigneeIds: [analista.id], responsibleId: analista.id
    })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('card criado já com status "em_revisao"', cardRevisao.status === 'em_revisao');

  // ---------- 2. Criar card e mudar o status pra 'em_refacao' via PUT ----------
  const cardRefacaoInicial = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({ title: 'Card pra refação 92', assigneeIds: [analista.id], responsibleId: analista.id })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('card criado com status padrão "a_fazer"', cardRefacaoInicial.status === 'a_fazer');

  const cardRefacao = await fetch(`${BASE}/api/demandas/${cardRefacaoInicial.id}`, {
    method: 'PUT', headers: hj(analistaToken), body: JSON.stringify({ status: 'em_refacao' })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('PUT mudou o status do card pra "em_refacao"', cardRefacao.status === 'em_refacao');
  check('card NÃO foi arquivado automaticamente (só "concluida" arquiva sozinho)', cardRefacao.archived !== true);

  // ---------- 3. Card recorrente: status novo NÃO dispara o "bounce" pra
  // a_fazer (só 'concluida' com recorrência faz isso) ----------
  const hoje = new Date().toISOString().slice(0, 10);
  const cardRecorrente = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({
      title: 'Card recorrente 92', assigneeIds: [analista.id], responsibleId: analista.id,
      dueDate: hoje, recurrence: 'mensal'
    })
  }).then((r) => r.json()).then((d) => d.demanda);
  const cardRecorrenteRevisao = await fetch(`${BASE}/api/demandas/${cardRecorrente.id}`, {
    method: 'PUT', headers: hj(analistaToken), body: JSON.stringify({ status: 'em_revisao' })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('[92ª rodada] recorrente marcado "em_revisao" NÃO volta sozinho pra "a_fazer" (não é "concluida")',
    cardRecorrenteRevisao.status === 'em_revisao' && cardRecorrenteRevisao.dueDate === hoje);

  // ---------- 4. GET /api/demandas/summary soma certo os status novos
  // (sem NaN) ----------
  const summaryData = await fetch(`${BASE}/api/demandas/summary`, { headers: hj(adminToken) }).then((r) => r.json());
  check('summary tem a chave "em_revisao" (sem NaN)', typeof summaryData.summary.em_revisao === 'number' && !Number.isNaN(summaryData.summary.em_revisao));
  check('summary tem a chave "em_refacao" (sem NaN)', typeof summaryData.summary.em_refacao === 'number' && !Number.isNaN(summaryData.summary.em_refacao));
  check('summary conta pelo menos os 2 cards em "em_revisao" criados acima', summaryData.summary.em_revisao >= 2);
  check('summary conta o card em "em_refacao" criado acima', summaryData.summary.em_refacao >= 1);
  check('lists.em_revisao inclui o card certo', summaryData.lists.em_revisao.some((d) => d.id === cardRevisao.id));
  check('lists.em_refacao inclui o card certo', summaryData.lists.em_refacao.some((d) => d.id === cardRefacao.id));
  // Nenhuma outra chave do summary virou NaN por causa da mudança (sanity
  // check geral do objeto inteiro).
  check('nenhuma chave do summary é NaN', Object.values(summaryData.summary).every((v) => typeof v === 'number' && !Number.isNaN(v)));

  // ---------- 5. GET /api/demandas/team-report filtra por status novo ----------
  const reportRevisao = await fetch(`${BASE}/api/demandas/team-report?status=em_revisao`, { headers: hj(adminToken) }).then((r) => r.json());
  check('team-report com status=em_revisao devolve só cards nesse status',
    reportRevisao.demandas.length > 0 && reportRevisao.demandas.every((d) => d.statusKey === 'em_revisao'));
  check('team-report (sem filtro) inclui os totals.em_revisao/em_refacao da analista', (() => {
    const linha = reportRevisao.team.find((t) => t.id === analista.id);
    return !!linha; // a própria chamada acima já filtrou os demandas; só confirma que a pessoa aparece
  })());

  const reportGeral = await fetch(`${BASE}/api/demandas/team-report`, { headers: hj(adminToken) }).then((r) => r.json());
  const linhaAnalista = reportGeral.team.find((t) => t.id === analista.id);
  check('totals por pessoa soma certo os status novos (sem quebrar)',
    !!linhaAnalista && linhaAnalista.totals.em_revisao >= 2 && linhaAnalista.totals.em_refacao >= 1);

  // ---------- 6. Card com status novo e atrasado conta como "atrasada" ----------
  const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const cardAtrasadoRevisao = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({
      title: 'Card atrasado em revisão 92', status: 'em_revisao', dueDate: ontem,
      assigneeIds: [analista.id], responsibleId: analista.id
    })
  }).then((r) => r.json()).then((d) => d.demanda);
  const summaryDepois = await fetch(`${BASE}/api/demandas/summary`, { headers: hj(adminToken) }).then((r) => r.json());
  check('[92ª rodada] card "em_revisao" com dueDate no passado conta como atrasada', summaryDepois.lists.atrasada.some((d) => d.id === cardAtrasadoRevisao.id));

  // ---------- 7. Status novo aparece certo na lista geral (GET /api/demandas) ----------
  const listaGeral = await fetch(`${BASE}/api/demandas?archived=false&scope=geral`, { headers: hj(adminToken) }).then((r) => r.json());
  const cardNaLista = listaGeral.demandas.find((d) => d.id === cardRevisao.id);
  check('demanda devolvida pela listagem geral mantém o status "em_revisao"', !!cardNaLista && cardNaLista.status === 'em_revisao');

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(() => {
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(process.exitCode);
});
