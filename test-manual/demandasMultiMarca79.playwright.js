// Teste visual (Playwright) da 79ª rodada -- complementa o teste de
// integração demandasMultiMarca79.test.js, cobrindo a parte que só
// existe na TELA:
//
//   - o chip-picker de Marcas (marcar mais de uma) no card de Demandas;
//   - o seletor "de qual marca é este item" no checklist aparecendo só
//     quando o card tem MAIS de 1 marca marcada, sumindo se voltar pra 1;
//   - os ícones das marcas aparecendo todos juntos no título do card no
//     quadro Kanban.
//
// Servidor de teste isolado precisa estar rodando em
// http://localhost:4124 (mesmo padrão dos outros testes Playwright desta
// cópia, só noutra porta pra não brigar com o de socialPosts).
const { chromium } = require('playwright');

const BASE = 'http://localhost:4124';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  const setupRes = await fetch(`${BASE}/api/auth/setup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Admin PW', username: 'admin', password: '123456' })
  }).then((r) => r.json());
  const adminToken = setupRes.token;

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
  await page.waitForTimeout(1000);

  await page.click('#navDemandas');
  await page.waitForSelector('#view-demandas:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.click('#demandasNewBtn');
  await page.waitForSelector('#demandaModal:not([hidden])', { timeout: 10000 });

  await page.fill('#demCardTitle', 'Card Playwright 79 multi-marca');

  // ---------- Chip-picker de Marcas: nenhuma marcada no início ----------
  const brandChipsCount = await page.locator('#demCardBrandList .chip-toggle').count();
  check('chip-picker de Marcas renderizou as 4 marcas', brandChipsCount === 4);
  const brandChecklistSelectHiddenAt0 = await page.locator('#demChecklistBrand').isHidden();
  check('com 0 marca, o seletor de marca do checklist começa escondido', brandChecklistSelectHiddenAt0);

  // Marca "De Bacco".
  await page.locator('#demCardBrandList .chip-toggle', { hasText: 'De Bacco' }).click();
  await page.waitForTimeout(150);
  const stillHiddenWith1 = await page.locator('#demChecklistBrand').isHidden();
  check('com 1 marca só, o seletor de marca do checklist continua escondido', stillHiddenWith1);

  // Marca "GhelPlus" também -- agora são 2.
  await page.locator('#demCardBrandList .chip-toggle', { hasText: 'GhelPlus' }).click();
  await page.waitForTimeout(150);
  const visibleWith2 = await page.locator('#demChecklistBrand').isVisible();
  check('com 2 marcas, o seletor "de qual marca é o item" aparece', visibleWith2);
  const brandSelectOptions = await page.locator('#demChecklistBrand option').allTextContents();
  check('o seletor só oferece as marcas do CARD (De Bacco/GhelPlus), não as 4', brandSelectOptions.includes('De Bacco') && brandSelectOptions.includes('GhelPlus')
    && !brandSelectOptions.includes('Duranox') && !brandSelectOptions.includes('Boutique Inox'));

  // ---------- Adiciona um item do checklist já com marca ----------
  await page.fill('#demChecklistInput', 'Arte De Bacco PW');
  await page.selectOption('#demChecklistBrand', 'debacco');
  await page.click('#demChecklistAdd');
  await page.waitForTimeout(300);
  const itemRow = page.locator('.checklist-item', { hasText: 'Arte De Bacco PW' });
  check('item novo apareceu no checklist', await itemRow.count() > 0);
  const itemBrandSelectValue = await itemRow.locator('.checklist-item-brand-select').inputValue();
  check('item novo já nasceu com a marca escolhida (De Bacco)', itemBrandSelectValue === 'debacco');
  const itemBrandSelectVisible = await itemRow.locator('.checklist-item-brand-select').isVisible();
  check('seletor de marca do item existente também está visível (card com 2 marcas)', itemBrandSelectVisible);

  // ---------- Desmarca uma marca -- volta pra 1 só, seletor some de novo ----------
  await page.locator('#demCardBrandList .chip-toggle', { hasText: 'GhelPlus' }).click();
  await page.waitForTimeout(150);
  const hiddenAgainAdd = await page.locator('#demChecklistBrand').isHidden();
  const hiddenAgainItem = await itemRow.locator('.checklist-item-brand-select').isHidden();
  check('voltando pra 1 marca só, o seletor de "novo item" some de novo', hiddenAgainAdd);
  check('voltando pra 1 marca só, o seletor do item já existente some também', hiddenAgainItem);

  // Marca GhelPlus de novo pra salvar o card com as 2 marcas.
  await page.locator('#demCardBrandList .chip-toggle', { hasText: 'GhelPlus' }).click();
  await page.waitForTimeout(150);

  // Marca alguém como responsável (obrigatório no quadro geral).
  const firstAssigneeChip = page.locator('#demAssigneeList .chip-toggle').first();
  if (await firstAssigneeChip.count() > 0) {
    await firstAssigneeChip.locator('input[type="checkbox"]').check();
    await page.waitForTimeout(150);
    await firstAssigneeChip.locator('.chip-responsible-btn').click();
    await page.waitForTimeout(150);
  }

  await page.click('#demCardSave');
  await page.waitForTimeout(1000);

  // ---------- Confirma pela API que o card salvou com as 2 marcas + item com marca ----------
  const savedCard = await fetch(`${BASE}/api/demandas`, { headers: { Authorization: `Bearer ${adminToken}` } })
    .then((r) => r.json()).then((d) => d.demandas.find((x) => x.title === 'Card Playwright 79 multi-marca'));
  check('card salvo de verdade (via API) com as 2 marcas', !!(savedCard && Array.isArray(savedCard.brands) && savedCard.brands.length === 2));
  const savedItem = savedCard && savedCard.checklist.find((it) => it.text === 'Arte De Bacco PW');
  check('item do checklist salvo com a marca certa', !!(savedItem && savedItem.brand === 'debacco'));

  // ---------- Ícones das 2 marcas aparecem juntos no título do card no Kanban ----------
  await page.reload();
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.click('#navDemandas');
  await page.waitForSelector('#view-demandas:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(800);
  const kanbanCard = page.locator('.kanban-card', { hasText: 'Card Playwright 79 multi-marca' }).first();
  const iconCount = await kanbanCard.locator('.kanban-card-title .card-brand-icon').count();
  check('card no Kanban mostra os 2 ícones de marca no título', iconCount === 2);

  check('nenhum erro de console/JS durante o teste', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console encontrados:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
