// Teste visual (Playwright) da rodada de segurança (15/10/2026), pedido
// direto da Raquel: "o que falta para deixar 100% segura a plataforma
// papoi? [...] sim, faça tudo isso" -- cobre a parte que só existe na
// TELA das duas mudanças desta rodada (os testes de integração
// loginRateLimit94.test.js e backupExport94.test.js já cobrem a API):
//
//   - Em Usuários, o bloco "🔒 Segurança e backup" (botão "Baixar backup
//     completo") só aparece pra quem é super admin.
//   - Clicar no botão realmente baixa um arquivo .zip (papoi-backup-*.zip)
//     e o texto de status atualiza certinho.
//   - Depois de 5 tentativas de login erradas pro MESMO usuário, a 6ª
//     tentativa (mesmo com a senha certa) mostra o aviso de bloqueio na
//     tela de login (não só na API).
//
// Servidor de teste isolado precisa estar rodando em http://localhost:4123
// (mesmo padrão dos outros testes Playwright desta cópia), já com o
// usuário "admin"/"123456" (super admin) cadastrado.
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function ensureConfiguracoesSubmenuOpen(page) {
  const isHidden = await page.$eval('#navConfiguracoesSubmenu', (el) => el.hidden);
  if (isHidden) await page.click('#navConfiguracoesParent');
  await page.waitForSelector('#navConfiguracoesSubmenu:not([hidden])');
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // ---------- setup via API ----------
  const loginSetup = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' })
  }).then((r) => r.json());
  const adminToken = loginSetup.token;
  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }

  await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'comumpw94', password: '123456', name: 'Usuária Comum PW94', cargo: 'analista' })
  });

  const page = await browser.newPage({ serviceWorkers: 'block' });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') { consoleErrors.push(msg.text()); console.log('[console.error]', msg.text()); } });
  page.on('pageerror', (err) => { consoleErrors.push(String(err)); console.log('[pageerror]', String(err)); });

  async function login(username, password) {
    await page.goto(BASE);
    await page.fill('#loginUsername', username);
    await page.fill('#loginPassword', password);
    await page.click('#loginSubmit');
  }

  // ---------- 1. Usuária comum: NÃO vê o bloco de backup ----------
  await login('comumpw94', '123456');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(400);
  await ensureConfiguracoesSubmenuOpen(page);
  await page.click('#navUsers');
  await page.waitForSelector('#view-users:not([hidden])');
  await page.waitForTimeout(300);
  check('usuária comum: bloco "Segurança e backup" fica ESCONDIDO', await page.isHidden('#backupSection'));

  await page.click('#logoutBtn');
  await page.waitForSelector('#screen-login:not([hidden])', { timeout: 10000 });

  // ---------- 2. Admin: vê o bloco e consegue baixar o backup ----------
  await login('admin', '123456');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(400);
  await ensureConfiguracoesSubmenuOpen(page);
  await page.click('#navUsers');
  await page.waitForSelector('#view-users:not([hidden])');
  await page.waitForTimeout(300);
  check('admin: bloco "Segurança e backup" fica VISÍVEL', await page.isVisible('#backupSection'));
  check('admin: botão "Baixar backup completo" está visível', await page.isVisible('#backupExportBtn'));

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#backupExportBtn')
  ]);
  const nomeSugerido = download.suggestedFilename();
  check('clicar no botão baixa um arquivo papoi-backup-<data>.zip de verdade', /^papoi-backup-[\d-]+\.zip$/.test(nomeSugerido));
  await page.waitForTimeout(200);
  const statusText = await page.textContent('#backupExportStatus');
  check('texto de status confirma o download com sucesso', /sucesso/i.test(statusText || ''));

  await page.click('#logoutBtn');
  await page.waitForSelector('#screen-login:not([hidden])', { timeout: 10000 });

  // ---------- 3. Bloqueio de login (anti força-bruta) aparece NA TELA ----------
  // Cria uma usuária só pra esse bloco, pra não travar o "admin" (usado por
  // outros testes) nem a usuária "comumpw94" criada acima.
  await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'bloqueiopw94', password: 'SenhaCertaPW94', name: 'Bloqueio PW94', cargo: 'analista' })
  });

  await page.goto(BASE);
  for (let i = 0; i < 5; i++) {
    await page.fill('#loginUsername', 'bloqueiopw94');
    await page.fill('#loginPassword', 'senha-errada-' + i);
    await page.click('#loginSubmit');
    await page.waitForSelector('#loginError:not([hidden])', { timeout: 10000 });
  }
  check('depois de 5 tentativas erradas, a tela ainda mostra erro de login normal (credenciais inválidas)', !/tentativas/i.test(await page.textContent('#loginError')));

  // 6ª tentativa, com a senha CERTA -- deve mostrar o aviso de bloqueio, não
  // deixar entrar.
  await page.fill('#loginUsername', 'bloqueiopw94');
  await page.fill('#loginPassword', 'SenhaCertaPW94');
  await page.click('#loginSubmit');
  await page.waitForTimeout(500);
  const loginErrorVisible = await page.isVisible('#loginError');
  const loginErrorText = await page.textContent('#loginError');
  check('6ª tentativa (com a senha CERTA) mostra aviso de bloqueio na tela de login', loginErrorVisible && /tentativas/i.test(loginErrorText || ''));
  check('6ª tentativa NÃO entra na plataforma (continua na tela de login)', await page.isHidden('#screen-app'));

  // "Failed to load resource: ... 401/429" é o PRÓPRIO navegador logando as
  // respostas de erro esperadas das tentativas de login erradas/bloqueadas
  // acima (não é um bug da aplicação) -- só reprova se sobrar algum outro
  // erro de JS de verdade.
  const errosInesperados = consoleErrors.filter((e) => !/Failed to load resource.*(401|429)/i.test(e));
  check('nenhum erro de console/JS inesperado na tela inteira', errosInesperados.length === 0);

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
