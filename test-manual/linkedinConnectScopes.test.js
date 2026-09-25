// Teste de integração (servidor de verdade, mesmo padrão de
// pinterestConnectScopes.test.js) da 76ª rodada -- pedido novo da Raquel:
// "Só a GhelPlus usa linkedin". Confere que o fluxo de autorização da
// LinkedIn continua montado direito (client_id, escopos w_organization_social
// + rw_organization_admin) e que SÓ a GhelPlus pode conectar (a De Bacco não
// tem Página própria da LinkedIn, pedido explícito da Raquel -- mesmo
// espírito do Pinterest, só que ao contrário: lá só a De Bacco, aqui só a
// GhelPlus).
//
// Roda o server.js de verdade numa porta própria, com backup/restauração do
// data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-linkedin-connect-scopes';
process.env.PORT = '4332';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.LINKEDIN_CLIENT_ID = 'fake-linkedin-client-id';
process.env.LINKEDIN_CLIENT_SECRET = 'fake-linkedin-client-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4332';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-linkedin-connect-scopes-test');
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

  const BASE = 'http://localhost:4332';

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

  // ---------- Só a GhelPlus pode conectar ----------
  const connectGhelplusRes = await fetch(`${BASE}/api/social-accounts/linkedin/connect?brand=ghelplus`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const connectGhelplusBody = await connectGhelplusRes.json();
  check('GhelPlus: connect devolveu uma redirectUrl', !!connectGhelplusBody.redirectUrl);

  const connectDebaccoRes = await fetch(`${BASE}/api/social-accounts/linkedin/connect?brand=debacco`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  check('De Bacco: connect recusa com 400 (só a GhelPlus usa LinkedIn, pedido explícito da Raquel)', connectDebaccoRes.status === 400);

  // ---------- Conferindo a URL de autorização da GhelPlus ----------
  const url = new URL(connectGhelplusBody.redirectUrl);
  check('URL de autorização aponta pra LinkedIn de verdade', url.hostname === 'www.linkedin.com');
  check('usa `client_id` (padrão OAuth normal, diferente do Pinterest)', url.searchParams.get('client_id') === 'fake-linkedin-client-id');

  const scopes = (url.searchParams.get('scope') || '').split(' ').filter(Boolean);
  check('pede o escopo de post social da organization (w_organization_social)', scopes.includes('w_organization_social'));
  check('pede o escopo de admin da organization (rw_organization_admin, pra listar as Páginas administradas)', scopes.includes('rw_organization_admin'));

  // ---------- GET /api/social-accounts confirma que só a GhelPlus aparece ----------
  const statusListRes = await fetch(`${BASE}/api/social-accounts`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  }).then((r) => r.json());
  const linkedinBrands = (statusListRes.linkedinAccounts || []).map((a) => a.brand);
  check('lista de contas da LinkedIn tem só a GhelPlus (De Bacco nem aparece)', linkedinBrands.length === 1 && linkedinBrands[0] === 'ghelplus');

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
