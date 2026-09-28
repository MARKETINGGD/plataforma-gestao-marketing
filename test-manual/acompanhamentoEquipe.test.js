// Teste de integração (servidor de verdade, mesmo padrão dos demais
// test-manual/*.test.js) da 77ª rodada -- "Acompanhamento Equipe", pedido
// literal da Raquel:
//
//   "sabe as ações que o pessoal faz e finaliza, arquiva e tals dentro de
//   demandas? quero poder pegar relatórios de cada pessoa da equipe,
//   somente eu (coordenadora) e a gerente teremos acesso, queremos saber
//   o que foi feito, a data de inicio, data de entrega e quantas pessoas
//   estavam envolvidas. Se teve link ou doc, quero ter acesso tbm."
//
// Confirmado depois: "data de início" = data de CRIAÇÃO da demanda; quer
// ver TODO status (já feito, em andamento, em atraso); ela mesma acumula
// os dois papéis (coordenadora E admin da Plataforma); quer poder filtrar.
//
// Cobre: GET /api/demandas/team-report --
//   1. 403 pra quem não é super_admin/gerente/coordenador.
//   2. 200 pra gerente, coordenador e super_admin.
//   3. Gerente/coordenador ficam de fora da lista `team` (são quem
//      acompanha, não quem é acompanhado -- mesma exclusão do REIS DO
//      MARKETING).
//   4. Resumo por pessoa: contagem certa por status, incluindo "atrasada"
//      (dueDate no passado, status ainda não concluído).
//   5. Filtro por marca e por período (createdAt) -- período usa
//      DATA DE CRIAÇÃO, não data de entrega.
//   6. Filtro por pessoa (userId) na lista detalhada.
//   7. Filtro por status (incluindo "atrasada" como status sintético) na
//      lista detalhada.
//   8. Sem filtro de pessoa: lista detalhada só mostra demandas que
//      envolvem alguém DA EQUIPE (exclui demanda pessoal só da
//      coordenadora/gerente).
//   9. `assigneeCount`, `link` e `files` aparecem na resposta.
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-acompanhamento-equipe';
process.env.PORT = '4334';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4334';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-acompanhamento-equipe-test');
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

  const BASE = 'http://localhost:4334';
  const db = require('../db');

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

  function h(token) { return { Authorization: `Bearer ${token}` }; }
  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }

  async function createUser(username, name, cargo) {
    const res = await fetch(`${BASE}/api/auth/users`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ username, password: '123456', name, cargo })
    }).then((r) => r.json());
    return res.user;
  }
  const gerente = await createUser('gerenteae', 'Gerente AE', 'gerente');
  const coord = await createUser('coordae', 'Coordenadora AE', 'coordenador');
  const ana1 = await createUser('ana1ae', 'Analista Um AE', 'analista');
  const ana2 = await createUser('ana2ae', 'Analista Dois AE', 'analista');
  check('4 usuários de teste criados (gerente/coordenador/2 analistas)', !!(gerente && coord && ana1 && ana2));

  const gerenteToken = await login('gerenteae', '123456');
  const coordToken = await login('coordae', '123456');
  const ana1Token = await login('ana1ae', '123456');

  async function createDemanda(token, body) {
    const res = await fetch(`${BASE}/api/demandas`, {
      method: 'POST', headers: hj(token), body: JSON.stringify(body)
    }).then((r) => r.json());
    return res.demanda;
  }

  // ---------- 403 pra quem não tem permissão ----------
  const forbiddenRes = await fetch(`${BASE}/api/demandas/team-report`, { headers: h(ana1Token) });
  check('analista recebe 403 ao tentar acessar o relatório', forbiddenRes.status === 403);

  // ---------- Cenário de dados ----------
  // d1: ana1, concluída, marca debacco, criada "no período".
  const d1 = await createDemanda(adminToken, {
    title: 'AE Concluída Debacco', assigneeIds: [ana1.id], status: 'concluida',
    brand: 'debacco', dueDate: '2026-09-10', link: 'https://example.com/doc1'
  });
  // d2: ana1 + ana2, em andamento, marca ghelplus, sem link.
  const d2 = await createDemanda(adminToken, {
    title: 'AE Andamento Ghelplus', assigneeIds: [ana1.id, ana2.id], status: 'andamento',
    brand: 'ghelplus', dueDate: '2026-12-31'
  });
  // d3: ana2, "atrasada" -- status ainda não concluído, dueDate no passado.
  const d3 = await createDemanda(adminToken, {
    title: 'AE Atrasada Debacco', assigneeIds: [ana2.id], status: 'a_fazer',
    brand: 'debacco', dueDate: '2020-01-01'
  });
  // d4: só coordenadora (fora da "equipe") -- não deve aparecer na lista
  // detalhada quando nenhuma pessoa está selecionada no filtro.
  const d4 = await createDemanda(coordToken, {
    title: 'AE Pessoal Coordenadora', assigneeIds: [coord.id], status: 'a_fazer'
  });
  check('4 demandas de teste criadas', !!(d1 && d2 && d3 && d4));

  // Ajusta createdAt direto no banco pra testar filtro de período (a rota
  // de criação sempre grava "agora", não dá pra escolher pelo POST).
  db.get('demandas').find({ id: d1.id }).assign({ createdAt: '2026-01-15T10:00:00.000Z' }).write();
  db.get('demandas').find({ id: d2.id }).assign({ createdAt: '2026-06-01T10:00:00.000Z' }).write();
  db.get('demandas').find({ id: d3.id }).assign({ createdAt: '2026-06-15T10:00:00.000Z' }).write();

  // ---------- 200 pra gerente/coordenador/admin ----------
  const asGerente = await fetch(`${BASE}/api/demandas/team-report`, { headers: h(gerenteToken) }).then((r) => r.json());
  const asCoord = await fetch(`${BASE}/api/demandas/team-report`, { headers: h(coordToken) }).then((r) => r.json());
  const asAdmin = await fetch(`${BASE}/api/demandas/team-report`, { headers: h(adminToken) }).then((r) => r.json());
  check('gerente consegue acessar (200 + payload)', Array.isArray(asGerente.team) && Array.isArray(asGerente.demandas));
  check('coordenador consegue acessar', Array.isArray(asCoord.team));
  check('super_admin (Admin Teste) consegue acessar', Array.isArray(asAdmin.team));

  // ---------- gerente/coordenador fora da lista `team` ----------
  const teamIds = asAdmin.team.map((u) => u.id);
  check('gerente NÃO aparece na lista de pessoas acompanhadas', !teamIds.includes(gerente.id));
  check('coordenador NÃO aparece na lista de pessoas acompanhadas', !teamIds.includes(coord.id));
  check('ana1 aparece na lista de pessoas acompanhadas', teamIds.includes(ana1.id));
  check('ana2 aparece na lista de pessoas acompanhadas', teamIds.includes(ana2.id));

  // ---------- resumo por pessoa (sem filtro) ----------
  const ana1Summary = asAdmin.team.find((u) => u.id === ana1.id);
  const ana2Summary = asAdmin.team.find((u) => u.id === ana2.id);
  check('ana1: total 2 (d1 concluída + d2 andamento)', ana1Summary && ana1Summary.totals.total === 2);
  check('ana1: 1 concluída', ana1Summary && ana1Summary.totals.concluida === 1);
  check('ana1: 1 em andamento', ana1Summary && ana1Summary.totals.andamento === 1);
  check('ana2: total 2 (d2 andamento + d3 atrasada)', ana2Summary && ana2Summary.totals.total === 2);
  check('ana2: 1 atrasada (dueDate no passado, status a_fazer)', ana2Summary && ana2Summary.totals.atrasada === 1);
  check('ana2: 0 a_fazer (a atrasada "rouba" a contagem de a_fazer, mesma regra do isOverdue)', ana2Summary && ana2Summary.totals.a_fazer === 0);

  // ---------- lista detalhada sem filtro de pessoa: exclui demanda 100% da gerência ----------
  const detailIds = asAdmin.demandas.map((d) => d.id);
  check('sem filtro de pessoa, lista detalhada NÃO inclui a demanda só da coordenadora', !detailIds.includes(d4.id));
  check('sem filtro de pessoa, lista detalhada inclui d1/d2/d3', detailIds.includes(d1.id) && detailIds.includes(d2.id) && detailIds.includes(d3.id));

  // ---------- assigneeCount / link / files na resposta ----------
  const d2InReport = asAdmin.demandas.find((d) => d.id === d2.id);
  check('assigneeCount de d2 é 2 (ana1 + ana2)', d2InReport && d2InReport.assigneeCount === 2);
  const d1InReport = asAdmin.demandas.find((d) => d.id === d1.id);
  check('link de d1 vem na resposta', d1InReport && d1InReport.link === 'https://example.com/doc1');
  check('files vem como array (vazio, sem upload neste teste)', d1InReport && Array.isArray(d1InReport.files));
  check('statusKey de d1 é "concluida"', d1InReport && d1InReport.statusKey === 'concluida');
  const d3InReport = asAdmin.demandas.find((d) => d.id === d3.id);
  check('statusKey de d3 é "atrasada" (não "a_fazer")', d3InReport && d3InReport.statusKey === 'atrasada');

  // ---------- filtro por marca ----------
  const filterBrand = await fetch(`${BASE}/api/demandas/team-report?brand=ghelplus`, { headers: h(adminToken) }).then((r) => r.json());
  const filterBrandIds = filterBrand.demandas.map((d) => d.id);
  check('filtro por marca (ghelplus) só traz d2', filterBrandIds.includes(d2.id) && !filterBrandIds.includes(d1.id) && !filterBrandIds.includes(d3.id));

  // ---------- filtro por período (createdAt) ----------
  const filterPeriodo = await fetch(`${BASE}/api/demandas/team-report?from=2026-06-01&to=2026-06-30`, { headers: h(adminToken) }).then((r) => r.json());
  const filterPeriodoIds = filterPeriodo.demandas.map((d) => d.id);
  check('filtro de período (junho/2026) traz d2 e d3, não traz d1 (criada em janeiro)', filterPeriodoIds.includes(d2.id) && filterPeriodoIds.includes(d3.id) && !filterPeriodoIds.includes(d1.id));

  // ---------- filtro por pessoa ----------
  const filterPessoa = await fetch(`${BASE}/api/demandas/team-report?userId=${ana2.id}`, { headers: h(adminToken) }).then((r) => r.json());
  const filterPessoaIds = filterPessoa.demandas.map((d) => d.id);
  check('filtro por pessoa (ana2) traz só d2 e d3', filterPessoaIds.length === 2 && filterPessoaIds.includes(d2.id) && filterPessoaIds.includes(d3.id));

  // ---------- filtro por status "atrasada" ----------
  const filterStatus = await fetch(`${BASE}/api/demandas/team-report?status=atrasada`, { headers: h(adminToken) }).then((r) => r.json());
  const filterStatusIds = filterStatus.demandas.map((d) => d.id);
  check('filtro por status "atrasada" traz só d3', filterStatusIds.length === 1 && filterStatusIds[0] === d3.id);

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
