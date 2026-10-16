// Teste visual (Playwright) da 96ª rodada -- complementa o teste de
// integração produtosForaLinhaComunicados96.test.js, cobrindo a parte que
// só existe na TELA: o novo submenu "Produtos fora de linha" (aba
// Comunicados) dentro de Produtos.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

process.env.JWT_SECRET = 'teste-produtos-fora-linha-96-pw';
process.env.PORT = '4356';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4356';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-produtos-fora-linha-96-pw-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

const BASE = 'http://localhost:4356';
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
      body: JSON.stringify({ name: 'Admin PW 96d', username: 'admin', password: '123456' })
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
  check('submenu "Produtos fora de linha" aparece dentro de Produtos', await page.isVisible('#navProdutosForaLinha'));
  await page.click('#navProdutosForaLinha');
  await page.waitForSelector('#view-produtos-fora-linha:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(300);

  check('aba "Comunicados" aparece ativa', await page.locator('.tab-btn[data-fora-linha-tab="comunicados"]').evaluate((el) => el.classList.contains('active')));
  check('lista de comunicados começa vazia', await page.isVisible('#comunicadosEmpty'));

  // ---------- cria um novo comunicado ----------
  await page.click('#comunicadosNewBtn');
  await page.waitForSelector('#comunicadosFormWrap:not([hidden])', { timeout: 5000 });
  check('título do form é "Novo comunicado"', (await page.locator('#comunicadosFormTitle').textContent()).trim() === 'Novo comunicado');
  check('seção de upload de arquivo NÃO aparece ainda (comunicado novo, sem id)', await page.isHidden('#comunicadosFormArquivoSection'));
  await page.fill('#comunicadosFormNome', 'Comunicado Teste PW');
  await page.fill('#comunicadosFormData', '2026-10-15');
  await page.fill('#comunicadosFormDescricao', 'Descrição de teste do comunicado.');
  await page.click('#comunicadosFormSave');
  await page.waitForFunction(() => document.querySelector('#comunicadosFormTitle').textContent.trim() === 'Editar comunicado', { timeout: 5000 });
  await page.waitForTimeout(300);
  check('depois de salvar, reabre em modo edição e libera o upload', await page.isVisible('#comunicadosFormArquivoSection'));

  // ---------- upload de arquivo ----------
  const tmpFile = path.join(__dirname, 'tmp-comunicado-pw.txt');
  fs.writeFileSync(tmpFile, 'conteúdo de teste do comunicado PW');
  await page.setInputFiles('#comunicadosFormArquivoInput', tmpFile);
  await page.click('#comunicadosFormArquivoUpload');
  await page.waitForFunction(() => /tmp-comunicado-pw\.txt/.test(document.querySelector('#comunicadosFormArquivoAtual').textContent), { timeout: 5000 });
  check('depois do upload, mostra o nome do arquivo atual', /tmp-comunicado-pw\.txt/.test(await page.locator('#comunicadosFormArquivoAtual').textContent()));
  fs.rmSync(tmpFile, { force: true });

  await page.click('#comunicadosFormCancel');
  await page.waitForTimeout(200);

  // ---------- tabela mostra o comunicado criado ----------
  check('a lista não está mais vazia', await page.isHidden('#comunicadosEmpty'));
  const linhaComunicado = page.locator('#comunicadosBody tr', { hasText: 'Comunicado Teste PW' });
  check('linha do comunicado aparece na tabela', await linhaComunicado.count() === 1);
  const textoLinha = await linhaComunicado.textContent();
  check('linha mostra a descrição', /Descrição de teste do comunicado/.test(textoLinha));
  check('linha mostra o link do arquivo anexado', /tmp-comunicado-pw\.txt/.test(textoLinha));

  // ---------- excluir ----------
  await linhaComunicado.locator('button.danger').click();
  await page.waitForTimeout(300);
  check('depois de excluir, a lista volta a ficar vazia', await page.isVisible('#comunicadosEmpty'));

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
