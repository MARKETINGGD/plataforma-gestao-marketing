// Regressão Playwright da 79ª rodada, pedido da Raquel: "a versão de tema
// escuro esta bem ruim, melhore isso, ele ficou feio". O tema escuro (14ª
// melhoria) só trocava --bg/--card/--border/--text/--muted; qualquer selo,
// aviso ou destaque com fundo pastel FIXO continuava exatamente igual,
// virando uma mancha clara em cima do resto escuro -- e o painel de login
// tinha fundo fixo claro sem cor de texto própria, deixando o título e os
// rótulos "Usuário"/"Senha" quase invisíveis no tema escuro (texto herdava
// var(--text), que fica claro no escuro, sobre um fundo que continuava
// claro). Este teste confirma os dois consertos. Servidor de teste isolado
// precisa estar rodando em http://localhost:4123.
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

function parseRgba(s) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(s || '');
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), m[4] !== undefined ? parseFloat(m[4]) : 1];
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
