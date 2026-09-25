// Teste de integração (servidor de verdade, mesmo padrão de
// youtubeConnectScopes.test.js) da 75ª rodada -- pedido novo da Raquel:
// "vamos começar com pinterest, é apenas de bacco". Confere que o fluxo de
// autorização do Pinterest está montado direito: usa `consumer_id` (não
// `client_id`, diferença real da API do Pinterest -- ver
// utils/pinterestClient.js), pede os 2 escopos certos (boards:read,
// pins:write), pede `refreshable=true` (sem isso o Pinterest nunca manda um
// refresh_token de volta), e que SÓ a De Bacco pode conectar (a GhelPlus não
// usa Pinterest, pedido explícito da Raquel).
//
// Roda o server.js de verdade numa porta própria, com backup/restauração do
// data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-pinterest-connect-scopes';
process.env.PORT = '4331';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PINTEREST_CLIENT_ID = 'fake-pinterest-client-id';
process.env.PINTEREST_CLIENT_SECRET = 'fake-pinterest-client-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4331';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-pinterest-connect-scopes-test');
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

  const BASE = 'http://localhost:4331';

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

  // ---------- Só a De Bacco pode conectar ----------
  const connectDebaccoRes = await fetch(`${BASE}/api/social-accounts/pinterest/connect?brand=debacco`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const connectDebaccoBody = await connectDebaccoRes.json();
  check('De Bacco: connect devolveu uma redirectUrl', !!connectDebaccoBody.redirectUrl);

  const connectGhelplusRes = await fetch(`${BASE}/api/social-accounts/pinterest/connect?brand=ghelplus`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  check('GhelPlus: connect recusa com 400 (só a De Bacco usa Pinterest, pedido explícito da Raquel)', connectGhelplusRes.status === 400);

  // ---------- Conferindo a URL de autorização da De Bacco ----------
  const url = new URL(connectDebaccoBody.redirectUrl);
  check('URL de autorização aponta pro Pinterest de verdade', url.hostname === 'www.pinterest.com');
  check('usa `consumer_id` (não `client_id` -- diferença real da API do Pinterest)', url.searchParams.get('consumer_id') === 'fake-pinterest-client-id');
  check('NÃO manda `client_id` (garante que não confundimos com o padrão OAuth das outras redes)', !url.searchParams.has('client_id'));
  check('pede `refreshable=true` (sem isso o Pinterest nunca manda refresh_token de volta)', url.searchParams.get('refreshable') === 'true');

  const scopes = (url.searchParams.get('scope') || '').split(',').filter(Boolean);
  check('pede o escopo de leitura de quadros (boards:read, pra listar e escolher o certo)', scopes.includes('boards:read'));
  check('pede o escopo de escrita de pins (pins:write, pra publicar)', scopes.includes('pins:write'));

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
