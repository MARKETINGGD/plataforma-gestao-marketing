// Teste visual (Playwright) da 78ª rodada -- confere na tela de verdade
// que a Área Pessoal de Demandas mostra as listas nomeáveis (não mais
// coluna com nome de outra pessoa marcada) e que criar/renomear/excluir
// lista funciona pelo próprio quadro. Servidor de teste isolado precisa
// estar rodando em http://localhost:4123.
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
  page.on('dialog', (d) => {
    if (d.type() === 'prompt') d.accept('Lista Renomeada Teste');
    else d.accept();
  });
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
  await page.click('[data-demandas-scope="pessoal"]');
  await page.waitForTimeout(500);

  check('botão "+ Nova lista" aparece na Área Pessoal', await page.isVisible('#demandasNewListBtn'));
  await page.click('[data-demandas-scope="geral"]');
  await page.waitForTimeout(300);
  check('botão "+ Nova lista" fica escondido no Quadro Geral', !(await page.isVisible('#demandasNewListBtn')));
  await page.click('[data-demandas-scope="pessoal"]');
  await page.waitForTimeout(300);

  const colNamesBefore = await page.$$eval('.kanban-col-header-name', (els) => els.map((e) => e.textContent));
  check('Área Pessoal começa com só 1 coluna ("Minhas tarefas")', colNamesBefore.length === 1 && colNamesBefore[0] === 'Minhas tarefas');

  // Cria um card pessoal -- não deve criar coluna nenhuma com nome de
  // outra pessoa mesmo se marcar alguém.
  await page.click('#demandasNewBtn');
  await page.waitForSelector('#demandaModal:not([hidden])');
  await page.fill('#demCardTitle', 'Card teste UI listas pessoais ' + Date.now());
  const listSelectVisible = await page.isVisible('#demCardListWrap');
  check('modal do card mostra o seletor de Lista dentro da Área Pessoal', listSelectVisible);
  await page.click('#demCardSave');
  await page.waitForTimeout(400);
  await page.click('#demCardClose');
  await page.waitForTimeout(300);

  const colNamesAfterCard = await page.$$eval('.kanban-col-header-name', (els) => els.map((e) => e.textContent));
  check('depois de criar o card, continua só 1 coluna (nenhuma nova apareceu)', colNamesAfterCard.length === 1);

  // Cria uma lista nova pelo botão.
  await page.click('#demandasNewListBtn');
  await page.waitForTimeout(400);
  const colNamesAfterNewList = await page.$$eval('.kanban-col-header-name', (els) => els.map((e) => e.textContent));
  check('depois de "+ Nova lista", aparecem 2 colunas', colNamesAfterNewList.length === 2);

  // Renomeia a segunda lista.
  const renameBtns = await page.$$('.kanban-rename-list-btn');
  await renameBtns[renameBtns.length - 1].click();
  await page.waitForTimeout(400);
  const colNamesAfterRename = await page.$$eval('.kanban-col-header-name', (els) => els.map((e) => e.textContent));
  check('lista renomeada aparece com o novo nome', colNamesAfterRename.includes('Lista Renomeada Teste'));

  // Exclui a lista recém-criada -- volta pra 1 coluna só.
  const deleteBtns = await page.$$('.kanban-delete-list-btn');
  await deleteBtns[deleteBtns.length - 1].click();
  await page.waitForTimeout(400);
  const colNamesAfterDelete = await page.$$eval('.kanban-col-header-name', (els) => els.map((e) => e.textContent));
  check('depois de excluir, volta a ter só 1 coluna', colNamesAfterDelete.length === 1);

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
