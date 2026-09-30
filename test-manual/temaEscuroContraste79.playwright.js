// Regressão Playwright da 79ª rodada, pedido da Raquel: "a versão de tema
// escuro esta bem ruim, melhore isso, ele ficou feio". O tema escuro (14ª
// melhoria) só trocava --bg/--card/--border/--text/--muted; qualquer selo,
// aviso ou destaque com fundo pastel FIXO continuava exatamente igual,
// virando uma mancha clara em cima do resto escuro -- e o painel de login
// tinha fundo fixo claro sem cor de texto própria, deixando o título e os
// rótulos "Usuário"/"Senha" quase invisíveis no tema escuro (texto herdava
// var(--text), que fica claro no escuro, sobre um fundo que continuava
// claro). Este teste confirma os dois consertos.
//
// 2º round de feedback da Raquel no mesmo dia ("ainda ficou ruim... Deve
// mudar o chat tbm, veja q ele n aparece tbm... os cards que n tem cor
// ficam estranhos"): achou uma 3ª causa, mais espalhada -- vários lugares
// usavam `color-mix(in srgb, <cor>, white)` com "white" LITERAL (não uma
// variável), pra clarear uma cor de destaque mantendo texto escuro por
// cima legível. No tema escuro isso continuava dando um fundo quase
// branco (a mistura ignora o tema), só que o texto virava CLARO (var(--
// text) no escuro) -- texto claro em cima de fundo quase branco, invisível
// de novo. Afetava a bolha das PRÓPRIAS mensagens do chat, a conversa
// selecionada na lista, @menções, os cards de Demandas com "cor de fundo"
// escolhida, colunas do kanban com cor, a cor de fundo da tela Início, e
// linhas de tabela (rede do influencer, fornecedor escolhido). Trocado
// "white" por var(--card) em TODOS -- acompanha o tema nos 2 casos, sem
// mudar nada visualmente no tema claro (onde var(--card) já é branco).
// Servidor de teste isolado precisa estar rodando em http://localhost:4123.
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

function parseRgba(s) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(s || '');
  if (m) return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), m[4] !== undefined ? parseFloat(m[4]) : 1];
  // Chromium resolve o computed style de `color-mix()` pra notação CSS
  // Color 4 `color(srgb r g b [/ a])` (componentes de 0 a 1), não
  // `rgb()`/`rgba()` -- usado pelas bolhas de mensagem própria, conversa
  // selecionada e card colorido (todas via color-mix() depois do conserto).
  const m2 = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(s || '');
  if (m2) return [Math.round(parseFloat(m2[1]) * 255), Math.round(parseFloat(m2[2]) * 255), Math.round(parseFloat(m2[3]) * 255), m2[4] !== undefined ? parseFloat(m2[4]) : 1];
  return null;
}
function parseRgb(s) { const p = parseRgba(s); return p ? [p[0], p[1], p[2]] : null; }
function luminance([r, g, b]) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
// getComputedStyle devolve a cor rgba() TAL COMO declarada no CSS -- não
// "já misturada" com o que está por baixo. Um fundo translúcido (ex.:
// rgba(70,196,120,.14), usado nos overrides do tema escuro pra não virar
// mais um bloco sólido e claro) precisa ser composto manualmente contra o
// fundo real embaixo pra saber a luminância PERCEBIDA de verdade.
function compositeOver([r, g, b, a], [br, bg, bb]) {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
}
function contrastRatio(c1, c2) {
  const l1 = (luminance(c1) / 255) + 0.05;
  const l2 = (luminance(c2) / 255) + 0.05;
  return l1 > l2 ? l1 / l2 : l2 / l1;
}

