// Teste visual (Playwright) da correção de bug da 91ª rodada --
// complementa o teste de integração brindesLinkExternoDoisModos91.test.js,
// cobrindo a parte que só existe na TELA: o painel de link externo do
// Catálogo de Brindes (e do Registro de Saídas) agora mostra 2 blocos
// independentes (👁️ Somente leitura / 🔓 Leitura e edição), cada um com
// os próprios botões -- gerar um nunca esconde/desativa o outro.
//
// Sobe o PRÓPRIO server.js numa porta dedicada (mesmo padrão de
// analiseInfluencerPlanilhaNova91.playwright.js) -- não mexe no servidor
// compartilhado de dev nem no banco de produção.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

process.env.JWT_SECRET = 'teste-brindes-link-dois-modos-91-pw';
process.env.PORT = '4352';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4352';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-brindes-link-dois-modos-91-pw-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

const BASE = 'http://localhost:4352';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function run() {
  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  if (statusRes.needsSetup) {
    await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin PW 91', username: 'admin', password: '123456' })
    }).then((r) => r.json());
  }

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') { consoleErrors.push(msg.text()); console.log('[console.error]', msg.text()); } });
  page.on('pageerror', (err) => { consoleErrors.push(String(err)); console.log('[pageerror]', String(err)); });
  page.on('dialog', (d) => d.accept());

  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(400);

  await page.click('#navBrindesParent');
  await page.waitForSelector('#navBrindesSubmenu:not([hidden])', { timeout: 5000 });
  await page.click('#navBrindesControleGeral');
  await page.waitForSelector('#brindesCatalogWrap:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.click('[data-brindes-tab="ghelplus"]');
  await page.waitForTimeout(300);

  await page.click('#brindesPublicLinkBtn');
  await page.waitForSelector('#brindesPublicLinkPanel:not([hidden])', { timeout: 5000 });

  check('bloco de leitura começa inativo (botão "Gerar link de leitura" visível)', await page.isVisible('#brindesGenLeituraLinkBtn'));
  check('bloco de edição começa inativo (botão "Gerar link de edição" visível)', await page.isVisible('#brindesGenEdicaoLinkBtn'));

  // Gera o link de LEITURA primeiro.
  await page.click('#brindesGenLeituraLinkBtn');
  await page.waitForFunction(() => !document.querySelector('#brindesPublicLinkLeituraActive').hidden, { timeout: 5000 });
  await page.waitForTimeout(200);
  const leituraUrl = await page.inputValue('#brindesPublicLinkLeituraField');
  check('link de leitura tem o formato certo', /\?sharePublic=[a-f0-9]+$/.test(leituraUrl));

  // Gera o link de EDIÇÃO -- o bloco de leitura, que já estava ativo,
  // não pode mudar nem esconder (é exatamente o bug que a Raquel
  // reportou: gerar um modo "quebrava" o outro).
  await page.click('#brindesGenEdicaoLinkBtn');
  await page.waitForFunction(() => !document.querySelector('#brindesPublicLinkEdicaoActive').hidden, { timeout: 5000 });
  await page.waitForTimeout(200);
  const edicaoUrl = await page.inputValue('#brindesPublicLinkEdicaoField');
  check('link de edição tem o formato certo', /\?sharePublic=[a-f0-9]+$/.test(edicaoUrl));
  check('[BUG CORRIGIDO] bloco de leitura continua ativo na tela depois de gerar o de edição', !(await page.isHidden('#brindesPublicLinkLeituraActive')));
  const leituraUrlDepois = await page.inputValue('#brindesPublicLinkLeituraField');
  check('[BUG CORRIGIDO] URL do link de leitura não mudou', leituraUrlDepois === leituraUrl);

  // Abre os dois links como visitante (sem login) em contextos separados.
  const ctxLeitura = await browser.newContext();
  const pLeitura = await ctxLeitura.newPage();
  await pLeitura.goto(leituraUrl);
  await pLeitura.waitForSelector('#screen-share-public:not([hidden])', { timeout: 10000 });
  check('[BUG CORRIGIDO] link de leitura abre normalmente (não dá mais "Link inválido")', await pLeitura.isHidden('#sharePublicError'));
  const rowsLeitura = await pLeitura.locator('#sharePublicContent table tbody tr').count();
  const inputsLeitura = await pLeitura.locator('#sharePublicContent input[data-share-field]').count();
  check('link de leitura mostra a tabela (sem nenhum campo editável)', rowsLeitura > 0 && inputsLeitura === 0);

  const ctxEdicao = await browser.newContext();
  const pEdicao = await ctxEdicao.newPage();
  await pEdicao.goto(edicaoUrl);
  await pEdicao.waitForSelector('#screen-share-public:not([hidden])', { timeout: 10000 });
  const inputsEdicao = await pEdicao.locator('#sharePublicContent input[data-share-field]').count();
  check('link de edição mostra campos editáveis de estoque', inputsEdicao > 0);

  // Desativa só o de leitura -- o de edição continua ativo, na tela e de verdade.
  await page.click('#brindesRevokeLeituraLinkBtn');
  await page.waitForFunction(() => document.querySelector('#brindesPublicLinkLeituraActive').hidden, { timeout: 5000 });
  check('bloco de leitura volta a mostrar "Gerar link de leitura" depois de desativar', await page.isVisible('#brindesGenLeituraLinkBtn'));
  check('[BUG CORRIGIDO] bloco de edição continua ativo depois de desativar só o de leitura', !(await page.isHidden('#brindesPublicLinkEdicaoActive')));

  await pEdicao.reload();
  await pEdicao.waitForSelector('#screen-share-public:not([hidden])', { timeout: 10000 });
  check('[BUG CORRIGIDO] link de edição continua funcionando de verdade depois de desativar o de leitura', await pEdicao.isHidden('#sharePublicError'));

  await pLeitura.reload();
  await pLeitura.waitForTimeout(800);
  check('link de leitura revogado agora mostra erro pro visitante', !(await pLeitura.isHidden('#sharePublicError')));

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
