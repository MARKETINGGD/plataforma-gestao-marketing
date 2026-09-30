// Teste de integração (servidor de verdade) da 78ª rodada -- pedido
// explícito da Raquel: "em lançamento de produtos, adicione também o
// status- Lançado. E adicione depois de certificação- Engenharia."
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-produtos-lancamento-status';
process.env.PORT = '4338';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4338';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-produtos-lancamento-status-test');
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

  const BASE = 'http://localhost:4338';

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  let adminToken;
  if (statusRes.needsSetup) {
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin Teste', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
  } else {
    adminToken = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456' })
    }).then((r) => r.json()).then((d) => d.token);
  }
  check('login/setup do admin devolveu token', !!adminToken);
  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }

  const meta = await fetch(`${BASE}/api/produtos/lancamentos`, { headers: hj(adminToken) }); // sanity: rota existe
  check('GET /lancamentos responde 200', meta.status === 200);

  const created = await fetch(`${BASE}/api/produtos/lancamentos`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ brand: 'debacco', nome: 'Produto Teste Engenharia', status: 'engenharia' })
  }).then((r) => r.json()).then((d) => d.item);
  check('cria lançamento já com status "engenharia"', created && created.status === 'engenharia');

  const updated = await fetch(`${BASE}/api/produtos/lancamentos/${created.id}`, {
    method: 'PUT', headers: hj(adminToken),
    body: JSON.stringify({ status: 'lancado' })
  }).then((r) => r.json()).then((d) => d.item);
  check('atualiza pra status "lancado"', updated && updated.status === 'lancado');

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
