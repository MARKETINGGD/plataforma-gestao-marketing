// Teste visual (Playwright) da 70ª rodada, pedido da Raquel no Controle de
// Expositores:
//   1. "coloque o total de unidades/mês e o total em R$/mês" -- linha de
//      total no fim da tabela de cada marca.
//   2. "Crie outra aba... Total Mensal... o mês, o valor total (das duas
//      marcas juntas) e o total de expositores (duas marcas juntas)".
//   3. "Deixe as colunas saldo PR, SP e NE de cores diferentes... faça o
//      mesmo com consumo mensal, total/mês" -- confere que as 5 colunas
//      têm background diferentes entre si (destaque visual).
//   4. "Os lançamentos mensais... deve ser automaticamente adicionado ao
//      budget... De Bacco no fluxo: 2.5.3.14... GhelPlus, no fluxo:
//      2.5.2.14" -- confere que o botão "Lançar no Budget" manda o
//      payload certo (marca/mês/ano) e mostra a confirmação com o fluxo
//      certo devolvido pelo servidor.
//
// A correção matemática do total/fluxo em si (soma bater, fluxo certo por
// marca, relançar sem duplicar, permissão) já é coberta de ponta a ponta
// contra o servidor de verdade em expositoresLancamentoMensal.test.js --
// aqui a rede é toda mockada (page.route), só pra conferir a TELA.
// Servidor de teste isolado precisa estar rodando em http://localhost:4123
// (mesmo padrão dos outros testes Playwright).
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

