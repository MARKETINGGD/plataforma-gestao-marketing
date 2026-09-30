// Teste visual (Playwright) da 78ª rodada -- confere na tela de verdade:
//   1. Cadastro de um expositor orçado, upload de imagem (aparece como
//      capa ao lado do nome), fornecedores comparados e a marcação de
//      "escolhido".
//   2. Filtro por modelo em Orçamentos e no Controle de Expositores
//      (dentro da Papoi).
// Servidor de teste isolado precisa estar rodando em http://localhost:4123.
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  page.on('dialog', (d) => d.accept());
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });

  await page.click('#navExpositoresParent');
  await page.click('#navExpositoresOrcamentos');
  await page.waitForSelector('#view-expositores-orcamentos:not([hidden])');
  await page.waitForTimeout(300);

  const uniq = Date.now();
  const nome = 'Expositor UI 78 ' + uniq;
  await page.click('#expositoresOrcamentosNewBtn');
  await page.waitForSelector('#expositoresOrcamentosFormWrap:not([hidden])');
  await page.fill('#expositoresOrcamentosFormNome', nome);
  await page.fill('#expositoresOrcamentosFormAno', '2026');
  await page.click('#expositoresOrcamentosFormSave');
  await page.waitForTimeout(500);
  check('formulário fecha depois de salvar (sem erro)', await page.isHidden('#expositoresOrcamentosFormWrap'));

  const cardTitles = await page.$$eval('.compare-card-head h4', (els) => els.map((e) => e.textContent));
  check('expositor novo aparece na lista', cardTitles.some((t) => t === nome));

  // Abre os detalhes.
  const card = page.locator('[data-orc-card]', { has: page.locator('h4', { hasText: nome }) });
  await card.locator('[data-toggle-orc]').click();
  await page.waitForTimeout(300);
  check('detalhes mostram os campos de imagem, desenho técnico e fornecedores', (await card.textContent()).includes('Empresas orçadas'));

  // Upload de imagem (via input de arquivo).
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const tmpImg = path.join(os.tmpdir(), 'orc-teste-' + uniq + '.png');
  fs.writeFileSync(tmpImg, Buffer.from([137, 80, 78, 71]));
  await card.locator('input[data-upload-imagens]').setInputFiles(tmpImg);
  await page.waitForTimeout(500);

  const cardAfterImg = page.locator('[data-orc-card]', { has: page.locator('h4', { hasText: nome }) });
  check('depois do upload, a capa (imagem ao lado do nome) aparece no cabeçalho do card', await cardAfterImg.locator('.compare-card-head img').count() > 0);

  // Adiciona 2 fornecedores e marca um como escolhido (os detalhes
  // continuam abertos depois do upload -- expandir/recolher só muda
  // quando alguém clica em "Ver detalhes"/"Ocultar detalhes").
  let cardNow = page.locator('[data-orc-card]', { has: page.locator('h4', { hasText: nome }) });
  async function addFornecedor(nomeF, valor) {
    const addRow = cardNow.locator('[data-fornecedor-add]');
    await addRow.locator('[data-f-fornecedor]').fill(nomeF);
    await addRow.locator('[data-f-valor]').fill(String(valor));
    await addRow.locator('[data-f-material]').fill('Material teste');
    await addRow.locator('[data-f-prazo]').fill('10 dias');
    await addRow.locator('[data-f-pedido]').fill('1 unidade');
    await addRow.locator('[data-add-fornecedor]').click();
    await page.waitForTimeout(500);
  }
  await addFornecedor('Fornecedor UI A', 100);
  cardNow = page.locator('[data-orc-card]', { has: page.locator('h4', { hasText: nome }) });
  await addFornecedor('Fornecedor UI B', 200);
  cardNow = page.locator('[data-orc-card]', { has: page.locator('h4', { hasText: nome }) });

  const fornecedorRows = await cardNow.locator('tbody[data-fornecedores-body] tr').count();
  check('os 2 fornecedores aparecem na planilha comparativa', fornecedorRows === 2);

  await cardNow.locator('tr', { hasText: 'Fornecedor UI B' }).locator('[data-escolher-fornecedor]').click();
  await page.waitForTimeout(500);
  cardNow = page.locator('[data-orc-card]', { has: page.locator('h4', { hasText: nome }) });
  const escolhidoText = await cardNow.locator('tr', { hasText: 'Fornecedor UI B' }).textContent();
  check('Fornecedor B aparece marcado como "Escolhido"', escolhidoText.includes('Escolhido'));
  const outroText = await cardNow.locator('tr', { hasText: 'Fornecedor UI A' }).textContent();
  check('Fornecedor A NÃO está marcado como escolhido', !outroText.includes('✓ Escolhido'));

  // ---------- Filtro por modelo (Orçamentos) ----------
  await page.fill('#expositoresOrcamentosModeloFilter', 'UI 78 ' + uniq);
  await page.waitForTimeout(200);
  const titlesFiltered = await page.$$eval('.compare-card-head h4', (els) => els.map((e) => e.textContent));
  check('filtro por modelo em Orçamentos encontra o expositor certo', titlesFiltered.some((t) => t === nome));
  await page.fill('#expositoresOrcamentosModeloFilter', 'termo-que-nao-existe-xyz');
  await page.waitForTimeout(200);
  const titlesEmpty = await page.$$eval('.compare-card-head h4', (els) => els.map((e) => e.textContent));
  check('filtro por modelo sem resultado esconde o expositor', !titlesEmpty.some((t) => t === nome));
  await page.fill('#expositoresOrcamentosModeloFilter', '');

  // ---------- Filtro por modelo (Controle de Expositores) ----------
  await page.click('#navExpositoresEstoque');
  await page.waitForSelector('#view-expositores-estoque:not([hidden])');
  await page.waitForTimeout(400);
  check('filtro por modelo aparece no Controle de Expositores', await page.isVisible('#expositoresEstoqueModeloFilter'));
  const rowsBefore = await page.$$eval('#expositoresEstoqueBody tr', (rows) => rows.length);
  await page.fill('#expositoresEstoqueModeloFilter', 'Cubas');
  await page.waitForTimeout(300);
  const rowsAfter = await page.$$eval('#expositoresEstoqueBody tr', (rows) => rows.length);
  check('filtrar por "Cubas" reduz a lista (achou pelo menos 1, mas não todos)', rowsAfter > 0 && rowsAfter < rowsBefore);
  const descricoesFiltradas = await page.$$eval('#expositoresEstoqueBody tr', (rows) => rows.map((r) => r.textContent));
  check('todas as linhas filtradas realmente citam "Cubas"', descricoesFiltradas.every((t) => /cubas/i.test(t)));

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  console.log('Console errors:', consoleErrors.length ? consoleErrors : 'nenhum');
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