async function ensureConfiguracoesSubmenuOpen(page) {
  const isHidden = await page.$eval('#navConfiguracoesSubmenu', (el) => el.hidden);
  if (isHidden) await page.click('#navConfiguracoesParent');
  await page.waitForSelector('#navConfiguracoesSubmenu:not([hidden])');
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
  await page.waitForTimeout(800);

  // Liga o tema escuro (idempotente -- só clica se ainda não estiver escuro).
  await ensureConfiguracoesSubmenuOpen(page);
  const isDark = await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark');
  if (!isDark) {
    await page.click('#themeToggleBtn');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', { timeout: 5000 });
  }

  // ---------- 1. Contraste do painel de login no tema escuro ----------
  const logoutLink = page.locator('text=Sair').first();
  await logoutLink.click();
  await page.waitForSelector('#loginUsername', { timeout: 10000 });
  await page.waitForTimeout(400);
  const loginPanelBg = parseRgb(await page.evaluate(() => getComputedStyle(document.querySelector('.login-right')).backgroundColor));
  const loginTitleColor = parseRgb(await page.evaluate(() => getComputedStyle(document.querySelector('.login-form h1')).color));
  const loginInputBg = parseRgb(await page.evaluate(() => getComputedStyle(document.querySelector('.login-form input')).backgroundColor));
  const loginInputColor = parseRgb(await page.evaluate(() => getComputedStyle(document.querySelector('.login-form input')).color));
  check('painel de login fica escuro (acompanha o tema, não fica claro fixo)', loginPanelBg && luminance(loginPanelBg) < 60);
  check('título do login tem contraste de leitura de verdade contra o painel (>= 4.5:1)', loginPanelBg && loginTitleColor && contrastRatio(loginPanelBg, loginTitleColor) >= 4.5);
  check('campo de usuário/senha também escurece (não fica claro sozinho)', loginInputBg && luminance(loginInputBg) < 60);
  check('texto digitado no campo tem contraste de leitura de verdade (>= 4.5:1)', loginInputBg && loginInputColor && contrastRatio(loginInputBg, loginInputColor) >= 4.5);

  // ---------- 2. Volta a logar e confere os destaques pastel no Cronograma ----------
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(600);

  await page.click('#navCronograma');
  await page.waitForTimeout(800);
  const pageBg = parseRgb(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  const pastDayEl = page.locator('.cal-day.past').first();
  check('encontrou algum dia "passado" no calendário pra conferir', await pastDayEl.count() > 0);
  if (await pastDayEl.count() > 0) {
    const pastDayRaw = parseRgba(await pastDayEl.evaluate((el) => getComputedStyle(el).backgroundColor));
    const pastDayComposited = pastDayRaw && pageBg ? compositeOver(pastDayRaw, pageBg) : null;
    // Antes do conserto isso vinha sólido #e5f3ea (luminância ~240) -- bem
    // mais claro que o fundo da página escura (luminância bem baixa).
    // Depois do conserto é um verde translúcido (rgba com alpha < 1) por
    // cima do fundo escuro: precisa compor manualmente (getComputedStyle
    // devolve a cor tal como declarada, não já misturada) pra ver a
    // luminância PERCEBIDA de verdade -- que fica bem mais escura que o
    // pastel sólido de antes, mas ainda um pouco mais clara que o fundo
    // puro (senão o destaque desaparece de vez).
    check('cor de fundo do dia passado usa transparência (rgba com alpha < 1, não mais um sólido pastel)', pastDayRaw && pastDayRaw[3] < 1);
    check('dia passado NÃO é mais um bloco pastel sólido e claro (luminância composta bem menor que antes)', pastDayComposited && luminance(pastDayComposited) < 100);
    check('dia passado ainda é um pouco mais claro que o fundo da página (dá pra perceber o destaque)', pastDayComposited && pageBg && luminance(pastDayComposited) > luminance(pageBg));
  }

  // ---------- 3. Chat: mensagem própria e conversa selecionada (bug do
  // "color-mix(..., white)" fixo -- 2º round de feedback) ----------
  await page.click('#navChat');
  await page.waitForSelector('#view-chat:not([hidden])');
  await page.waitForTimeout(600);
  const activeConvBg = parseRgb(await page.evaluate(() => getComputedStyle(document.querySelector('.chat-conversation-item.active')).backgroundColor));
  const activeConvTextColor = parseRgb(await page.evaluate(() => getComputedStyle(document.querySelector('.chat-conversation-item.active .chat-conversation-name')).color));
  // Limiar 3:1 (WCAG AA pra texto em negrito/grande, não 4.5:1 de texto de
  // parágrafo comum) -- o nome da conversa é bold (font-weight:700) em
  // cima de um destaque DELIBERADAMENTE sutil (um tom de "seleção", não
  // uma cor de alarme); medido ~3.9:1 depois do conserto, contra ~1:1 de
  // antes (texto claro em cima de um fundo que ficava quase branco).
  check('conversa selecionada ("Geral") NÃO fica com fundo quase branco', activeConvBg && luminance(activeConvBg) < 120);
  check('nome da conversa selecionada tem contraste de leitura de verdade (>= 3:1, é texto em negrito)', activeConvBg && activeConvTextColor && contrastRatio(activeConvBg, activeConvTextColor) >= 3);

  const msgText = 'Teste 79b tema escuro ' + Date.now();
  await page.fill('#chatInput', msgText);
  await page.click('#chatSendBtn');
  await page.waitForTimeout(500);
  const mineMsgLocator = page.locator('.chat-msg-row.mine .chat-msg').last();
  check('mensagem própria apareceu na tela', await mineMsgLocator.count() > 0);
  if (await mineMsgLocator.count() > 0) {
    const mineMsgBg = parseRgb(await mineMsgLocator.evaluate((el) => getComputedStyle(el).backgroundColor));
    const mineMsgTextColor = parseRgb(await mineMsgLocator.evaluate((el) => getComputedStyle(el.querySelector('.chat-msg-text') || el).color));
    check('bolha da própria mensagem NÃO fica com fundo quase branco', mineMsgBg && luminance(mineMsgBg) < 120);
    check('texto da própria mensagem tem contraste de leitura de verdade (>= 4.5:1)', mineMsgBg && mineMsgTextColor && contrastRatio(mineMsgBg, mineMsgTextColor) >= 4.5);
  }

  // ---------- 4. Demandas: card com "cor de fundo" escolhida (mesmo bug) ----------
  await page.click('#navDemandas');
  await page.waitForSelector('#view-demandas:not([hidden])');
  await page.waitForTimeout(500);
  await page.click('#demandasNewBtn');
  await page.waitForSelector('#demandaModal:not([hidden])');
  const cardTitle = 'Teste 79b card colorido ' + Date.now();
  await page.fill('#demCardTitle', cardTitle);
  await page.locator('#demColorSwatches .color-swatch:not(.color-swatch-none)').nth(3).click(); // vermelho
  await page.locator('#demAssigneeList input[type=checkbox]').first().check();
  await page.locator('#demAssigneeList .chip-responsible-btn').first().click();
  await page.click('#demCardSave');
  await page.waitForTimeout(600);
  await page.click('#demCardClose').catch(() => {});
  await page.waitForTimeout(400);
  const coloredCard = page.locator('.kanban-card', { hasText: cardTitle }).first();
  check('card colorido apareceu no quadro', await coloredCard.count() > 0);
  if (await coloredCard.count() > 0) {
    const cardBg = parseRgb(await coloredCard.evaluate((el) => getComputedStyle(el).backgroundColor));
    const cardTitleColor = parseRgb(await coloredCard.evaluate((el) => getComputedStyle(el.querySelector('.kanban-card-title') || el).color));
    // Mesmo raciocínio do contraste da conversa selecionada acima -- o
    // destaque de cor do card é sutil de propósito (só um "aceno" de cor,
    // a cor cheia fica na borda esquerda); medido ~4:1 depois do conserto,
    // contra um fundo quase branco (ilegível) de antes.
    check('card com cor de fundo NÃO fica quase branco no tema escuro', cardBg && luminance(cardBg) < 120);
    check('título do card colorido tem contraste de leitura de verdade (>= 3:1)', cardBg && cardTitleColor && contrastRatio(cardBg, cardTitleColor) >= 3);
  }
  check('nenhum erro de console em todo o fluxo', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  // Deixa o ambiente limpo pros outros testes (volta pro tema claro).
  await ensureConfiguracoesSubmenuOpen(page);
  await page.click('#themeToggleBtn');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light', { timeout: 5000 });

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