const GHEL_ITEMS = [
  { id: 'it1', brand: 'ghelplus', codigoEntrada: 'C1', descricaoEntrada: 'Item 1', codigoSaida: 'S1', descricaoSaida: 'Item 1 saída', valorUnitario: 100, saldoPR: 10, saldoSP: 5, saldoNE: 2, saldoTotal: 17, segurancaPR: 3, pendenciaPR: 7, segurancaSP: 1, pendenciaSP: 4, segurancaNE: 1, pendenciaNE: 1, consumoMensal: 20, valorTotalMensal: 2000, loteEconomico: 1, loteMultiplo: 1, ressuprimentoFornecedor: 10, ressuprimentoCompras: 10, estoqueSeguranca: 5, nota: null },
  { id: 'it2', brand: 'ghelplus', codigoEntrada: 'C2', descricaoEntrada: 'Item 2', codigoSaida: 'S2', descricaoSaida: 'Item 2 saída', valorUnitario: 50, saldoPR: 8, saldoSP: 3, saldoNE: 1, saldoTotal: 12, segurancaPR: 2, pendenciaPR: 6, segurancaSP: 1, pendenciaSP: 2, segurancaNE: 0, pendenciaNE: 1, consumoMensal: 30, valorTotalMensal: 1500, loteEconomico: 1, loteMultiplo: 1, ressuprimentoFornecedor: 5, ressuprimentoCompras: 5, estoqueSeguranca: 3, nota: 'Nota teste' }
];
// Soma esperada: unidades 20+30=50; R$ 2000+1500=3500,00

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') { consoleErrors.push(msg.text()); console.log('[console.error]', msg.text()); } });
  page.on('pageerror', (err) => { consoleErrors.push(String(err)); console.log('[pageerror]', String(err)); });

  await page.route('**/api/expositores/estoque?brand=ghelplus', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ canEdit: true, items: GHEL_ITEMS }) });
  });
  await page.route('**/api/expositores/estoque?brand=debacco', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ canEdit: true, items: [] }) });
  });
  await page.route('**/api/expositores/lancamentos-mensais?brand=ghelplus', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });
  await page.route('**/api/expositores/lancamentos-mensais?brand=debacco', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });
  // Aba "Total Mensal" -- GET sem `brand`, lista das 2 marcas num mesmo
  // mês (março/2030), o front tem que somar as 2 na mesma linha.
  await page.route('**/api/expositores/lancamentos-mensais', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        items: [
          { id: 'l1', brand: 'ghelplus', year: 2030, month: 3, totalUnidades: 100, totalValor: 5000, updatedBy: 'Teste' },
          { id: 'l2', brand: 'debacco', year: 2030, month: 3, totalUnidades: 50, totalValor: 2500, updatedBy: 'Teste' }
        ]
      })
    });
  });
  let lancarBody = null;
  await page.route('**/api/expositores/lancamentos-mensais/lancar', async (route) => {
    lancarBody = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        launch: { id: 'novo-lancamento', brand: lancarBody.brand, year: lancarBody.year, month: lancarBody.month, totalUnidades: 50, totalValor: 3500 },
        budgetEntry: { id: 'be1', brand: lancarBody.brand, category: 'Expositores Padrão - 2.5.2.14', year: lancarBody.year, month: lancarBody.month },
        fluxo: 'Expositores Padrão - 2.5.2.14'
      })
    });
  });

  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });

  await page.click('#navExpositoresParent');
  await page.click('#navExpositoresEstoque');
  await page.waitForSelector('#expositoresEstoqueBody tr', { timeout: 10000 });

  // ---------- 1. linha de total do mês (unidades e R$) ----------
  const totalRowText = await page.textContent('#expositoresEstoqueTotalRow');
  check('linha de total mostra as unidades certas (20+30=50)', totalRowText.includes('50'));
  check('linha de total mostra o valor certo em R$ (2000+1500=3.500,00)', totalRowText.includes('3.500,00'));

  // O mesmo total também aparece no preview do card de lançamento mensal.
  const previewText = await page.textContent('#expositoresLancamentoPreview');
  check('preview do lançamento mensal mostra o total certo de unidades', previewText.includes('50'));
  check('preview do lançamento mensal mostra o total certo em R$', previewText.includes('3.500,00'));

  // ---------- 3. colunas destacadas com cores diferentes entre si ----------
  const bg = async (sel) => page.$eval(sel, (el) => getComputedStyle(el).backgroundColor);
  const [bgPR, bgSP, bgNE, bgConsumo, bgTotalMes, bgNormal] = await Promise.all([
    bg('#expositoresEstoqueTable thead .col-saldo-pr'),
    bg('#expositoresEstoqueTable thead .col-saldo-sp'),
    bg('#expositoresEstoqueTable thead .col-saldo-ne'),
    bg('#expositoresEstoqueTable thead .col-consumo-mensal'),
    bg('#expositoresEstoqueTable thead .col-total-mes'),
    bg('#expositoresEstoqueTable thead th') // primeira th (Código entrada), sem classe de destaque
  ]);
  const cores = [bgPR, bgSP, bgNE, bgConsumo, bgTotalMes];
  const todasDiferentesEntreSi = new Set(cores).size === cores.length;
  check('as 5 colunas destacadas (Saldo PR/SP/NE, Consumo mensal, R$ Total/mês) têm cores diferentes entre si', todasDiferentesEntreSi);
  check('as colunas destacadas têm uma cor diferente de uma coluna comum (sem destaque)', cores.every((c) => c !== bgNormal));
  // As mesmas classes também pintam as células do corpo da tabela, não só o cabeçalho.
  const bodyBgPR = await bg('#expositoresEstoqueBody tr:first-child .col-saldo-pr');
  check('destaque também aparece nas células do corpo da tabela (não só no cabeçalho)', bodyBgPR === bgPR);

  // ---------- 4. lançar no Budget manda o payload certo e mostra a confirmação ----------
  await page.selectOption('#expositoresLancamentoMes', '3');
  await page.fill('#expositoresLancamentoAno', '2099');
  await page.click('#expositoresLancamentoBtn');
  await page.waitForSelector('#expositoresLancamentoMsg:not([hidden])', { timeout: 5000 });
  check('"Lançar no Budget" mandou a marca certa (GhelPlus, aba ativa)', lancarBody && lancarBody.brand === 'ghelplus');
  check('"Lançar no Budget" mandou o mês/ano escolhidos (3/2099)', lancarBody && Number(lancarBody.year) === 2099 && Number(lancarBody.month) === 3);
  const msgText = await page.textContent('#expositoresLancamentoMsg');
  check('mensagem de confirmação cita o fluxo devolvido pelo servidor (2.5.2.14)', /2\.5\.2\.14/.test(msgText));

  // ---------- 2. aba "Total Mensal" soma as 2 marcas por mês ----------
  await page.click('[data-expositores-estoque-view="mensal"]');
  await page.waitForSelector('#expositoresEstoqueMensalView:not([hidden])', { timeout: 5000 });
  check('ao abrir "Total Mensal", a tela da marca fica escondida', await page.isHidden('#expositoresEstoqueBrandView'));
  const mensalText = await page.textContent('#expositoresMensalBody');
  check('aba "Total Mensal" mostra o mês certo (Março/2030)', mensalText.includes('Março/2030'));
  check('aba "Total Mensal" soma as unidades das 2 marcas (100+50=150)', mensalText.includes('150'));
  check('aba "Total Mensal" soma o valor das 2 marcas em R$ (5000+2500=7.500,00)', mensalText.includes('7.500,00'));

  // Voltar pra aba GhelPlus reexibe a tela da marca normalmente.
  await page.click('[data-expositores-estoque-view="ghelplus"]');
  await page.waitForSelector('#expositoresEstoqueBrandView:not([hidden])', { timeout: 5000 });
  check('voltar pra aba GhelPlus reexibe a tabela da marca', await page.isHidden('#expositoresEstoqueMensalView'));

  check('nenhum erro de console/página em toda a navegação', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
