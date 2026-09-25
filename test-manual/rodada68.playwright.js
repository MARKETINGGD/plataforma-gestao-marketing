// Teste visual (Playwright) da 68ª rodada -- vários pedidos da Raquel na
// mesma mensagem: link externo com edição em Brindes; página de venda +
// PDF/Excel + link externo (por análise e agregado) em Análise de
// Concorrência; download direto dos arquivos em Lançamentos de Produtos;
// submenu Catálogo em Produtos e em Expositores; e o novo submenu
// "Controle de Expositores" (planilha EXPOSITORES 2026.xlsx importada).
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
  page.on('console', (msg) => { if (msg.type() === 'error') { consoleErrors.push(msg.text()); console.log('[console.error]', msg.text()); } });
  page.on('pageerror', (err) => { consoleErrors.push(String(err)); console.log('[pageerror]', String(err)); });
  // Handler persistente (não "once") -- "Desativar" pede confirm() nativo
  // toda vez, e mais de 1 link é revogado neste teste (mesmo cuidado já
  // documentado em linkExternoRecursos.playwright.js).
  page.on('dialog', (d) => d.accept());

  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(1200); // evita a corrida de clicar bem na hora que a tela aparece (ver 67ª rodada)

  // ---------- Controle de Expositores (planilha importada) ----------
  await page.click('#navExpositoresParent');
  await page.click('#navExpositoresEstoque');
  await page.waitForSelector('#view-expositores-estoque:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(500);
  const rowCountGhelplus = await page.locator('#expositoresEstoqueBody tr').count();
  check('Controle de Expositores (GhelPlus) mostra 26 itens da planilha', rowCountGhelplus === 26);
  const firstRowText = await page.textContent('#expositoresEstoqueBody tr:first-child');
  check('1º item bate com a planilha (30.04.00598)', firstRowText.includes('30.04.00598'));
  // 70ª rodada: as abas de marca ganharam uma 3ª vizinha ("Total Mensal")
  // e passaram a compartilhar 1 atributo só (`data-expositores-estoque-view`)
  // em vez de `data-expositores-estoque-brand` -- ver comentário em
  // public/app.js, seção "Controle de Expositores".
  await page.click('.tab-btn[data-expositores-estoque-view="debacco"]');
  await page.waitForTimeout(500);
  const rowCountDebacco = await page.locator('#expositoresEstoqueBody tr').count();
  check('Controle de Expositores (De Bacco) mostra 18 itens da planilha', rowCountDebacco === 18);
  await page.click('.tab-btn[data-expositores-estoque-view="ghelplus"]');
  await page.waitForTimeout(500);

  // Edita o 1º item -- confirma que Total/Pendência recalculam sozinhos.
  await page.click('#expositoresEstoqueBody tr:first-child button[data-edit-expositor-estoque]');
  await page.waitForSelector('#expositorEstoqueFormWrap:not([hidden])', { timeout: 5000 });
  await page.fill('#expositorEstoqueFormSaldoPR', '200');
  await page.click('#expositorEstoqueFormSave');
  await page.waitForSelector('#expositorEstoqueFormWrap', { state: 'hidden', timeout: 5000 });
  await page.waitForTimeout(500);
  const firstRowAfterEdit = await page.textContent('#expositoresEstoqueBody tr:first-child');
  check('editar Saldo PR recalcula o Total sozinho (200+2+1=203)', firstRowAfterEdit.includes('203'));

  // Link externo do Controle de Expositores.
  await page.click('#expositoresEstoquePublicLinkBtn');
  await page.waitForSelector('#expositoresEstoquePublicLinkPanel:not([hidden])', { timeout: 5000 });
  const expGenBtn = page.locator('#expositoresEstoqueGenLinkBtn');
  if (await expGenBtn.isVisible()) await expGenBtn.click(); else await page.click('#expositoresEstoqueRegenLinkBtn');
  await page.waitForFunction(() => !document.querySelector('#expositoresEstoquePublicLinkActive').hidden, { timeout: 5000 });
  const expLinkUrl = await page.inputValue('#expositoresEstoquePublicLinkField');
  check('link externo do Controle de Expositores tem o formato certo', /\?sharePublic=[a-f0-9]+$/.test(expLinkUrl));
  const expVisitorCtx = await browser.newContext();
  const expVisitorPage = await expVisitorCtx.newPage();
  await expVisitorPage.goto(expLinkUrl);
  await expVisitorPage.waitForSelector('#screen-share-public:not([hidden])', { timeout: 10000 });
  check('link externo do Controle de Expositores mostra o título certo', (await expVisitorPage.textContent('#sharePublicTitle')).includes('Controle de Expositores'));
  check('link externo do Controle de Expositores mostra a tabela com dados', (await expVisitorPage.locator('#sharePublicContent table tbody tr').count()) > 0);
  await expVisitorCtx.close();
  await page.click('#expositoresEstoqueRevokeLinkBtn');

  // ---------- Catálogo de Expositores (upload por marca) ----------
  await page.click('#navExpositoresCatalogo');
  await page.waitForSelector('#view-expositores-catalogo:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(500);
  const expCatalogoText = await page.textContent('#expositoresCatalogoList');
  check('Catálogo de Expositores mostra as 2 marcas (GhelPlus/De Bacco)', expCatalogoText.includes('GhelPlus') && expCatalogoText.includes('De Bacco'));
  check('Catálogo de Expositores começa sem arquivo nenhum', expCatalogoText.includes('Nenhum arquivo enviado ainda.'));
  const expFileInput = await page.$('[data-catalog-file-input="ghelplus"]');
  await expFileInput.setInputFiles({ name: 'catalogo-ghelplus.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 conteudo de teste') });
  await page.click('[data-catalog-upload="ghelplus"]');
  await page.waitForFunction(() => document.querySelector('#expositoresCatalogoList').textContent.includes('catalogo-ghelplus.pdf'), { timeout: 10000 });
  check('catálogo da GhelPlus enviado com sucesso', (await page.textContent('#expositoresCatalogoList')).includes('catalogo-ghelplus.pdf'));

  // ---------- Catálogo de Produtos (upload por marca, coleção separada) ----------
  await page.click('#navProdutosParent');
  await page.click('#navProdutosCatalogo');
  await page.waitForSelector('#view-produtos-catalogo:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(500);
  const prodCatalogoText = await page.textContent('#produtosCatalogoList');
  check('Catálogo de Produtos é uma lista SEPARADA da de Expositores (começa vazio)', prodCatalogoText.includes('Nenhum arquivo enviado ainda.'));

  // ---------- Lançamentos de Produtos: download direto (sem precisar de "Editar") ----------
  await page.click('#navProdutosLancamentos');
  await page.waitForSelector('#view-produtos:not([hidden])', { timeout: 10000 });
  await page.waitForSelector('#produtosLancamentosWrap:not([hidden])', { timeout: 5000 });
  await page.click('#lancamentosNewBtn');
  await page.waitForSelector('#lancamentoFormWrap:not([hidden])', { timeout: 5000 });
  await page.fill('#lancamentoFormNome', 'Produto Teste 68ª Rodada');
  await page.click('#lancamentoFormSave');
  // Criar (não editar) reabre o formulário JÁ em modo edição, pra liberar
  // o upload de arquivo na hora -- não fecha sozinho (ver app.js).
  await page.waitForTimeout(600);
  check('formulário de lançamento reabre em modo edição após criar (pra liberar upload)', await page.isVisible('#lancamentoFormWrap'));
  await page.setInputFiles('#lancamentoFileInput', { name: 'arquivo-lancamento.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 lancamento teste') });
  await page.waitForFunction(() => document.querySelector('#lancamentoFiles').textContent.includes('arquivo-lancamento.pdf'), { timeout: 10000 });
  await page.click('#lancamentoFormCancel');
  await page.waitForTimeout(400);
  const lancamentosBodyText = await page.textContent('#lancamentosBody');
  check('lista de Lançamentos mostra um link de download direto (sem precisar clicar em Editar)', lancamentosBodyText.includes('arquivo-lancamento.pdf'));
  const downloadLinkHref = await page.getAttribute('#lancamentosBody a[download]', 'href');
  check('o link de download aponta pro arquivo certo', !!downloadLinkHref && downloadLinkHref.includes('.pdf'));

  // ---------- Análise de Concorrência: página de venda + Excel/PDF + links ----------
  await page.click('#navProdutosConcorrencia');
  await page.waitForSelector('#produtosConcorrenciaWrap:not([hidden])', { timeout: 5000 });
  await page.click('#concorrenciaNewBtn');
  await page.waitForSelector('#concorrenciaFormWrap:not([hidden])', { timeout: 5000 });
  await page.fill('#concorrenciaFormTitulo', 'Análise Teste 68ª Rodada');
  await page.fill('#concorrenciaFormData', '2026-09-24');
  await page.fill('#concorrenciaConcorrentesRows input[data-crow="nome"]', 'Concorrente Teste');
  await page.fill('#concorrenciaFormNossoProduto', 'Nosso Produto Teste');
  await page.fill('#concorrenciaFormNossoLinkVenda', 'https://exemplo.com/produto-teste');
  await page.click('#concorrenciaFormSave');
  await page.waitForSelector('#concorrenciaFormWrap', { state: 'hidden', timeout: 5000 });
  await page.waitForTimeout(400);
  const concorrenciaListText = await page.textContent('#concorrenciaList');
  check('nova análise aparece na lista', concorrenciaListText.includes('Análise Teste 68ª Rodada'));
  check('campo "Página de venda" aparece no cartão com o link certo', concorrenciaListText.includes('exemplo.com/produto-teste'));

  let downloadFired = false;
  page.once('download', () => { downloadFired = true; });
  await page.click('#concorrenciaExportExcelBtn');
  await page.waitForTimeout(800);
  check('Exportar Excel de Concorrência dispara um download', downloadFired);

  // Link externo por análise (botão dentro do cartão) -- usa prompt() pra
  // mostrar o link já copiado; o handler persistente registrado lá em
  // cima aceita esse dialog também (não precisa de handler extra aqui).
  await page.click('button[data-share-concorrencia]');
  await page.waitForTimeout(500);
  check('gerar link por análise não quebra a tela (sem erro de console)', true);

  // Link externo agregado.
  await page.click('#concorrenciaPublicLinkBtn');
  await page.waitForSelector('#concorrenciaPublicLinkPanel:not([hidden])', { timeout: 5000 });
  const concGenBtn = page.locator('#concorrenciaGenLinkBtn');
  if (await concGenBtn.isVisible()) await concGenBtn.click(); else await page.click('#concorrenciaRegenLinkBtn');
  await page.waitForFunction(() => !document.querySelector('#concorrenciaPublicLinkActive').hidden, { timeout: 5000 });
  const concLinkUrl = await page.inputValue('#concorrenciaPublicLinkField');
  const concVisitorCtx = await browser.newContext();
  const concVisitorPage = await concVisitorCtx.newPage();
  await concVisitorPage.goto(concLinkUrl);
  await concVisitorPage.waitForSelector('#screen-share-public:not([hidden])', { timeout: 10000 });
  check('link agregado de Concorrência mostra a análise de teste', (await concVisitorPage.textContent('#sharePublicContent')).includes('Análise Teste 68ª Rodada'));
  await concVisitorCtx.close();
  await page.click('#concorrenciaRevokeLinkBtn');

  // ---------- Brindes: link externo com EDIÇÃO ----------
  await page.click('#navBrindesParent');
  await page.click('#navBrindesControleGeral');
  await page.waitForSelector('#brindesCatalogWrap:not([hidden])', { timeout: 10000 });
  await page.click('#brindesPublicLinkBtn');
  await page.waitForSelector('#brindesPublicLinkPanel:not([hidden])', { timeout: 5000 });
  await page.check('input[name="brindesPublicLinkMode"][value="edicao"]');
  await page.click('#brindesGenLinkBtn');
  await page.waitForFunction(() => !document.querySelector('#brindesPublicLinkActive').hidden, { timeout: 5000 });
  check('modo do link mostrado é "edição"', (await page.textContent('#brindesPublicLinkModeLabel')).includes('edição'));
  const brindesLinkUrl = await page.inputValue('#brindesPublicLinkField');

  const brindesVisitorCtx = await browser.newContext();
  const brindesVisitorPage = await brindesVisitorCtx.newPage();
  await brindesVisitorPage.goto(brindesLinkUrl);
  await brindesVisitorPage.waitForSelector('#screen-share-public:not([hidden])', { timeout: 10000 });
  check('link em modo edição mostra o campo "Seu nome"', await brindesVisitorPage.isVisible('#sharePublicEditorName'));
  check('link em modo edição mostra inputs editáveis de estoque', (await brindesVisitorPage.locator('input[data-share-field="estoquePR"]').count()) > 0);

  // Tenta salvar sem nome -- deve avisar e não gravar.
  const firstSaveBtn = brindesVisitorPage.locator('[data-save-brinde-share]').first();
  await firstSaveBtn.click();
  await brindesVisitorPage.waitForTimeout(300);
  const firstRowMsg = await brindesVisitorPage.locator('tr[data-brinde-share-row] .share-brinde-save-msg').first().textContent();
  check('sem nome preenchido, avisa e não salva', firstRowMsg.includes('nome'));

  // Preenche nome, muda o estoque PR e salva -- confirma que persiste.
  await brindesVisitorPage.fill('#sharePublicEditorName', 'Visitante Playwright');
  const firstRow = brindesVisitorPage.locator('tr[data-brinde-share-row]').first();
  await firstRow.locator('input[data-share-field="estoquePR"]').fill('777');
  await firstRow.locator('[data-save-brinde-share]').click();
  await brindesVisitorPage.waitForFunction(() => {
    const el = document.querySelector('tr[data-brinde-share-row] .share-brinde-save-msg');
    return el && el.textContent.includes('Salvo');
  }, { timeout: 5000 });
  check('salvar com nome preenchido funciona ("Salvo!")', true);
  const totalAfterSave = await firstRow.locator('.share-brinde-total').textContent();
  check('o Total da linha atualiza sozinho depois de salvar', totalAfterSave.trim().length > 0);
  await brindesVisitorCtx.close();

  // Confirma dentro da Papoi (logada) que o carimbo ficou como "via link externo".
  await page.reload();
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(1200);
  await page.click('#navBrindesParent');
  await page.click('#navBrindesControleGeral');
  await page.waitForSelector('#brindesCatalogWrap:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(500);
  const brindesTableHtml = await page.innerHTML('#brindesCatalogBody');
  check('estoque de 777 apareceu na tabela de dentro da Papoi', brindesTableHtml.includes('777'));
  check('dica (title) do carimbo menciona "via link externo"', brindesTableHtml.includes('via link externo'));

  // Desativa o link de teste.
  await page.click('#brindesPublicLinkBtn');
  await page.waitForSelector('#brindesPublicLinkPanel:not([hidden])', { timeout: 5000 });
  await page.click('#brindesRevokeLinkBtn');

  check('nenhum erro de console em toda a navegação', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
