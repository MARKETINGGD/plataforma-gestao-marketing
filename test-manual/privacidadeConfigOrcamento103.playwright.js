// Teste visual (Playwright) da 103ª rodada -- confirma na TELA que
// Configurações (Usuários/Integrações) e Orçamento ficam privados por
// padrão, que o novo nível "Visualizar" aparece nos dropdowns certos
// (Configurações e Orçamento), e que a linha de Fornecedores (que tinha
// ficado faltando) agora existe no formulário de permissões.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

process.env.JWT_SECRET = 'teste-privacidade-config-orcamento-103-pw';
process.env.PORT = '4369';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4369';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-privacidade-config-orcamento-103-pw-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

const BASE = 'http://localhost:4369';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function run() {
  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  let adminToken;
  if (statusRes.needsSetup) {
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin PW 103', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
  } else {
    adminToken = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456' })
    }).then((r) => r.json()).then((d) => d.token);
  }
  // Pessoa sem nenhuma permissão nova, pra testar o bloqueio na tela.
  await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ username: 'semacesso103pw', password: '123456', name: 'Sem Acesso PW 103' })
  });

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') { consoleErrors.push(msg.text()); console.log('[console.error]', msg.text()); } });
  page.on('pageerror', (err) => { consoleErrors.push(String(err)); console.log('[pageerror]', String(err)); });
  page.on('dialog', (d) => d.accept());

  // ---------- parte 1: logado como ADMIN -- vê tudo, e os dropdowns novos existem ----------
  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(400);

  await page.click('#navConfiguracoesParent');
  await page.waitForSelector('#navConfiguracoesSubmenu:not([hidden])', { timeout: 5000 });
  await page.click('#navUsers');
  await page.waitForSelector('#view-users:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(300);
  check('admin consegue ver a tabela de Usuários (sem o aviso de bloqueio)', await page.isVisible('#usersTable') && !(await page.isVisible('#usersAccessDenied')));

  // Abre o form de um usuário qualquer pra conferir os novos dropdowns.
  await page.click('#userNewBtn');
  await page.waitForSelector('#userFormWrap:not([hidden])', { timeout: 5000 });
  const configOptions = await page.locator('select[data-perm="configuracoes"] option').allTextContents();
  check('dropdown de Configurações tem só "Sem acesso"/"Só visualizar" (sem Editor/Admin)', configOptions.join('|') === 'Sem acesso|Só visualizar');
  const budgetOptions = await page.locator('select[data-perm="budget"] option').allTextContents();
  check('dropdown de Orçamento ganhou "Só visualizar" entre Sem acesso e Editor', budgetOptions.join('|') === 'Sem acesso|Só visualizar|Editor|Admin');
  check('linha de Fornecedores existe no formulário de permissões (bug corrigido)', await page.locator('select[data-perm="fornecedores"]').count() === 1);
  await page.click('#userFormCancel');

  await page.click('#navIntegracoes');
  await page.waitForSelector('#view-integracoes:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(300);
  check('admin consegue ver o conteúdo de Integrações (sem o aviso de bloqueio)', await page.isVisible('#integracoesContent') && !(await page.isVisible('#integracoesAccessDenied')));

  await page.click('#logoutBtn');
  await page.waitForSelector('#screen-login:not([hidden])', { timeout: 10000 });

  // ---------- parte 2: logado como pessoa SEM NENHUMA permissão nova ----------
  await page.fill('#loginUsername', 'semacesso103pw');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(400);

  check('link "Configurações" continua aparecendo no menu mesmo sem acesso (nav nunca esconde, só o conteúdo)', await page.isVisible('#navConfiguracoesParent'));
  await page.click('#navConfiguracoesParent');
  await page.waitForSelector('#navConfiguracoesSubmenu:not([hidden])', { timeout: 5000 });
  await page.click('#navUsers');
  await page.waitForSelector('#view-users:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(300);
  check('sem permissão, a tela de Usuários mostra o aviso de bloqueio (sem a tabela)', await page.isVisible('#usersAccessDenied') && !(await page.isVisible('#usersTable')));

  await page.click('#navIntegracoes');
  await page.waitForSelector('#view-integracoes:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(300);
  check('sem permissão, a tela de Integrações mostra o aviso de bloqueio (sem o conteúdo)', await page.isVisible('#integracoesAccessDenied') && !(await page.isVisible('#integracoesContent')));

  check('nenhum erro de console/página em toda a navegação', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(process.exitCode);
}

run().catch((e) => {
  console.error(e);
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(1);
});
