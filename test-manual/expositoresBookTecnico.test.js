// Teste de integração (servidor de verdade) da 78ª rodada -- pedido
// explícito da Raquel: "book tecnico sera um arquivo, igual catalogo".
// Confere que /api/expositores/book-tecnico funciona igual ao Catálogo já
// testado (mesmo módulo genérico, ver utils/catalogFileStore.js) -- 1
// arquivo atual por marca, upload novo substitui o anterior.
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-expositores-book-tecnico';
process.env.PORT = '4339';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4339';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-expositores-book-tecnico-test');
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

  const BASE = 'http://localhost:4339';

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
  function h(token) { return { Authorization: `Bearer ${token}` }; }

  const listRes = await fetch(`${BASE}/api/expositores/book-tecnico`, { headers: h(adminToken) }).then((r) => r.json());
  check('lista o Book Técnico com as 2 marcas (GhelPlus/De Bacco)', Array.isArray(listRes.items) && listRes.items.length === 2);
  check('começa sem arquivo nenhum', listRes.items.every((it) => !it.file));

  const fd = new FormData();
  fd.append('file', new Blob(['conteúdo fake de PDF'], { type: 'application/pdf' }), 'book-ghelplus.pdf');
  const uploadRes = await fetch(`${BASE}/api/expositores/book-tecnico/ghelplus`, {
    method: 'POST', headers: h(adminToken), body: fd
  });
  check('upload do Book Técnico da GhelPlus funciona (200)', uploadRes.status === 200);

  const afterUpload = await fetch(`${BASE}/api/expositores/book-tecnico`, { headers: h(adminToken) }).then((r) => r.json());
  const ghelItem = afterUpload.items.find((it) => it.brand === 'ghelplus');
  const debaccoItem = afterUpload.items.find((it) => it.brand === 'debacco');
  check('GhelPlus agora tem arquivo', !!(ghelItem && ghelItem.file));
  check('De Bacco continua sem arquivo (coleção separada por marca)', debaccoItem && !debaccoItem.file);

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
