// Teste visual (Playwright) da 96ª rodada -- complementa o teste de
// integração brindesSaidaEditarMultimarca96.test.js, cobrindo a parte
// que só existe na TELA: o formulário "Registrar saída" agora tem um
// seletor de MARCA por item (não mais um campo único pro registro
// inteiro), dá pra misturar itens de marcas diferentes na mesma lista, e
// as linhas da tabela ganharam um botão "Editar" de verdade.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

process.env.JWT_SECRET = 'teste-brindes-saida-multimarca-96-pw';
process.env.PORT = '4353';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4353';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-brindes-saida-multimarca-96-pw-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

const BASE = 'http://localhost:4353';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

// `selectOption({ label: /regex/ })` não existe no Playwright (label
// precisa ser string exata) -- acha o <option> certo por regex na mão e
// seleciona pelo value.
async function selectOptionByLabelRegex(page, selector, regex) {
  const value = await page.locator(`${selector} option`).evaluateAll((opts, pattern) => {
    const re = new RegExp(pattern);
    const match = opts.find((o) => re.test(o.textContent));
    return match ? match.value : null;
  }, regex.source);
  if (!value) throw new Error(`opção não encontrada em ${selector} com padrão ${regex}`);
  await page.selectOption(selector, value);
}

async function run() {
  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  if (statusRes.needsSetup) {
    await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin PW 96', username: 'admin', password: '123456' })
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
  await page.click('[data-brindes-tab="log"]');
  await page.waitForSelector('#brindesLogWrap:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(300);

  await page.click('#brindesLogNewBtn');
  await page.waitForSelector('#brindeLogFormWrap:not([hidden])', { timeout: 5000 });
  check('título do formulário é "Registrar saída" (modo novo)', (await page.textContent('#brindeLogFormTitle')).trim() === 'Registrar saída');
  check('não existe mais um campo único de Marca pro registro inteiro', (await page.locator('#brindeLogFormBrand').count()) === 0);
  check('existe o seletor de Marca DO ITEM', await page.isVisible('#brindeLogFormItemBrand'));

  await page.fill('#brindeLogFormRepresentante', 'Representante PW');
  await page.fill('#brindeLogFormCliente', 'Cliente Misto PW');

  // Adiciona um item de De Bacco (marca default do seletor de item).
  await page.selectOption('#brindeLogFormItemBrand', 'debacco');
  await page.waitForTimeout(150);
  await selectOptionByLabelRegex(page, '#brindeLogFormItemSelect', /Avental/);
  await page.fill('#brindeLogFormQuantidade', '2');
  await page.click('#brindeLogFormAddItemBtn');
  await page.waitForTimeout(150);

  // Troca pra GhelPlus e adiciona outro item, na MESMA saída.
  await page.selectOption('#brindeLogFormItemBrand', 'ghelplus');
  await page.waitForTimeout(150);
  await selectOptionByLabelRegex(page, '#brindeLogFormItemSelect', /Copo Stanley/);
  await page.fill('#brindeLogFormQuantidade', '4');
  await page.click('#brindeLogFormAddItemBtn');
  await page.waitForTimeout(150);

  const pendingRows = await page.locator('#brindeLogFormItemsList .retirada-item-row').allTextContents();
  check('a lista de itens do rascunho mostra os 2 itens, cada um com sua marca', pendingRows.length === 2 && /De Bacco/.test(pendingRows[0]) && /GhelPlus/.test(pendingRows[1]));

  await page.click('#brindeLogFormSave');
  await page.waitForFunction(() => document.querySelector('#brindeLogFormWrap').hidden, { timeout: 5000 });
  await page.waitForTimeout(300);

  const novaLinha = page.locator('#brindesLogBody tr', { hasText: 'Cliente Misto PW' });
  check('a saída mista aparece na tabela', await novaLinha.count() === 1);
  const marcaCell = await novaLinha.locator('td').nth(0).textContent();
  check('coluna "Marca" mostra as 2 marcas juntas ("De Bacco + GhelPlus")', /De Bacco/.test(marcaCell) && /GhelPlus/.test(marcaCell));
  const itensCell = await novaLinha.locator('td').nth(4).textContent();
  check('coluna "Itens" mostra os 2 itens com as quantidades certas', /Avental \(x2\)/.test(itensCell) && /Copo Stanley[^(]*\(x4\)/.test(itensCell));

  // ---------- Editar ----------
  const editBtn = novaLinha.locator('button', { hasText: 'Editar' });
  check('a linha tem um botão "Editar" de verdade', await editBtn.count() === 1);
  await editBtn.click();
  await page.waitForSelector('#brindeLogFormWrap:not([hidden])', { timeout: 5000 });
  check('título do formulário vira "Editar saída" (modo edição)', (await page.textContent('#brindeLogFormTitle')).trim() === 'Editar saída');
  const prefillRows = await page.locator('#brindeLogFormItemsList .retirada-item-row').allTextContents();
  check('abrir pra editar já vem com os 2 itens da saída pré-carregados', prefillRows.length === 2);
  check('representante/cliente vêm pré-preenchidos', (await page.inputValue('#brindeLogFormRepresentante')) === 'Representante PW' && (await page.inputValue('#brindeLogFormCliente')) === 'Cliente Misto PW');

  await page.fill('#brindeLogFormMotivo', 'Motivo editado via Playwright');
  await page.click('#brindeLogFormSave');
  await page.waitForFunction(() => document.querySelector('#brindeLogFormWrap').hidden, { timeout: 5000 });
  await page.waitForTimeout(300);

  const linhaEditada = page.locator('#brindesLogBody tr', { hasText: 'Cliente Misto PW' });
  const motivoCell = await linhaEditada.locator('td').nth(5).textContent();
  check('motivo editado aparece na tabela depois de salvar', motivoCell.trim() === 'Motivo editado via Playwright');
  const marcaCellDepois = await linhaEditada.locator('td').nth(0).textContent();
  check('editar só o motivo não mexeu nas marcas da saída', /De Bacco/.test(marcaCellDepois) && /GhelPlus/.test(marcaCellDepois));
  // Banco de teste já vinha com um admin pré-existente (named "Admin
  // Teste", de um setup anterior) -- não dava pra supor o nome "Admin PW
  // 96" do fetch de setup acima (só roda se needsSetup for true). O que
  // importa aqui é que a coluna tem um NOME + data/hora de verdade (o
  // formato de lastEditLabel), não mais "—".
  const autoriaCell = await linhaEditada.locator('td').nth(6).textContent();
  check('coluna "Última atualização" mostra nome + data/hora de quem editou (não "—")', autoriaCell.trim() !== '—' && autoriaCell.includes('·'));

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
