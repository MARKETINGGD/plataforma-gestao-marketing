// Teste visual (Playwright) da 101ª rodada -- complementa o teste de
// integração brindesComprasOrcamentos101.test.js, cobrindo a parte que só
// existe na TELA: o novo submenu Compras + a aba Orçamentos dentro de
// Brindes, incluindo o fluxo de aprovar um orçamento na tela e ver a
// Compra nascer sozinha na aba Compras.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

process.env.JWT_SECRET = 'teste-brindes-compras-101-pw';
process.env.PORT = '4365';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4365';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-brindes-compras-101-pw-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

const BASE = 'http://localhost:4365';
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
      body: JSON.stringify({ name: 'Admin PW 101', username: 'admin', password: '123456' })
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
  check('submenu "Orçamentos" aparece dentro de Brindes', await page.isVisible('#navBrindesOrcamentos'));
  check('submenu "Compras" aparece dentro de Brindes', await page.isVisible('#navBrindesCompras'));

  // ---------- Orçamentos: lista vazia -> criar um novo ----------
  await page.click('#navBrindesOrcamentos');
  await page.waitForSelector('#view-brindes-orcamentos:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(300);
  check('lista de orçamentos começa vazia', await page.isVisible('#brindesOrcamentosEmpty'));

  await page.click('#brindesOrcamentoNewBtn');
  await page.waitForSelector('#brindesOrcamentoFormWrap:not([hidden])', { timeout: 5000 });
  await page.fill('#brindesOrcamentoFormItem', 'Garrafa Térmica Personalizada');
  await page.fill('#brindesOrcamentoFormFornecedor', 'Fornecedor PW Teste');
  await page.fill('#brindesOrcamentoFormQuantidade', '20');
  await page.fill('#brindesOrcamentoFormValorUnitario', '35');
  await page.fill('#brindesOrcamentoFormQuemPediu', 'Raquel');
  await page.click('#brindesOrcamentoFormSave');
  await page.waitForFunction(() => document.querySelector('#brindesOrcamentosEmpty').hidden === true, { timeout: 5000 });
  await page.waitForTimeout(200);
  check('orçamento aparece na tabela depois de salvar', (await page.locator('#brindesOrcamentosBody tr').count()) === 1);
  check('orçamento novo aparece com status "Pendente" selecionado', await page.locator('#brindesOrcamentosBody select[data-orcamento-status] option:checked').textContent() === 'Pendente');

  // ---------- aprovar na tela -> dispara o alerta + cria a Compra ----------
  await page.selectOption('#brindesOrcamentosBody select[data-orcamento-status]', 'aprovado');
  await page.waitForTimeout(500);
  check('depois de aprovar, aparece o ícone de "já gerou uma compra" (🛒)', (await page.locator('#brindesOrcamentosBody').textContent()).includes('🛒'));

  // ---------- Compras: a Compra nasceu sozinha ----------
  await page.click('#navBrindesCompras');
  await page.waitForSelector('#view-brindes-compras:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(300);
  check('a compra gerada automaticamente aparece na aba Compras', (await page.locator('#brindesComprasBody tr').count()) === 1);
  const linhaCompra = page.locator('#brindesComprasBody tr').nth(0);
  check('a compra tem o item certo e o ícone de "veio de um orçamento aprovado" (📋)', (await linhaCompra.textContent()).includes('Garrafa Térmica Personalizada') && (await linhaCompra.textContent()).includes('📋'));
  check('o valor total da compra = 20 x R$35 = R$700,00', (await linhaCompra.textContent()).includes('700'));

  // ---------- Compras: cadastrar uma compra direto, sem orçamento ----------
  await page.click('#brindesCompraNewBtn');
  await page.waitForSelector('#brindesCompraFormWrap:not([hidden])', { timeout: 5000 });
  await page.fill('#brindesCompraFormItem', 'Caneca Inox Direta');
  await page.fill('#brindesCompraFormFornecedor', 'Fornecedor Direto PW');
  await page.fill('#brindesCompraFormQuantidade', '50');
  await page.fill('#brindesCompraFormValorUnitario', '12');
  await page.fill('#brindesCompraFormValorTotal', '600');
  await page.fill('#brindesCompraFormQuemPediu', 'Raquel');
  await page.check('#brindesCompraFormConferencia');
  await page.click('#brindesCompraFormSave');
  await page.waitForFunction(() => document.querySelectorAll('#brindesComprasBody tr').length === 2, { timeout: 5000 });
  check('a 2ª compra (direta, sem orçamento) também aparece na lista', (await page.locator('#brindesComprasBody').textContent()).includes('Caneca Inox Direta'));

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
