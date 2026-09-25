// Teste visual (Playwright) do editor de texto rico (76ª rodada, pedido
// literal da Raquel: "em agendamento, no brienfing deve ter a opção de
// colocar a fonte em itálico, negrito e colorido (em algumas partes do
// texto, sempre onde estiver selecionado)... em demandas, dentro dos cards,
// deve ter a opção de tbm colocar"). Servidor de teste isolado precisa
// estar rodando em http://localhost:4123, já com um usuário "admin"/"123456".
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

// Digita um texto no editor e seleciona um trecho dele (via Selection API,
// dentro da página) -- mais confiável que arrastar o mouse num teste
// automatizado.
async function typeAndSelect(page, editorSelector, fullText, selectStart, selectEnd) {
  await page.click(editorSelector);
  await page.keyboard.type(fullText);
  await page.evaluate(({ sel, start, end }) => {
    const el = document.querySelector(sel);
    const textNode = el.firstChild;
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, { sel: editorSelector, start: selectStart, end: selectEnd });
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') { consoleErrors.push(msg.text()); console.log('[console.error]', msg.text()); } });
  page.on('pageerror', (err) => { consoleErrors.push(String(err)); console.log('[pageerror]', String(err)); });

  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });

  // ---------- Demandas: negrito/itálico/cor num trecho selecionado ----------
  await page.click('#navDemandas');
  await page.waitForSelector('#view-demandas:not([hidden])');
  // "Minha Área Pessoal" não exige escolher responsável pra salvar (o
  // Quadro Geral exige) -- mais simples pra este teste, que não precisa
  // testar essa regra de novo (já coberta noutro teste).
  await page.click('[data-demandas-scope="pessoal"]');
  await page.click('#demandasNewBtn');
  await page.waitForSelector('#demandaModal:not([hidden])', { timeout: 10000 });
  await page.waitForSelector('#demCardDescription', { timeout: 10000 });
  await page.fill('#demCardTitle', 'Teste texto rico ' + Date.now());

  await typeAndSelect(page, '#demCardDescription', 'ola mundo teste', 4, 9); // seleciona "mundo"
  await page.click('[data-richtext-toolbar-for="demCardDescription"] [data-richtext-bold]');
  const boldHtml = await page.$eval('#demCardDescription', (el) => el.innerHTML);
  check('Demandas: negrito aplicado só no trecho selecionado ("mundo" vira <b>)', /<b>\s*mundo\s*<\/b>/i.test(boldHtml) && boldHtml.includes('ola ') && boldHtml.includes(' teste'));

  await page.evaluate(() => {
    const el = document.querySelector('#demCardDescription');
    const textNode = el.lastChild;
  });
  // Seleciona a palavra "teste" (depois do <b>mundo</b>) pra testar itálico.
  await page.evaluate(() => {
    const el = document.querySelector('#demCardDescription');
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.textContent.indexOf('teste');
      if (idx !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + 5);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        break;
      }
    }
  });
  await page.click('[data-richtext-toolbar-for="demCardDescription"] [data-richtext-italic]');
  const italicHtml = await page.$eval('#demCardDescription', (el) => el.innerHTML);
  check('Demandas: itálico aplicado só no trecho selecionado ("teste" vira <i>)', /<i>\s*teste\s*<\/i>/i.test(italicHtml));

  console.log('HTML final da Descrição:', italicHtml);

  // ---------- Sanitização: nada além de b/i/span[color]/br/div sobrevive ----------
  // Simula alguém colando HTML malicioso direto no editor (bypass da
  // digitação normal, ex.: colar de outro site) e confere que
  // getRichTextValue() (chamado por #demCardSave, ver app.js) tira a tag
  // <script>/atributo onclick ANTES de mandar pro servidor -- intercepta a
  // chamada de verdade (POST /api/demandas) e olha o corpo exato que saiu
  // do navegador, em vez de confiar em reabrir a tela depois (mais direto
  // e não depende de nenhuma coluna/filtro do quadro pra achar o card de
  // novo).
  await page.evaluate(() => {
    document.querySelector('#demCardDescription').innerHTML = 'texto <script>alert(1)</script> normal <b onclick="alert(2)">negrito</b> fim';
  });
  let sentBody = null;
  await page.route('**/api/demandas', async (route) => {
    if (route.request().method() === 'POST') {
      sentBody = route.request().postDataJSON();
    }
    await route.continue();
  });
  await page.click('#demCardSave');
  await page.waitForTimeout(800);
  check('sanitização: a chamada de salvar foi capturada', !!sentBody);
  const sentDescription = (sentBody && sentBody.description) || '';
  console.log('description mandada pro servidor:', sentDescription);
  check('sanitização: <script> NUNCA sobrevive no que é mandado pro servidor', !sentDescription.includes('<script'));
  check('sanitização: atributo onclick NUNCA sobrevive no que é mandado pro servidor', !sentDescription.includes('onclick'));
  check('sanitização: o texto normal ao redor continua intacto', sentDescription.includes('texto') && sentDescription.includes('normal') && sentDescription.includes('fim'));

  await page.click('#demCardClose');
  await page.waitForSelector('#demandaModal', { state: 'hidden', timeout: 10000 });

  // ---------- Agendamento: mesma coisa no Briefing (só a aplicação, sem
  // depender de outros campos obrigatórios do formulário pra salvar) ----------
  await page.click('#navAgendamento');
  await page.waitForSelector('#view-agendamento:not([hidden])');
  await page.click('#socialPostNewBtn');
  await page.waitForSelector('#socialPostFormBriefingText', { timeout: 10000 });

  await typeAndSelect(page, '#socialPostFormBriefingText', 'briefing de teste aqui', 12, 17); // seleciona "teste"
  await page.click('[data-richtext-toolbar-for="socialPostFormBriefingText"] [data-richtext-bold]');
  const briefingBoldHtml = await page.$eval('#socialPostFormBriefingText', (el) => el.innerHTML);
  console.log('HTML do Briefing:', briefingBoldHtml);
  check('Agendamento: negrito aplicado só no trecho selecionado do Briefing ("teste" vira <b>)', /<b>\s*teste\s*<\/b>/i.test(briefingBoldHtml));

  check('nenhum erro de console/página em toda a navegação', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
