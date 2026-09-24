// Regressão Playwright (62ª rodada, pedido direto da Raquel: "No controle
// geral dos brindes, em catálogo, são várias pessoas que fazem a
// atualização, por isso precisa ter como colocar a data da última
// atualização do estoque e quem atualizou, isso para cada região (PR, PE,
// SP)"). Cria um item novo no catálogo, edita só o estoque de uma praça
// (PR) e confere que: (1) só aquela praça ganha o carimbo de data/quem
// (as outras continuam sem "ⓘ", já que não foram tocadas), (2) editar de
// novo outra praça (SP) sem mudar PR não apaga o carimbo já feito em PR,
// (3) editar um campo que não é de estoque (ex.: "obs"/"status") não
// carimba nenhuma praça.
// Servidor de teste isolado precisa estar rodando em
// http://localhost:4123 (mesmo padrão dos outros testes Playwright).
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

// Sufixo por execução -- evita colidir com um item de uma rodada anterior
// do teste que, por algum motivo (falha no meio, Ctrl+C), não tenha sido
// limpo no fim.
const ITEM_NAME = '[Teste 62ª rodada] Item de estoque ' + Date.now();

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  try {
    await page.goto(BASE);
    await page.fill('#loginUsername', 'admin');
    await page.fill('#loginPassword', '123456');
    await page.click('#loginSubmit');
    await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
    await page.waitForSelector('#reisMarketingChart .reis-bar-col', { timeout: 15000 });

    await page.click('#navBrindesParent');
    await page.click('#navBrindesControleGeral');
    await page.waitForSelector('#view-brindes:not([hidden])', { timeout: 10000 });
    await page.waitForSelector('#brindesCatalogWrap:not([hidden])', { timeout: 10000 });

    // Cria um item de teste novo (nasce sem nenhum carimbo de praça).
    await page.click('#brindesCatalogNewBtn');
    await page.waitForSelector('#brindeFormWrap:not([hidden])', { timeout: 5000 });
    await page.fill('#brindeFormItem', ITEM_NAME);
    await page.fill('#brindeFormEstoquePR', '10');
    await page.fill('#brindeFormEstoqueSP', '20');
    await page.fill('#brindeFormEstoquePE', '30');
    await page.click('#brindeFormSave');
    await page.waitForSelector('#brindeFormWrap', { state: 'hidden', timeout: 5000 });

    const testRow = page.locator('#brindesCatalogBody tr', { hasText: ITEM_NAME });
    await testRow.waitFor({ timeout: 5000 });
    check('item novo nasce sem nenhum "ⓘ" de carimbo em nenhuma praça', (await testRow.locator('.stock-updated-hint').count()) === 0);

    // Edita só o estoque de PR (de 10 pra 15) -- só essa praça deve ganhar
    // o carimbo.
    await testRow.locator('button', { hasText: 'Editar' }).click();
    await page.waitForSelector('#brindeFormWrap:not([hidden])', { timeout: 5000 });
    await page.fill('#brindeFormEstoquePR', '15');
    await page.click('#brindeFormSave');
    await page.waitForSelector('#brindeFormWrap', { state: 'hidden', timeout: 5000 });
    await testRow.waitFor({ timeout: 5000 });

    const hintsAfterPR = await testRow.locator('.stock-updated-hint').count();
    check('depois de mudar só o estoque PR, exatamente 1 praça ganha o "ⓘ"', hintsAfterPR === 1);
    const prCellText = await testRow.locator('td').nth(4).textContent();
    check('a célula de PR mostra o "ⓘ" (a que foi mudada)', prCellText.includes('ⓘ'));
    const spCellTextBefore = await testRow.locator('td').nth(5).textContent();
    check('a célula de SP continua sem "ⓘ" (não foi tocada)', !spCellTextBefore.includes('ⓘ'));
    const prTitle = await testRow.locator('td').nth(4).locator('.stock-updated-hint').getAttribute('title');
    check('a dica de PR menciona quem atualizou (Admin Teste)', /Admin Teste/.test(prTitle || ''));
    check('a dica de PR menciona "Atualizado por"', /Atualizado por/.test(prTitle || ''));

    // Edita SP também (de 20 pra 25) -- PR deve continuar com o carimbo de
    // antes (não é apagado só porque outro campo do mesmo card mudou).
    await testRow.locator('button', { hasText: 'Editar' }).click();
    await page.waitForSelector('#brindeFormWrap:not([hidden])', { timeout: 5000 });
    await page.fill('#brindeFormEstoqueSP', '25');
    await page.click('#brindeFormSave');
    await page.waitForSelector('#brindeFormWrap', { state: 'hidden', timeout: 5000 });
    await testRow.waitFor({ timeout: 5000 });

    const hintsAfterSP = await testRow.locator('.stock-updated-hint').count();
    check('depois de mudar o estoque SP também, agora são 2 praças com "ⓘ" (PR continua, SP ganhou)', hintsAfterSP === 2);

    // Edita só o campo "Status" (não é estoque) -- não deve mexer em
    // nenhum carimbo de praça (continuam as mesmas 2 de antes, PE nunca
    // foi tocado).
    await testRow.locator('button', { hasText: 'Editar' }).click();
    await page.waitForSelector('#brindeFormWrap:not([hidden])', { timeout: 5000 });
    await page.fill('#brindeFormStatus', 'ok');
    await page.click('#brindeFormSave');
    await page.waitForSelector('#brindeFormWrap', { state: 'hidden', timeout: 5000 });
    await testRow.waitFor({ timeout: 5000 });

    const hintsAfterStatus = await testRow.locator('.stock-updated-hint').count();
    check('editar um campo que não é de estoque não mexe nos carimbos (continuam 2)', hintsAfterStatus === 2);
    const peCellText = await testRow.locator('td').nth(6).textContent();
    check('PE nunca foi editado -- continua sem "ⓘ"', !peCellText.includes('ⓘ'));

    check('nenhum erro de console em toda a navegação', consoleErrors.length === 0);
    if (consoleErrors.length) console.log('Erros de console:', consoleErrors);
  } finally {
    // Limpa o item de teste direto pela API (mais confiável que clicar em
    // "Excluir" + responder o confirm() nativo do navegador) -- roda mesmo
    // se algum check acima tiver falhado, pra nunca deixar lixo de teste
    // no catálogo de verdade.
    await page.evaluate(async (name) => {
      const token = localStorage.getItem('token');
      const headers = { Authorization: 'Bearer ' + token };
      const res = await fetch('/api/brindes/catalog', { headers });
      const data = await res.json();
      const item = (data.items || []).find((it) => it.item === name);
      if (item) await fetch('/api/brindes/catalog/' + item.id, { method: 'DELETE', headers });
    }, ITEM_NAME).catch(() => {});
    await browser.close();
  }

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
