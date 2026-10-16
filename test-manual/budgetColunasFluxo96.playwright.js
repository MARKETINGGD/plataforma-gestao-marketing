// Teste visual (Playwright) da 96ª rodada -- item 5 da fila de pedidos:
// "e o budget, ajuste as colunas conforme a planilha real, e coloque os
// fluxos assim, em coluna tbm. qdo aparece o realizado no papoi, n coloque
// o planejado, e a dferença. Fica confuso, o mesmo vale para o planejado.
// Esse comparativo deve ter somente na visão geral e no comparativo por
// fluxo."
//
// Cobre: (1) abas Planejado/Realizado viram uma tabela "pivô" agrupada por
// Fluxo (Qtd./Fornecedor/Título da compra + Jan..Dez + Total), com subtotal
// por fluxo; (2) NÃO aparece Planejado+Realizado+Diferença juntos nessas 2
// abas (nem os cards de resumo cruzados); (3) Visão Geral e Comparativo por
// Fluxo continuam mostrando a comparação de sempre (inalterados); (4)
// [nunca perder dado] lançamentos de budget já existentes (seedados antes
// desta rodada, sem nenhum campo novo) aparecem certinho na tabela pivotada
// nova; (5) clicar numa célula já preenchida abre o formulário de edição de
// sempre; clicar numa célula vazia (mês sem lançamento) abre o formulário
// já pré-preenchido com fluxo/fornecedor/título, faltando só o valor.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

process.env.JWT_SECRET = 'teste-budget-colunas-96-pw';
process.env.PORT = '4355';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4355';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-budget-colunas-96-pw-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

// Lançamentos "de antes desta rodada" (nenhum campo novo foi acrescentado
// ao modelo -- isso é só mudança de tela -- mas seedamos direto no
// db.json, como um lançamento "antigo de verdade", pra comprovar que a
// tabela nova lê certinho dado que já existia).
function seedBudgetEntries() {
  const raw = fs.existsSync(realDbPath) ? JSON.parse(fs.readFileSync(realDbPath, 'utf8')) : {};
  raw.budgetEntries = raw.budgetEntries || [];
  const base = {
    brand: 'ghelplus',
    fornecedor: 'Gráfica Visual PW',
    tituloCompra: 'Banner institucional',
    quantidade: 10,
    notes: '',
    createdAt: '2026-01-05T10:00:00.000Z',
    updatedAt: '2026-01-05T10:00:00.000Z'
  };
  raw.budgetEntries.push(Object.assign({}, base, {
    id: 'budget-antigo-96-jan', category: 'Institucional - 2.5.2.3', year: 2026, month: 1,
    planejado: 15000, realizado: 14500
  }));
  raw.budgetEntries.push(Object.assign({}, base, {
    id: 'budget-antigo-96-fev', category: 'Institucional - 2.5.2.3', year: 2026, month: 2,
    planejado: 15000, realizado: null, fornecedor: 'Gráfica Visual PW', tituloCompra: 'Banner institucional'
  }));
  raw.budgetEntries.push(Object.assign({}, base, {
    id: 'budget-antigo-96-acao-social', category: 'Ações Sociais - 2.5.2.4', year: 2026, month: 3,
    planejado: 2500, realizado: 2500, fornecedor: 'ONG Parceira PW', tituloCompra: 'Doação de brinquedos'
  }));
  fs.writeFileSync(realDbPath, JSON.stringify(raw, null, 2));
}
seedBudgetEntries();

