// Regressão Playwright (65ª rodada, "Rodada G" da Pendência 51, pedido
// direto da Raquel: "todos os relatorios de dash, do papoi... devem ter
// a opção de baixar em PDF o relatório ou em excel... as abas budget,
// [...] devem gerar..." e "na aba cronograma, ao lado de previa do feed,
// deve ter um relatorio mensal do cronograma mes a mes"). Confere que:
// - o relatório mensal do Cronograma existe, mostra os posts do ano
//   selecionado agrupados por mês, e a navegação por ano funciona;
// - os botões "Exportar Excel" do relatório, do Budget, do catálogo de
//   Brindes e da Campanha Cooperada baixam um arquivo .xlsx de verdade;
// - "Exportar PDF" chama a função de imprimir do navegador
//   (window.print(), mockada aqui pra não abrir um diálogo de verdade).
//
// Servidor de teste isolado precisa estar rodando em
// http://localhost:4123 (mesmo padrão dos outros testes Playwright).
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function login(page) {
  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForSelector('#reisMarketingChart .reis-bar-col', { timeout: 15000 });
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  // 64ª rodada: 'serviceWorkers: block' evita que o service worker novo
  // (public/service-worker.js, Rodada F da Pendência 51) atrapalhe o
  // page.route()/tempos deste teste.
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  // Stub de window.print() -- confirma que foi chamado, sem abrir
  // diálogo nenhum de verdade (não existe em modo headless mesmo, mas
  // fica explícito e determinístico).
  await page.addInitScript(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++; }; });

  const createdIds = [];
  try {
    await login(page);

    // Cria 1 post de teste no ano atual (Instagram/De Bacco) pra aparecer
    // no relatório mensal.
    const currentYear = new Date().getFullYear();
    const created = await page.evaluate(async (year) => {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/social-posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          platform: 'instagram', brand: 'debacco', scheduledDate: `${year}-03-15`, scheduledTime: '10:00',
          postType: 'estatico', status: 'agendado', subject: '[Teste 65ª rodada] Post relatório'
        })
      });
      return (await res.json()).post;
    }, currentYear);
    createdIds.push(created.id);
    check('post de teste criado pro relatório', !!created && !!created.id);

    // Vai pro Cronograma, marca De Bacco (padrão), abre "Relatório mensal".
    await page.click('#navCronograma');
    await page.waitForSelector('#view-cronograma:not([hidden])', { timeout: 10000 });
    await page.click('.tab-btn[data-cronograma-tab="relatorio"]');
    await page.waitForSelector('#cronogramaRelatorioWrap:not([hidden])', { timeout: 5000 });
    check('barra de mês (Calendário/Prévia) some na aba Relatório mensal', await page.isHidden('#cronogramaCalToolbar'));

    await page.waitForFunction((y) => {
      const el = document.querySelector('#cronogramaRelatorioContent');
      return el && el.textContent.includes(String(y)) && el.textContent.includes('Teste 65');
    }, currentYear, { timeout: 10000 });
    check('relatório mensal mostra o post de teste, agrupado no mês certo (Março)', (await page.textContent('#cronogramaRelatorioContent')).includes('Março'));

    // Navegação por ano: ano anterior não deve ter o post de teste.
    await page.click('#cronogramaRelatorioPrevYear');
    await page.waitForFunction(() => document.querySelector('#cronogramaRelatorioEmpty') && !document.querySelector('#cronogramaRelatorioEmpty').hidden, { timeout: 5000 }).catch(() => {});
    const prevYearEmpty = await page.isVisible('#cronogramaRelatorioEmpty').catch(() => false);
    const prevYearHasTeste = (await page.textContent('#cronogramaRelatorioContent').catch(() => '')).includes('Teste 65');
    check('ano anterior não mostra o post de teste (nem mistura anos)', prevYearEmpty || !prevYearHasTeste);
    await page.click('#cronogramaRelatorioNextYear'); // volta pro ano certo

    // Exportar Excel do relatório -- espera o download de verdade.
    const [download1] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }),
      page.click('#cronogramaRelatorioExportExcelBtn')
    ]);
    check('Exportar Excel do relatório mensal baixa um .xlsx', download1.suggestedFilename().endsWith('.xlsx'));

    // Exportar PDF do relatório -- chama window.print() (mockado).
    await page.click('#cronogramaRelatorioExportPdfBtn');
    const printsAfterRelatorio = await page.evaluate(() => window.__printCalls);
    check('Exportar PDF do relatório chama window.print()', printsAfterRelatorio >= 1);

    // Budget -- botões existem e exportam.
    await page.click('#navBudgetParent');
    await page.click('#navBudgetDebacco');
    await page.waitForSelector('#view-budget:not([hidden])', { timeout: 10000 });
    const [download2] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }),
      page.click('#budgetExportExcelBtn')
    ]);
    check('Exportar Excel do Budget baixa um .xlsx', download2.suggestedFilename().endsWith('.xlsx'));
    await page.click('#budgetExportPdfBtn');
    check('Exportar PDF do Budget chama window.print()', (await page.evaluate(() => window.__printCalls)) > printsAfterRelatorio);

    // Brindes -- botões existem e exportam.
    await page.click('#navBrindesParent');
    await page.click('#navBrindesControleGeral');
    await page.waitForSelector('#brindesCatalogWrap:not([hidden])', { timeout: 10000 });
    const [download3] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }),
      page.click('#brindesExportExcelBtn')
    ]);
    check('Exportar Excel de Brindes baixa um .xlsx', download3.suggestedFilename().endsWith('.xlsx'));

    // Campanha Cooperada -- botões existem e exportam.
    await page.click('#navCampanhaCooperada');
    await page.waitForSelector('#view-campanha-cooperada:not([hidden])', { timeout: 10000 });
    const [download4] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }),
      page.click('#campanhaCooperadaExportExcelBtn')
    ]);
    check('Exportar Excel de Campanha Cooperada baixa um .xlsx', download4.suggestedFilename().endsWith('.xlsx'));

    check('nenhum erro de console em toda a navegação', consoleErrors.length === 0);
    if (consoleErrors.length) console.log('Erros de console:', consoleErrors);
  } finally {
    // Limpa o post de teste direto pela API.
    await page.evaluate(async (ids) => {
      const token = localStorage.getItem('token');
      for (const id of ids) {
        await fetch('/api/social-posts/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }).catch(() => {});
      }
    }, createdIds).catch(() => {});
    await browser.close();
  }

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
