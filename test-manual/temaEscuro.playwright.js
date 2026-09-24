// Regressão Playwright (14ª melhoria, 24/09/2026, pedido direto da
// Raquel: "Na tela, deixe a possibilidade de deixar o tema escuro").
// Confere: o botão alterna o tema na hora, o valor persiste no PERFIL
// (sobrevive a um reload/nova sessão, não só localStorage), o fundo/
// texto de verdade mudam de cor (as variáveis CSS estão sendo
// aplicadas), e a tela de login já nasce no tema certo (sem "piscar"
// clara) quando o navegador já tem uma preferência salva. Servidor de
// teste isolado precisa estar rodando em http://localhost:4123 (mesmo
// padrão dos outros testes Playwright desta cópia).
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

function parseRgb(s) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || '');
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : null;
}
function luminance([r, g, b]) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  // 64ª rodada: 'serviceWorkers: block' evita que o service worker novo
  // (public/service-worker.js, Rodada F da Pendência 51) atrapalhe o
  // page.route()/tempos deste teste -- achado por acaso ao rodar a suíte
  // inteira depois de registrar o service worker: vários testes, que
  // não têm nada a ver com PWA, começaram a falhar/travar junto (ver
  // test-manual/pwaInstalavel.playwright.js, o Único que PRECISA do
  // service worker ativo de verdade e por isso não bloqueia).
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(BASE);
  check('tema padrão (claro) aplicado no <html> antes mesmo do login', await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'light'));

  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForSelector('#reisMarketingChart .reis-bar-col', { timeout: 15000 }).catch(() => {});

  const bodyBgLight = parseRgb(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  check('cor de fundo de verdade é clara antes de trocar o tema', bodyBgLight && luminance(bodyBgLight) > 180);

  // ---------- Alterna pra escuro ----------
  await page.click('#themeToggleBtn');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', { timeout: 5000 });
  check('atributo data-theme muda pra "dark" na hora', true);
  const btnTextDark = await page.textContent('#themeToggleBtn');
  check('texto do botão muda pra oferecer voltar ao claro', /claro/i.test(btnTextDark));
  const bodyBgDark = parseRgb(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  check('cor de fundo de verdade fica escura (variável CSS aplicada, não só o atributo)', bodyBgDark && luminance(bodyBgDark) < 60);
  const textColorDark = parseRgb(await page.evaluate(() => getComputedStyle(document.body).color));
  check('cor do texto fica clara no tema escuro (continua legível)', textColorDark && luminance(textColorDark) > 180);
  // Um "card" de verdade (não o body) também precisa escurecer -- prova
  // que não foi só o :root que mudou, o resto do CSS reaproveita a
  // mesma variável de verdade.
  await page.click('#changePasswordBtn');
  await page.waitForSelector('#changePasswordModal:not([hidden])', { timeout: 5000 });
  const modalBgDark = await page.evaluate(() => {
    const m = document.querySelector('#changePasswordModal .modal');
    return m ? getComputedStyle(m).backgroundColor : null;
  });
  const modalRgbDark = parseRgb(modalBgDark);
  check('modal (Alterar senha) também fica escuro, não só o fundo geral', modalRgbDark && luminance(modalRgbDark) < 80);
  await page.evaluate(() => { document.querySelector('#changePasswordModal').hidden = true; });

  // ---------- Persiste no PERFIL (não só localStorage) -- confirma
  // relendo /api/auth/me direto, e também dando reload na página. ----------
  const savedOnServer = await page.evaluate(async () => {
    const res = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
    const body = await res.json();
    return body.user && body.user.theme;
  });
  check('tema escuro foi salvo no PERFIL (GET /api/auth/me devolve "dark")', savedOnServer === 'dark');

  await page.reload();
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  check('depois de recarregar a página, continua no tema escuro (não volta pro claro)', await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark'));

  // ---------- Volta pro claro, pra deixar o ambiente limpo pros outros testes ----------
  await page.click('#themeToggleBtn');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light', { timeout: 5000 });
  const savedBackToLight = await page.evaluate(async () => {
    const res = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
    const body = await res.json();
    return body.user && body.user.theme;
  });
  check('voltar pro claro também salva no perfil', savedBackToLight === 'light');

  check('nenhum erro de console em todo o fluxo', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
