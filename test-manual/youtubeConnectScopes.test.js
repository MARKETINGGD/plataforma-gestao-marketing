// Teste de integração (servidor de verdade, mesmo padrão de
// callback-endpoint.test.js) da 72ª rodada -- bug real reportado pela
// Raquel ao testar a conexão de verdade em produção: "Request had
// insufficient authentication scopes" logo depois de resolver o erro de
// client secret inválido (71ª rodada). Causa raiz: `GET
// /api/social-accounts/youtube/connect` só pedia o escopo
// `youtube.upload` -- suficiente pra publicar vídeo/capa, mas NÃO pra
// `channels.list` (usado por getMyChannel() em utils/youtubeClient.js
// pra descobrir qual canal foi conectado, chamado no callback logo
// depois da autorização) -- que exige um escopo de leitura. Corrigido
// pedindo `youtube.upload` + `youtube.readonly` juntos.
//
// Roda o server.js de verdade numa porta própria, com backup/
// restauração do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-youtube-connect-scopes';
process.env.PORT = '4330';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.YOUTUBE_CLIENT_ID = 'fake-client-id.apps.googleusercontent.com';
process.env.YOUTUBE_CLIENT_SECRET = 'fake-client-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4330';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-youtube-connect-scopes-test');
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

  const BASE = 'http://localhost:4330';

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

  const connectRes = await fetch(`${BASE}/api/social-accounts/youtube/connect?brand=ghelplus`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  }).then((r) => r.json());
  check('connect devolveu uma redirectUrl', !!connectRes.redirectUrl);

  const url = new URL(connectRes.redirectUrl);
  const scopes = (url.searchParams.get('scope') || '').split(' ').filter(Boolean);
  check('pede o escopo de upload (publicar vídeo/capa)', scopes.includes('https://www.googleapis.com/auth/youtube.upload'));
  check('pede o escopo de leitura (channels.list, pra descobrir o canal conectado -- era o que faltava)', scopes.includes('https://www.googleapis.com/auth/youtube.readonly'));
  check('URL de autorização aponta pro Google de verdade', url.hostname === 'accounts.google.com');

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