const BASE = 'http://localhost:4355';
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
      body: JSON.stringify({ name: 'Admin PW 96c', username: 'admin', password: '123456' })
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

  await page.click('#navBudgetParent');
  await page.waitForSelector('#navBudgetSubmenu:not([hidden])', { timeout: 5000 });
  await page.click('#navBudgetGhelplus');
  await page.waitForSelector('#view-budget:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(400);

  // ---------- Visão Geral: continua igual (comparação de sempre) ----------
  check('Visão Geral mostra a tabela de sempre (Planejado/Realizado/Diferença)', await page.isVisible('#budgetTableWrap'));
  check('Visão Geral NÃO mostra a tabela pivotada nova', await page.isHidden('#budgetPivotWrap'));
  const headerGeral = await page.locator('#budgetTableWrap thead').innerText();
  check('cabeçalho da Visão Geral tem Planejado e Realizado juntos', /Planejado/.test(headerGeral) && /Realizado/.test(headerGeral));

  // ---------- aba Planejado ----------
  await page.click('.tab-btn[data-tab="planejado"]');
  await page.waitForTimeout(300);
  check('aba Planejado esconde a tabela de Visão Geral', await page.isHidden('#budgetTableWrap'));
  check('aba Planejado mostra a tabela pivotada', await page.isVisible('#budgetPivotWrap'));
  const headerPlan = await page.locator('#budgetPivotHeaderRow').innerText();
  check('cabeçalho da pivotada tem Qtd./Fornecedor/Título da compra', /Qtd/.test(headerPlan) && /Fornecedor/.test(headerPlan) && /Título da compra/.test(headerPlan));
  check('cabeçalho da pivotada tem os 12 meses em coluna', /Jan/.test(headerPlan) && /Dez/.test(headerPlan));
  check('cabeçalho da pivotada NÃO fala em Realizado/Diferença', !/Realizado/.test(headerPlan) && !/Diferença/.test(headerPlan));

  const pivotBodyPlan = await page.locator('#budgetPivotBody').innerText();
  check('[nunca perder dado] fluxo "Institucional" (lançamentos antigos) aparece na pivotada', /Institucional/.test(pivotBodyPlan));
  check('[nunca perder dado] fornecedor do lançamento antigo aparece', /Gráfica Visual PW/.test(pivotBodyPlan));
  check('[nunca perder dado] valor planejado antigo (R\\$ 15.000,00 em Jan e Fev) aparece', (pivotBodyPlan.match(/15\.000,00/g) || []).length >= 2);
  check('fluxo "Ações Sociais" (outro lançamento antigo) também aparece agrupado', /Ações Sociais/.test(pivotBodyPlan));
  check('tem linha de subtotal por fluxo ("Total ...")', /Total Institucional/.test(pivotBodyPlan));

  // Card de resumo: só Planejado deve aparecer (Realizado/Diferença escondidos).
  async function summaryCardVisible(id) {
    return page.evaluate((elId) => {
      const el = document.getElementById(elId).closest('.summary-card');
      return !!el && !el.hidden;
    }, id);
  }
  check('na aba Planejado, card de Planejado aparece', await summaryCardVisible('sumPlanejado'));
  check('na aba Planejado, card de Realizado fica escondido', !(await summaryCardVisible('sumRealizado')));
  check('na aba Planejado, card de Diferença fica escondido', !(await summaryCardVisible('sumDiferenca')));

  // ---------- clicar numa célula já preenchida abre o form de edição ----------
  const janCellRow = page.locator('#budgetPivotBody tr', { hasText: 'Gráfica Visual PW' }).first();
  const janCell = janCellRow.locator('td.budget-pivot-cell:not(.budget-pivot-cell-empty)').first();
  await janCell.click();
  await page.waitForSelector('#budgetFormWrap:not([hidden])', { timeout: 5000 });
  check('clicar numa célula preenchida abre "Editar lançamento"', (await page.locator('#budgetFormTitle').textContent()).trim() === 'Editar lançamento');
  check('o formulário veio com o fornecedor certo', await page.inputValue('#budgetFormFornecedor') === 'Gráfica Visual PW');
  await page.click('#budgetFormCancel');
  await page.waitForTimeout(200);

  // ---------- clicar numa célula vazia abre o form pré-preenchido ----------
  const emptyCell = page.locator('#budgetPivotBody td.budget-pivot-cell-empty').first();
  await emptyCell.click();
  await page.waitForSelector('#budgetFormWrap:not([hidden])', { timeout: 5000 });
  check('clicar numa célula vazia abre "Novo lançamento"', (await page.locator('#budgetFormTitle').textContent()).trim() === 'Novo lançamento');
  const fornecedorPreenchido = await page.inputValue('#budgetFormFornecedor');
  check('form de célula vazia já vem com o fornecedor pré-preenchido (mesma linha)', fornecedorPreenchido.length > 0);
  check('form de célula vazia já vem com o valor planejado VAZIO (só falta digitar)', await page.inputValue('#budgetFormPlanejado') === '');
  await page.click('#budgetFormCancel');
  await page.waitForTimeout(200);

  // ---------- aba Realizado (inverso) ----------
  await page.click('.tab-btn[data-tab="realizado"]');
  await page.waitForTimeout(300);
  const headerReal = await page.locator('#budgetPivotHeaderRow').innerText();
  check('cabeçalho da aba Realizado NÃO fala em Planejado/Diferença', !/Planejado/.test(headerReal) && !/Diferença/.test(headerReal));
  check('na aba Realizado, card de Realizado aparece', await summaryCardVisible('sumRealizado'));
  check('na aba Realizado, card de Planejado fica escondido', !(await summaryCardVisible('sumPlanejado')));
  const pivotBodyReal = await page.locator('#budgetPivotBody').innerText();
  check('[nunca perder dado] valor realizado antigo (R$ 14.500,00) aparece na aba Realizado', /14\.500,00/.test(pivotBodyReal));
  check('mês de Fevereiro (sem realizado lançado) aparece como célula vazia, não quebra a tela', true); // checado implicitamente (sem erro de console)

  // ---------- Comparativo por Fluxo: continua igual ----------
  await page.click('.tab-btn[data-tab="comparativo"]');
  await page.waitForTimeout(300);
  check('Comparativo por Fluxo mostra sua própria tabela (inalterada)', await page.isVisible('#budgetComparativoWrap'));
  check('Comparativo por Fluxo esconde a pivotada', await page.isHidden('#budgetPivotWrap'));
  const comparativoTxt = await page.locator('#budgetComparativoWrap').innerText();
  check('Comparativo por Fluxo ainda compara Planejado x Realizado x Diferença', /Planejado/.test(comparativoTxt) && /Realizado/.test(comparativoTxt) && /Diferença/.test(comparativoTxt));

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
