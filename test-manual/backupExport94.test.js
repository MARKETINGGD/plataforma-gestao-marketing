// Teste de integração da rodada de segurança (15/10/2026), pedido direto
// da Raquel: "o que falta para deixar 100% segura a plataforma papoi? e se
// der algum problema, tem chance de perdermos o conteúdo?" -- novo
// endpoint GET /api/backup/export (routes/backup.js), que gera um .zip com
// o banco inteiro (data/db.json) + todos os arquivos anexados
// (data/uploads), só pro admin da plataforma baixar.
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção. Usa o `unzip` do
// próprio sistema só pra CONFERIR o conteúdo do zip devolvido (mesmo
// recurso já usado no fluxo de deploy documentado no projeto -- `unzip -l`/
// `unzip -p` -- não entra em nenhum código da Papoi em si).
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

process.env.JWT_SECRET = 'teste-backup-export-94';
process.env.PORT = '4357';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4357';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-backup-export-94-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

// Arquivo de teste dentro de data/uploads, só pra confirmar que o zip
// também inclui os arquivos anexados, não só o banco -- removido no final.
const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
const arquivoTesteDir = path.join(uploadsDir, '_teste-backup-94');
const arquivoTeste = path.join(arquivoTesteDir, 'arquivo-de-teste.txt');
fs.mkdirSync(arquivoTesteDir, { recursive: true });
fs.writeFileSync(arquivoTeste, 'conteúdo de teste da 94ª rodada, só pra confirmar que entrou no backup');

let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

function limpar() {
  fs.rmSync(arquivoTesteDir, { recursive: true, force: true });
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
}

async function run() {
  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const BASE = 'http://localhost:4357';

  async function login(username, password) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then((r) => r.json());
    return res.token;
  }
  function hj(token) { return { Authorization: `Bearer ${token}` }; }

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  let adminToken;
  if (statusRes.needsSetup) {
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin Backup 94', username: 'adminbkp94', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
  } else {
    adminToken = await login('admin', '123456');
  }
  check('login/setup do admin devolveu token', !!adminToken);

  // Usuária comum, sem ser super admin -- pra confirmar que o endpoint é
  // mesmo restrito.
  await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hj(adminToken)),
    body: JSON.stringify({ username: 'comum94', password: '123456', name: 'Usuária Comum 94', cargo: 'analista' })
  });
  const tokenComum = await login('comum94', '123456');

  // ---------- 1. Sem token nenhum -- 401 ----------
  const semToken = await fetch(`${BASE}/api/backup/export`);
  check('sem token, devolve 401', semToken.status === 401);

  // ---------- 2. Logada mas sem ser super admin -- 403 ----------
  const comumRes = await fetch(`${BASE}/api/backup/export`, { headers: hj(tokenComum) });
  check('usuária comum (não admin) recebe 403', comumRes.status === 403);

  // ---------- 3. Super admin -- 200, com o zip de verdade ----------
  const adminRes = await fetch(`${BASE}/api/backup/export`, { headers: hj(adminToken) });
  check('super admin recebe 200', adminRes.status === 200);
  check('Content-Type é application/zip', (adminRes.headers.get('content-type') || '').includes('zip'));
  const contentDisposition = adminRes.headers.get('content-disposition') || '';
  check('nome do arquivo segue o padrão papoi-backup-<data>.zip', /filename="papoi-backup-[\d-]+\.zip"/.test(contentDisposition));

  const buffer = Buffer.from(await adminRes.arrayBuffer());
  check('resposta não está vazia', buffer.length > 100);
  check('começa com a assinatura de um arquivo zip de verdade (PK)', buffer[0] === 0x50 && buffer[1] === 0x4b);

  // Só lê o banco real DEPOIS que a resposta inteira chegou -- o próprio
  // endpoint grava uma entrada nova no Histórico de alterações (auditLog)
  // antes de fechar o zip, então o db.json "de verdade" só fica estável
  // depois que o download termina (não antes de disparar a requisição).
  const dbAntesDoExport = fs.readFileSync(realDbPath, 'utf8');

  const tmpZipPath = path.join(os.tmpdir(), `papoi-backup-94-teste-${Date.now()}.zip`);
  fs.writeFileSync(tmpZipPath, buffer);
  try {
    const listagem = execFileSync('unzip', ['-l', tmpZipPath], { maxBuffer: 64 * 1024 * 1024 }).toString();
    check('zip contém o db.json', listagem.includes('db.json'));
    check('zip contém a pasta uploads/ (com o arquivo de teste criado)', listagem.includes('uploads/_teste-backup-94/arquivo-de-teste.txt'));

    // maxBuffer maior que o padrão (1MB) -- o db.json real da plataforma já
    // passa disso, então o padrão do execFileSync cortava a leitura (ENOBUFS).
    const MAX_BUFFER = 64 * 1024 * 1024; // 64MB, bem acima do banco atual
    const dbDentroDoZip = execFileSync('unzip', ['-p', tmpZipPath, 'db.json'], { maxBuffer: MAX_BUFFER }).toString();
    check('o db.json dentro do zip bate com o banco real no momento do export', dbDentroDoZip === dbAntesDoExport);

    const arquivoDentroDoZip = execFileSync('unzip', ['-p', tmpZipPath, 'uploads/_teste-backup-94/arquivo-de-teste.txt'], { maxBuffer: MAX_BUFFER }).toString();
    check('o arquivo anexado de teste dentro do zip bate com o original', arquivoDentroDoZip === fs.readFileSync(arquivoTeste, 'utf8'));
  } finally {
    fs.rmSync(tmpZipPath, { force: true });
  }

  // ---------- 4. Fica registrado no Histórico de alterações ----------
  const dbDepois = JSON.parse(fs.readFileSync(realDbPath, 'utf8'));
  const registroDeBackup = (dbDepois.auditLog || []).find((a) => a.entityId === 'backup' && a.action === 'export');
  check('o download fica registrado no Histórico de alterações (auditLog)', !!registroDeBackup);

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(() => {
  limpar();
  process.exit(process.exitCode);
});
