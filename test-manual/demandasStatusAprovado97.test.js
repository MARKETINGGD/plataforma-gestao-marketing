// Teste de integração (servidor de verdade, mesmo padrão de
// demandasStatusNovos92.test.js) da 97ª rodada, pedido direto da Raquel:
//
//   "em demandas, no status - adicione a Aprovado"
//
// 1 status novo, puramente ADITIVO, nas STATUSES de routes/demandas.js
// ('aprovado', junto dos 6 que já existiam: a_fazer, andamento, em_revisao,
// em_refacao, aprovacao, concluida). "aprovado" é distinto de "aprovacao"
// ("Em Aprovação" = mandado pra aprovar, esperando resposta) -- "aprovado"
// é o card que JÁ foi aprovado e só falta ser finalizado. Testado aqui:
// - criar um card já com status 'aprovado';
// - mudar o status de um card pra 'aprovado' via PUT;
// - 'aprovado' NÃO é tratado como "concluída" (não dispara auto-arquivamento
//   nem o bounce de recorrência -- só 'concluida' faz isso);
// - GET /api/demandas/summary soma certo o status novo, sem gerar NaN;
// - GET /api/demandas/team-report filtra certo por `status=aprovado`;
// - um card 'aprovado' que FICA atrasado (dueDate no passado) ainda conta
//   como "atrasada" no summary/team-report, igual aos outros status
//   não-concluídos.
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-demandas-status-aprovado-97';
process.env.PORT = '4358';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4358';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-demandas-status-aprovado-97-test');
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

  const BASE = 'http://localhost:4358';

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
    body: JSON.stringify({ username: 'analistasa97', password: '123456', name: 'Analista Status Aprovado', cargo: 'analista' })
  }).then((r) => r.json()).then((d) => d.user);
  const analistaToken = await login('analistasa97', '123456');

  // ---------- 1. Criar card já com status 'aprovado' ----------
  const cardAprovado = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({
      title: 'Card aprovado 97', status: 'aprovado',
      assigneeIds: [analista.id], responsibleId: analista.id
    })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('card criado já com status "aprovado"', cardAprovado.status === 'aprovado');

  // ---------- 2. Criar card e mudar o status pra 'aprovado' via PUT ----------
  const cardInicial = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({ title: 'Card pra aprovar 97', assigneeIds: [analista.id], responsibleId: analista.id })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('card criado com status padrão "a_fazer"', cardInicial.status === 'a_fazer');

  const cardMudado = await fetch(`${BASE}/api/demandas/${cardInicial.id}`, {
    method: 'PUT', headers: hj(analistaToken), body: JSON.stringify({ status: 'aprovado' })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('PUT mudou o status do card pra "aprovado"', cardMudado.status === 'aprovado');
  check('card NÃO foi arquivado automaticamente (só "concluida" arquiva sozinho)', cardMudado.archived !== true);

  // ---------- 3. Card recorrente: status "aprovado" NÃO dispara o "bounce"
  // pra a_fazer (só 'concluida' com recorrência faz isso) ----------
  const hoje = new Date().toISOString().slice(0, 10);
  const cardRecorrente = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({
      title: 'Card recorrente 97', assigneeIds: [analista.id], responsibleId: analista.id,
      dueDate: hoje, recurrence: 'mensal'
    })
  }).then((r) => r.json()).then((d) => d.demanda);
  const cardRecorrenteAprovado = await fetch(`${BASE}/api/demandas/${cardRecorrente.id}`, {
    method: 'PUT', headers: hj(analistaToken), body: JSON.stringify({ status: 'aprovado' })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('[97ª rodada] recorrente marcado "aprovado" NÃO volta sozinho pra "a_fazer" (não é "concluida")',
    cardRecorrenteAprovado.status === 'aprovado' && cardRecorrenteAprovado.dueDate === hoje);

  // ---------- 4. GET /api/demandas/summary soma certo o status novo
  // (sem NaN) ----------
  const summaryData = await fetch(`${BASE}/api/demandas/summary`, { headers: hj(adminToken) }).then((r) => r.json());
  check('summary tem a chave "aprovado" (sem NaN)', typeof summaryData.summary.aprovado === 'number' && !Number.isNaN(summaryData.summary.aprovado));
  check('summary conta pelo menos os 2 cards em "aprovado" criados acima', summaryData.summary.aprovado >= 2);
  check('lists.aprovado inclui o card certo', summaryData.lists.aprovado.some((d) => d.id === cardAprovado.id));
  // Nenhuma outra chave do summary virou NaN por causa da mudança (sanity
  // check geral do objeto inteiro).
  check('nenhuma chave do summary é NaN', Object.values(summaryData.summary).every((v) => typeof v === 'number' && !Number.isNaN(v)));

  // ---------- 5. GET /api/demandas/team-report filtra por status "aprovado" ----------
  const reportAprovado = await fetch(`${BASE}/api/demandas/team-report?status=aprovado`, { headers: hj(adminToken) }).then((r) => r.json());
  check('team-report com status=aprovado devolve só cards nesse status',
    reportAprovado.demandas.length > 0 && reportAprovado.demandas.every((d) => d.statusKey === 'aprovado'));

  const reportGeral = await fetch(`${BASE}/api/demandas/team-report`, { headers: hj(adminToken) }).then((r) => r.json());
  const linhaAnalista = reportGeral.team.find((t) => t.id === analista.id);
  check('totals por pessoa soma certo o status novo (sem quebrar)', !!linhaAnalista && linhaAnalista.totals.aprovado >= 2);

  // ---------- 6. Card "aprovado" e atrasado conta como "atrasada" ----------
  const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const cardAtrasadoAprovado = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({
      title: 'Card atrasado aprovado 97', status: 'aprovado', dueDate: ontem,
      assigneeIds: [analista.id], responsibleId: analista.id
    })
  }).then((r) => r.json()).then((d) => d.demanda);
  const summaryDepois = await fetch(`${BASE}/api/demandas/summary`, { headers: hj(adminToken) }).then((r) => r.json());
  check('[97ª rodada] card "aprovado" com dueDate no passado conta como atrasada', summaryDepois.lists.atrasada.some((d) => d.id === cardAtrasadoAprovado.id));

  // ---------- 7. Status novo aparece certo na lista geral (GET /api/demandas) ----------
  const listaGeral = await fetch(`${BASE}/api/demandas?archived=false&scope=geral`, { headers: hj(adminToken) }).then((r) => r.json());
  const cardNaLista = listaGeral.demandas.find((d) => d.id === cardAprovado.id);
  check('demanda devolvida pela listagem geral mantém o status "aprovado"', !!cardNaLista && cardNaLista.status === 'aprovado');

  // ---------- 8. Os status antigos continuam intactos (aditivo de verdade) ----------
  const cardEmAprovacao = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({ title: 'Card em aprovação 97 (continua existindo)', status: 'aprovacao', assigneeIds: [analista.id], responsibleId: analista.id })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('status antigo "aprovacao" (Em Aprovação) continua funcionando normalmente, distinto de "aprovado"',
    cardEmAprovacao.status === 'aprovacao' && cardEmAprovacao.status !== 'aprovado');

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
