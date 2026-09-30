// Teste visual (Playwright) da 78ª rodada -- confere na tela de verdade:
//   1. O filtro de busca das Demandas (título, rede, etiqueta, marca,
//      status), aplicado no Quadro Geral.
//   2. Comentar num card e o comentário aparecer no histórico dele.
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

  await page.click('#navDemandas');
  await page.waitForSelector('#view-demandas:not([hidden])');
  await page.waitForTimeout(400);

  const uniq = Date.now();
  const titleA = 'Demanda Instagram Filtro ' + uniq;
  const titleB = 'Demanda YouTube Filtro ' + uniq;

  async function createDemanda(title, network) {
    await page.click('#demandasNewBtn');
    await page.waitForSelector('#demandaModal:not([hidden])');
    await page.fill('#demCardTitle', title);
    await page.selectOption('#demCardNetwork', network);
    // Responsável obrigatório no Quadro Geral -- marca a si mesma (admin).
    await page.click('#demAssigneeList .chip-toggle:first-child input[type="checkbox"]');
    await page.click('#demAssigneeList .chip-toggle:first-child .chip-responsible-btn');
    await page.click('#demCardSave');
    await page.waitForTimeout(400);
    await page.click('#demCardClose');
    await page.waitForTimeout(300);
  }
  await createDemanda(titleA, 'instagram');
  await createDemanda(titleB, 'youtube');

  const allTitlesBefore = await page.$$eval('.kanban-card-title', (els) => els.map((e) => e.textContent));
  check('as 2 demandas de teste aparecem no quadro antes de filtrar', allTitlesBefore.some((t) => t.includes(titleA)) && allTitlesBefore.some((t) => t.includes(titleB)));

  // Filtro por texto.
  await page.fill('#demandasFilterSearch', 'Instagram Filtro ' + uniq);
  await page.waitForTimeout(200);
  const titlesAfterSearch = await page.$$eval('.kanban-card-title', (els) => els.map((e) => e.textContent));
  check('busca por texto mostra só a demanda do Instagram', titlesAfterSearch.some((t) => t.includes(titleA)) && !titlesAfterSearch.some((t) => t.includes(titleB)));
  await page.fill('#demandasFilterSearch', '');
  await page.waitForTimeout(200);

  // Filtro por rede.
  await page.selectOption('#demandasFilterNetwork', 'youtube');
  await page.waitForTimeout(200);
  const titlesAfterNetwork = await page.$$eval('.kanban-card-title', (els) => els.map((e) => e.textContent));
  check('filtro de rede (YouTube) mostra só a demanda certa', titlesAfterNetwork.some((t) => t.includes(titleB)) && !titlesAfterNetwork.some((t) => t.includes(titleA)));

  await page.click('#demandasFilterClear');
  await page.waitForTimeout(200);
  const titlesAfterClear = await page.$$eval('.kanban-card-title', (els) => els.map((e) => e.textContent));
  check('"Limpar filtros" volta a mostrar as 2 demandas', titlesAfterClear.some((t) => t.includes(titleA)) && titlesAfterClear.some((t) => t.includes(titleB)));

  // Filtro por status.
  await page.selectOption('#demandasFilterStatus', 'concluida');
  await page.waitForTimeout(200);
  const titlesAfterStatus = await page.$$eval('.kanban-card-title', (els) => els.map((e) => e.textContent));
  check('filtro de status "Concluída" não mostra as demandas recém-criadas (ainda A Fazer)', !titlesAfterStatus.some((t) => t.includes(titleA)) && !titlesAfterStatus.some((t) => t.includes(titleB)));
  await page.click('#demandasFilterClear');
  await page.waitForTimeout(200);

  // ---------- Comentários ----------
  const cardTitleEl = await page.$$('.kanban-card-title');
  let targetCard = null;
  for (const el of cardTitleEl) {
    const t = await el.textContent();
    if (t.includes(titleA)) { targetCard = el; break; }
  }
  await targetCard.click();
  await page.waitForSelector('#demandaModal:not([hidden])');
  check('caixa de comentário aparece no card já existente', await page.isVisible('#demCommentWrap'));
  const comentarioTexto = 'Comentário de teste ' + uniq;
  await page.fill('#demCommentInput', comentarioTexto);
  await page.click('#demCommentAdd');
  await page.waitForTimeout(500);

  const historyTexts = await page.$$eval('#demHistory .history-row', (rows) => rows.map((r) => r.textContent));
  check('comentário aparece no histórico do card (ação "comentou")', historyTexts.some((t) => t.includes('comentou')));
  check('texto do comentário aparece no histórico', historyTexts.some((t) => t.includes(comentarioTexto)));
  check('caixa de comentário limpa depois de enviar', (await page.inputValue('#demCommentInput')) === '');

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
