// Teste de integração (servidor de verdade, mesmo padrão de
// pinterestConnectScopes.test.js/youtubeConnectScopes.test.js) da 76ª
// rodada -- pedido novo da Raquel: "Vamos para o tik tok, usamos ele na
// Ghel e na De Bacco, então precisaremos de 2 acessos". Confere que o
// fluxo de autorização da TikTok está montado direito: usa `client_key`
// (não `client_id`, diferença real da API da TikTok -- ver
// utils/tiktokClient.js), pede o escopo certo (video.publish), e que
// AMBAS as marcas podem conectar (diferente do Pinterest/LinkedIn, que
// são restritas a 1 marca só -- aqui GhelPlus e De Bacco usam contas
// SEPARADAS, confirmado com a Raquel antes de implementar).
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-tiktok-connect-scopes';
process.env.PORT = '4333';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.TIKTOK_CLIENT_KEY = 'fake-tiktok-client-key';
process.env.TIKTOK_CLIENT_SECRET = 'fake-tiktok-client-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4333';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-tiktok-connect-scopes-test');
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

  const BASE = 'http://localhost:4333';

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

  // ---------- Ambas as marcas podem conectar (contas separadas) ----------
  const connectDebaccoRes = await fetch(`${BASE}/api/social-accounts/tiktok/connect?brand=debacco`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const connectDebaccoBody = await connectDebaccoRes.json();
  check('De Bacco: connect devolveu uma redirectUrl', !!connectDebaccoBody.redirectUrl);

  const connectGhelplusRes = await fetch(`${BASE}/api/social-accounts/tiktok/connect?brand=ghelplus`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const connectGhelplusBody = await connectGhelplusRes.json();
  check('GhelPlus: connect TAMBÉM devolveu uma redirectUrl (contas separadas, as 2 marcas conectam)', !!connectGhelplusBody.redirectUrl);

  const connectDuranoxRes = await fetch(`${BASE}/api/social-accounts/tiktok/connect?brand=duranox`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  check('Duranox: connect recusa com 400 (só GhelPlus/De Bacco usam TikTok por enquanto)', connectDuranoxRes.status === 400);

  // ---------- Conferindo a URL de autorização ----------
  const url = new URL(connectDebaccoBody.redirectUrl);
  check('URL de autorização aponta pra TikTok de verdade', url.hostname === 'www.tiktok.com');
  check('caminho certo (/v2/auth/authorize/)', url.pathname === '/v2/auth/authorize/');
  check('usa `client_key` (não `client_id` -- diferença real da API da TikTok)', url.searchParams.get('client_key') === 'fake-tiktok-client-key');
  check('NÃO manda `client_id` (garante que não confundimos com o padrão OAuth das outras redes)', !url.searchParams.has('client_id'));
  check('response_type=code', url.searchParams.get('response_type') === 'code');
  check('pede o escopo video.publish (necessário pra publicar direto)', (url.searchParams.get('scope') || '').split(',').includes('video.publish'));
  check('redirect_uri aponta pro callback certo', url.searchParams.get('redirect_uri') === 'http://localhost:4333/api/social-accounts/tiktok/callback');
  check('tem state (CSRF)', !!url.searchParams.get('state'));

  // ---------- GET /api/social-accounts confirma as 2 marcas na lista ----------
  const statusListRes = await fetch(`${BASE}/api/social-accounts`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  }).then((r) => r.json());
  const tiktokBrands = (statusListRes.tiktokAccounts || []).map((a) => a.brand);
  check('lista de contas da TikTok tem GhelPlus e De Bacco', tiktokBrands.includes('ghelplus') && tiktokBrands.includes('debacco'));
  check('tiktokConfigured true (credenciais fake configuradas)', statusListRes.tiktokConfigured === true);

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
