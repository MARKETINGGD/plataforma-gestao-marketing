// Teste visual (Playwright) da 96ª rodada -- complementa o teste de
// integração catalogoRevisao96.test.js, cobrindo a parte que só existe na
// TELA: o novo submenu "Revisão Catálogo" dentro de Produtos → Catálogo,
// incluindo o "+ Adicionar pessoa" dinâmico.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

process.env.JWT_SECRET = 'teste-catalogo-revisao-96-pw';
process.env.PORT = '4357';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4357';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-catalogo-revisao-96-pw-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

const BASE = 'http://localhost:4357';
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
      body: JSON.stringify({ name: 'Admin PW 96e', username: 'admin', password: '123456' })
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

  await page.click('#navProdutosParent');
  await page.waitForSelector('#navProdutosSubmenu:not([hidden])', { timeout: 5000 });
  check('submenu "Revisão Catálogo" aparece dentro de Produtos', await page.isVisible('#navProdutosRevisaoCatalogo'));
  await page.click('#navProdutosRevisaoCatalogo');
  await page.waitForSelector('#view-produtos-revisao-catalogo:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(300);

  check('lista de planilhas de revisão começa vazia', await page.isVisible('#catalogoRevisaoEmpty'));

  await page.click('#catalogoRevisaoNewBtn');
  await page.waitForSelector('#catalogoRevisaoFormWrap:not([hidden])', { timeout: 5000 });
  check('título do form é "Nova planilha de revisão"', (await page.locator('#catalogoRevisaoFormTitle').textContent()).trim() === 'Nova planilha de revisão');
  check('seção de upload NÃO aparece ainda (planilha nova, sem id)', await page.isHidden('#catalogoRevisaoArquivoSection'));
  check('começa com exatamente 1 campo de pessoa', await page.locator('.catalogo-revisao-pessoa-input').count() === 1);

  // ---------- pedido explícito da Raquel: adicionar VÁRIAS pessoas ----------
  await page.fill('.catalogo-revisao-pessoa-input', 'Raquel');
  await page.click('#catalogoRevisaoAddPessoaBtn');
  await page.waitForTimeout(100);
  check('depois de "+ Adicionar pessoa", aparece um 2º campo', await page.locator('.catalogo-revisao-pessoa-input').count() === 2);
  await page.locator('.catalogo-revisao-pessoa-input').nth(1).fill('Fulano da Equipe PW');
  await page.fill('#catalogoRevisaoFormData', '2026-10-16');

  await page.click('#catalogoRevisaoFormSave');
  await page.waitForFunction(() => document.querySelector('#catalogoRevisaoFormTitle').textContent.trim() === 'Editar planilha de revisão', { timeout: 5000 });
  await page.waitForTimeout(300);
  check('depois de salvar, reabre em modo edição e libera o upload', await page.isVisible('#catalogoRevisaoArquivoSection'));
  check('reabrindo, os 2 campos de pessoa vêm preenchidos de volta', await page.locator('.catalogo-revisao-pessoa-input').count() === 2);

  // ---------- upload do arquivo revisado ----------
  const tmpFile = path.join(__dirname, 'tmp-catalogo-revisado-pw.xlsx');
  fs.writeFileSync(tmpFile, 'conteúdo de teste do arquivo revisado PW');
  await page.setInputFiles('#catalogoRevisaoArquivoInput', tmpFile);
  await page.click('#catalogoRevisaoArquivoUpload');
  await page.waitForFunction(() => /tmp-catalogo-revisado-pw\.xlsx/.test(document.querySelector('#catalogoRevisaoArquivoAtual').textContent), { timeout: 5000 });
  check('depois do upload, mostra o nome do arquivo atual', /tmp-catalogo-revisado-pw\.xlsx/.test(await page.locator('#catalogoRevisaoArquivoAtual').textContent()));
  fs.rmSync(tmpFile, { force: true });

  await page.click('#catalogoRevisaoFormCancel');
  await page.waitForTimeout(200);

  // ---------- tabela mostra a planilha de revisão criada ----------
  check('a lista não está mais vazia', await page.isHidden('#catalogoRevisaoEmpty'));
  const linha = page.locator('#catalogoRevisaoBody tr', { hasText: 'Raquel' });
  check('linha aparece na tabela', await linha.count() === 1);
  const textoLinha = await linha.textContent();
  check('linha mostra as 2 pessoas juntas', /Raquel/.test(textoLinha) && /Fulano da Equipe PW/.test(textoLinha));
  check('linha mostra o link do arquivo revisado', /tmp-catalogo-revisado-pw\.xlsx/.test(textoLinha));

  // ---------- remover uma pessoa (mas nunca a última) ----------
  await linha.locator('button', { hasText: 'Editar' }).click();
  await page.waitForSelector('#catalogoRevisaoFormWrap:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(200);
  await page.locator('.retirada-item-row-remove').nth(0).click();
  await page.waitForTimeout(100);
  check('removeu 1 pessoa, sobrou 1 campo', await page.locator('.catalogo-revisao-pessoa-input').count() === 1);
  await page.locator('.retirada-item-row-remove').nth(0).click();
  await page.waitForTimeout(100);
  check('não deixa remover a ÚLTIMA pessoa (sempre fica pelo menos 1 campo)', await page.locator('.catalogo-revisao-pessoa-input').count() === 1);
  await page.click('#catalogoRevisaoFormCancel');
  await page.waitForTimeout(200);

  // ---------- excluir ----------
  await linha.locator('button.danger').click();
  await page.waitForTimeout(300);
  check('depois de excluir, a lista volta a ficar vazia', await page.isVisible('#catalogoRevisaoEmpty'));

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
