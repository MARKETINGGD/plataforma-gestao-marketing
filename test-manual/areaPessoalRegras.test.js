// Teste de integração (servidor de verdade) da 78ª rodada -- pedido
// explícito da Raquel: "as demandas concluidas da area pessoal, não
// devem pontuar no reis do marketing" (reverte a decisão da 33ª rodada,
// que fazia a Área Pessoal pontuar igual ao Quadro Geral).
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-area-pessoal-regras';
process.env.PORT = '4337';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4337';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-area-pessoal-regras-test');
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

  const BASE = 'http://localhost:4337';
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
  let adminId;
  if (statusRes.needsSetup) {
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin Teste', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
    adminId = setupRes.user && setupRes.user.id;
  } else {
    adminToken = await login('admin', '123456');
    const me = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json()).catch(() => null);
    adminId = me && me.id;
  }
  check('login/setup do admin devolveu token', !!adminToken);

  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }
  async function createUser(username, name) {
    const res = await fetch(`${BASE}/api/auth/users`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ username, password: '123456', name })
    }).then((r) => r.json());
    return res.user;
  }
  const ana = await createUser('anapessoal', 'Analista Área Pessoal');
  check('usuário de teste criado', !!ana);

  // ---------- Demanda do QUADRO GERAL, concluída neste mês -- deve pontuar ----------
  const dGeral = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ title: 'Geral concluída', assigneeIds: [ana.id], responsibleId: ana.id, visibility: 'geral' })
  }).then((r) => r.json()).then((d) => d.demanda);
  await fetch(`${BASE}/api/demandas/${dGeral.id}`, { method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ status: 'concluida' }) });

  // ---------- Demanda da ÁREA PESSOAL, concluída neste mês -- NÃO deve pontuar ----------
  const dPessoal = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ title: 'Pessoal concluída', assigneeIds: [ana.id], responsibleId: ana.id, visibility: 'pessoal' })
  }).then((r) => r.json()).then((d) => d.demanda);
  await fetch(`${BASE}/api/demandas/${dPessoal.id}`, { method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ status: 'concluida' }) });

  const reis = await fetch(`${BASE}/api/demandas/reis-do-marketing`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
  check('ana pontuou exatamente 1 (só a demanda do Quadro Geral -- a pessoal não conta)', reis.counts[ana.id] === 1);

  // ---------- Card novo nasce no topo da lista (78ª rodada) ----------
  // dGeral e dPessoal (criadas acima) são "cards antigos" pra este teste;
  // um card criado AGORA precisa ter uma ordem menor que os dois (aparece
  // primeiro quando a lista é ordenada por `order` crescente).
  const dNovo = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ title: 'Card recém-criado', assigneeIds: [ana.id], responsibleId: ana.id, visibility: 'geral' })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('card novo nasce com order MENOR que um card criado antes dele (fica no topo)', dNovo.order < dGeral.order);
  check('card novo nasce com order MENOR que a data de agora em ms (é negativo/bem menor, nunca "cai pro fim")', dNovo.order < Date.now());

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
