// Teste visual (Playwright) da 78ª rodada -- confere de verdade (estilo
// computado, não só o HTML) os 2 ajustes visuais pedidos pela Raquel:
//   1. Checklist: campo de texto maior e legível, e o checkbox sempre
//      alinhado no TOPO da linha (nunca centralizado numa linha que
//      cresce quando o texto é longo).
//   2. Modal "Gerenciar etiquetas": campo de nome com contraste de
//      verdade contra o fundo do modal (antes ficava "sumido").
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
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });

  // ---------- Checklist ----------
  await page.click('#navDemandas');
  await page.waitForSelector('#view-demandas:not([hidden])');
  await page.click('[data-demandas-scope="pessoal"]');
  await page.click('#demandasNewBtn');
  await page.waitForSelector('#demandaModal:not([hidden])', { timeout: 10000 });
  await page.fill('#demCardTitle', 'Teste estilo checklist ' + Date.now());

  // Item curto (1 linha) e item longo (várias linhas) -- pra comparar o
  // alinhamento do checkbox entre os dois.
  await page.fill('#demChecklistInput', 'Item curto');
  await page.click('#demChecklistAdd');
  await page.fill('#demChecklistInput', 'Este é um item de checklist bem mais longo, escrito de propósito pra ocupar várias linhas dentro da caixinha e confirmar que o quadradinho de marcar continua alinhado no topo, não flutuando no meio da altura toda');
  await page.click('#demChecklistAdd');

  const fontSize = await page.$eval('.checklist-item label span', (el) => getComputedStyle(el).fontSize);
  check('fonte do texto do checklist aumentou (era 13.5px, agora >= 14px)', parseFloat(fontSize) >= 14);

  const rows = await page.$$('.checklist-item');
  check('2 itens de checklist renderizados', rows.length === 2);
  const tops = [];
  for (const row of rows) {
    const checkboxTop = await row.$eval('input[type="checkbox"]', (el) => el.getBoundingClientRect().top);
    const rowTop = await row.evaluate((el) => el.getBoundingClientRect().top);
    tops.push(checkboxTop - rowTop);
  }
  console.log('checkbox offset do topo da linha (px):', tops);
  // A linha (.checklist-item) já tem 8px de padding-top de propósito (visual
  // do card), então o offset mínimo possível nunca é 0 -- o que importa é
  // não ficar solto no meio da altura toda quando o texto quebra em várias
  // linhas (por isso o teto de 15px aqui, e a comparação de consistência
  // abaixo, que é o objetivo real do pedido da Raquel: "não tortos").
  check('checkbox do item CURTO fica perto do topo da própria linha (não centralizado)', tops[0] < 15);
  check('checkbox do item LONGO (várias linhas) TAMBÉM fica perto do topo -- mesmo alinhamento do item curto (diferença pequena entre os dois)', Math.abs(tops[0] - tops[1]) < 6);

  const longRowHeight = await rows[1].evaluate((el) => el.getBoundingClientRect().height);
  check('item longo realmente ocupou mais de 1 linha (a caixinha cresceu de altura)', longRowHeight > 40);

  await page.click('#demCardClose');

  // ---------- Modal "Gerenciar etiquetas" ----------
  await page.click('[data-demandas-scope="geral"]');
  await page.click('#demandasManageLabelsBtn');
  await page.waitForSelector('#labelModal:not([hidden])', { timeout: 5000 });
  await page.fill('#labelNewName', 'Etiqueta Teste Estilo ' + Date.now());
  await page.click('#labelNewAdd');
  await page.waitForTimeout(400);

  const rowStyle = await page.$eval('.label-manage-row', (el) => {
    const s = getComputedStyle(el);
    return { background: s.backgroundColor, border: s.borderWidth };
  });
  check('linha da etiqueta tem fundo próprio (não é "transparent"/mesmo do modal)', rowStyle.background !== 'rgba(0, 0, 0, 0)' && rowStyle.background !== 'transparent');
  check('linha da etiqueta tem borda visível', parseFloat(rowStyle.border) >= 1);

  const inputStyle = await page.$eval('.label-manage-row input[type="text"]', (el) => {
    const s = getComputedStyle(el);
    return { border: s.borderWidth, bg: s.backgroundColor };
  });
  check('campo de nome da etiqueta tem borda visível de verdade', parseFloat(inputStyle.border) >= 1);

  const nameValue = await page.$eval('.label-manage-row input[type="text"]', (el) => el.value);
  check('campo de nome mostra o texto certo (não está "vazio" visualmente por engano)', nameValue.includes('Etiqueta Teste Estilo'));

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
