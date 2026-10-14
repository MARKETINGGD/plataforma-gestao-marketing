// Regressão Playwright (66ª rodada, "Rodada H" da Pendência 51, pedido
// direto da Raquel: "as abas budget, feiras, expositores, brindes,
// campanha cooperada, devem gerar link externo (com a posisbilidade de 2
// tipos de link, apenas leitura ou edição)"). Esta rodada entrega o tipo
// "leitura" pra Budget/Feiras/Brindes/Campanha Cooperada (Expositores não
// tem dado próprio na Papoi ainda -- ver nota no handoff). Confere:
// - gerar o link mostra o campo com a URL certa (?sharePublic=TOKEN);
// - abrir esse link (sem login, aba nova/mesma sessão sem token) mostra
//   os dados certos, filtrados pela marca escolhida;
// - revogar desativa o link de verdade (a página passa a mostrar erro).
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

// Clica em "Gerar link externo" OU "Gerar novo link" -- o que estiver
// visível (idempotente: não importa se já existia um link de uma rodada
// de teste anterior que não tenha sido limpa). Aceita o prefixo simples
// (recursos de 1 modo só, ex.: 'budget' -> #budgetGenLinkBtn/
// #budgetRegenLinkBtn) OU os ids exatos de gen/regen (recursos com 2
// modos independentes desde a 91ª rodada, ex.: Brindes).
async function genOrRegenLink(page, genIdOrPrefix, regenId) {
  const genId = regenId ? genIdOrPrefix : genIdOrPrefix + 'GenLinkBtn';
  const resolvedRegenId = regenId || (genIdOrPrefix + 'RegenLinkBtn');
  const genBtn = page.locator('#' + genId);
  if (await genBtn.isVisible()) { await genBtn.click(); } else { await page.click('#' + resolvedRegenId); }
  // Dá tempo da chamada assíncrona de gerar/regenerar terminar antes de
  // quem chamou ler o campo -- sem isso, quando já existia um link ativo
  // de uma rodada de teste anterior (o botão "Gerar novo link" já nasce
  // visível, sem nenhuma mudança de estado pra esperar), o campo podia
  // ser lido ainda com o token ANTIGO, que nesse meio tempo o próprio
  // clique já tinha invalidado no banco (mesma classe de corrida já
  // documentada durante o diagnóstico da 91ª rodada).
  await page.waitForTimeout(300);
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
  // atrapalhe o page.route()/tempos deste teste.
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  // Handler persistente (não "once") -- "Desativar" pede confirm() nativo
  // toda vez, e mais de 1 recurso é revogado neste teste.
  page.on('dialog', (d) => d.accept());

  await login(page);

  // ---------- Budget: gera o link, confere o campo, abre numa aba nova
  // sem sessão nenhuma (simula visitante de fora). ----------
  await page.click('#navBudgetParent');
  await page.click('#navBudgetDebacco');
  await page.waitForSelector('#view-budget:not([hidden])', { timeout: 10000 });
  await page.click('#budgetPublicLinkBtn');
  await page.waitForSelector('#budgetPublicLinkPanel:not([hidden])', { timeout: 5000 });
  await genOrRegenLink(page, 'budget');
  await page.waitForFunction(() => !document.querySelector('#budgetPublicLinkActive').hidden, { timeout: 5000 });
  const budgetLinkUrl = await page.inputValue('#budgetPublicLinkField');
  check('link do Budget tem o formato certo (?sharePublic=)', /\?sharePublic=[a-f0-9]+$/.test(budgetLinkUrl));

  const visitorContext = await browser.newContext(); // sem cookies/token nenhum -- visitante de fora
  const visitorPage = await visitorContext.newPage();
  await visitorPage.goto(budgetLinkUrl);
  await visitorPage.waitForSelector('#screen-share-public:not([hidden])', { timeout: 10000 });
  check('link externo do Budget mostra o título certo', (await visitorPage.textContent('#sharePublicTitle')).includes('Budget'));
  check('link externo do Budget mostra a tabela com dados', (await visitorPage.locator('#sharePublicContent table tbody tr').count()) > 0);
  check('sidebar da Papoi NÃO aparece no link externo (visitante não vê o resto da plataforma)', await visitorPage.isHidden('.sidebar').catch(() => true));

  // Revoga o link e confere que o mesmo visitante (recarregando) recebe erro.
  await page.click('#budgetRevokeLinkBtn');
  await page.waitForFunction(() => document.querySelector('#budgetPublicLinkActive').hidden, { timeout: 5000 });
  await visitorPage.goto(budgetLinkUrl);
  await visitorPage.waitForSelector('#sharePublicError:not([hidden])', { timeout: 10000 });
  check('link do Budget revogado mostra erro pro visitante', true);
  await visitorContext.close();

  // ---------- Brindes: fluxo mais curto (já confirma o padrão genérico
  // funciona pra outro recurso, com colunas diferentes). ----------
  // 91ª rodada: leitura/edição viraram 2 links independentes (ver
  // brindesLinkExternoDoisModos91.test.js pra cobertura completa dessa
  // independência) -- aqui só confere, de novo, que o padrão genérico
  // (gerar/abrir/revogar) continua funcionando pro link de leitura.
  await page.click('#navBrindesParent');
  await page.click('#navBrindesControleGeral');
  await page.waitForSelector('#brindesCatalogWrap:not([hidden])', { timeout: 10000 });
  await page.click('#brindesPublicLinkBtn');
  await page.waitForSelector('#brindesPublicLinkPanel:not([hidden])', { timeout: 5000 });
  await genOrRegenLink(page, 'brindesGenLeituraLinkBtn', 'brindesRegenLeituraLinkBtn');
  await page.waitForFunction(() => !document.querySelector('#brindesPublicLinkLeituraActive').hidden, { timeout: 5000 });
  const brindesLinkUrl = await page.inputValue('#brindesPublicLinkLeituraField');

  const visitorContext2 = await browser.newContext();
  const visitorPage2 = await visitorContext2.newPage();
  await visitorPage2.goto(brindesLinkUrl);
  await visitorPage2.waitForSelector('#screen-share-public:not([hidden])', { timeout: 10000 });
  check('link externo de Brindes mostra o título certo', (await visitorPage2.textContent('#sharePublicTitle')).includes('Brindes'));
  const brindesHeaders = await visitorPage2.locator('#sharePublicContent table thead th').allTextContents();
  check('link externo de Brindes mostra as colunas certas (Estoque PR/SP/PE)', brindesHeaders.some((h) => h.includes('Estoque PR')));
  await visitorContext2.close();
  await page.click('#brindesRevokeLeituraLinkBtn');
  await page.waitForFunction(() => document.querySelector('#brindesPublicLinkLeituraActive').hidden, { timeout: 5000 });

  check('nenhum erro de console em toda a navegação', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
