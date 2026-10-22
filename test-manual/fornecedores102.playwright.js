// Teste visual (Playwright) da 102ª rodada -- novo menu Fornecedores:
// navegação pelo link padrão (sem submenu), criar/editar/excluir pela
// tela, filtros por nome/tipo, e abrir o painel "Últimos pedidos feitos"
// pra um fornecedor que já tem histórico (criado via Brindes → Compras).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

process.env.JWT_SECRET = 'teste-fornecedores-102-pw';
process.env.PORT = '4367';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4367';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-fornecedores-102-pw-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

const BASE = 'http://localhost:4367';
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
      body: JSON.stringify({ name: 'Admin PW 102', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
  } else {
    adminToken = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456' })
    }).then((r) => r.json()).then((d) => d.token);
  }

  // Gera um fornecedor com histórico via Brindes -> Compras (101ª
  // rodada), pra testar o painel "Últimos pedidos feitos" na tela.
  await fetch(`${BASE}/api/brindes/compras`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ item: 'Chaveiro Personalizado PW', fornecedor: 'Fornecedor Com Histórico PW', quantidade: 200, valorUnitario: 2.5, quemPediu: 'Raquel', formaPagamento: 'Pix', dataCompra: '2026-10-22' })
  });

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

  check('link "Fornecedores" aparece no menu (nível raiz, sem submenu)', await page.isVisible('#navFornecedores'));
  await page.click('#navFornecedores');
  await page.waitForSelector('#view-fornecedores:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(300);

  check('fornecedor auto-criado pela compra de Brindes aparece na lista', (await page.locator('#fornecedoresBody').textContent()).includes('Fornecedor Com Histórico PW'));
  check('fornecedor auto-criado mostra o ícone de "ainda não revisado" (⚙️)', (await page.locator('#fornecedoresBody').textContent()).includes('⚙️'));

  // ---------- filtro por nome ----------
  await page.fill('#fornecedoresFilterNome', 'Com Histórico');
  await page.waitForTimeout(400);
  check('filtro por nome mostra só o fornecedor buscado', (await page.locator('#fornecedoresBody tr').count()) === 1);
  await page.click('#fornecedoresFilterClear');
  await page.waitForTimeout(400);
  check('"Limpar filtros" volta a mostrar todos', (await page.locator('#fornecedoresBody tr').count()) >= 1);

  // ---------- criar um fornecedor manual ----------
  await page.click('#fornecedorNewBtn');
  await page.waitForSelector('#fornecedorFormWrap:not([hidden])', { timeout: 5000 });
  check('formulário abre no modo "Novo fornecedor"', (await page.textContent('#fornecedorFormTitle')) === 'Novo fornecedor');
  await page.fill('#fornecedorFormNome', 'Fornecedor Manual PW Teste');
  await page.fill('#fornecedorFormTipo', 'brindes');
  await page.fill('#fornecedorFormContato', 'Maria');
  await page.fill('#fornecedorFormTelefone', '41988880000');
  await page.fill('#fornecedorFormEmail', 'maria@teste.com');
  await page.fill('#fornecedorFormCnpj', '11.111.111/0001-11');
  await page.fill('#fornecedorFormEndereco', 'Av. Teste, 456');
  await page.click('#fornecedorFormSave');
  await page.waitForFunction(() => document.querySelector('#fornecedorFormWrap').hidden === true, { timeout: 5000 });
  await page.waitForTimeout(300);
  check('fornecedor manual aparece na lista depois de salvar', (await page.locator('#fornecedoresBody').textContent()).includes('Fornecedor Manual PW Teste'));

  // ---------- filtro por tipo ----------
  await page.selectOption('#fornecedoresFilterTipo', 'brindes');
  await page.waitForTimeout(400);
  check('filtro por tipo "brindes" mostra o fornecedor recém-criado', (await page.locator('#fornecedoresBody').textContent()).includes('Fornecedor Manual PW Teste'));
  await page.click('#fornecedoresFilterClear');
  await page.waitForTimeout(400);

  // ---------- editar o fornecedor manual ----------
  const linhaManual = page.locator('#fornecedoresBody tr', { hasText: 'Fornecedor Manual PW Teste' });
  await linhaManual.locator('[data-edit-fornecedor]').click();
  await page.waitForSelector('#fornecedorFormWrap:not([hidden])', { timeout: 5000 });
  check('formulário abre no modo "Editar fornecedor" com os dados certos', (await page.textContent('#fornecedorFormTitle')) === 'Editar fornecedor' && (await page.inputValue('#fornecedorFormContato')) === 'Maria');
  await page.fill('#fornecedorFormContato', 'Maria Editada');
  await page.click('#fornecedorFormSave');
  await page.waitForFunction(() => document.querySelector('#fornecedorFormWrap').hidden === true, { timeout: 5000 });
  await page.waitForTimeout(300);
  check('edição refletiu na lista (contato atualizado)', (await page.locator('#fornecedoresBody').textContent()).includes('Maria Editada'));

  // ---------- "Últimos pedidos feitos" ----------
  const linhaHistorico = page.locator('#fornecedoresBody tr', { hasText: 'Fornecedor Com Histórico PW' });
  await linhaHistorico.locator('[data-ver-pedidos-fornecedor]').click();
  await page.waitForSelector('#fornecedorDetailWrap:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(300);
  check('painel de detalhe abre com o título do fornecedor certo', (await page.textContent('#fornecedorDetailTitle')).includes('Fornecedor Com Histórico PW'));
  check('"Últimos pedidos feitos" mostra o pedido vindo de Brindes · Compras', (await page.locator('#fornecedorPedidosBody').textContent()).includes('Chaveiro Personalizado PW') && (await page.locator('#fornecedorPedidosBody').textContent()).includes('Brindes'));
  await page.click('#fornecedorDetailClose');
  await page.waitForFunction(() => document.querySelector('#fornecedorDetailWrap').hidden === true, { timeout: 5000 });

  // ---------- excluir o fornecedor manual ----------
  const linhaManualFinal = page.locator('#fornecedoresBody tr', { hasText: 'Fornecedor Manual PW Teste' });
  await linhaManualFinal.locator('[data-del-fornecedor]').click();
  await page.waitForFunction(() => !document.querySelector('#fornecedoresBody').textContent.includes('Fornecedor Manual PW Teste'), { timeout: 5000 });
  check('fornecedor excluído some da lista', !(await page.locator('#fornecedoresBody').textContent()).includes('Fornecedor Manual PW Teste'));

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
