// Regressão Playwright (15ª melhoria, 24/09/2026, pedido direto da
// Raquel: "Deve ter a opção de notificação na tela do PC, mesmo quando o
// Papoi estiver minimizado. Assim a notificação ainda aparece na tela,
// mesmo estando em outra tela aberta que não é o Papoi"). Como o
// navegador headless deste sandbox não tem uma central de notificação
// de verdade do sistema operacional, o teste substitui `window.
// Notification` por uma versão fake (via addInitScript, antes de
// qualquer script da página rodar) que só REGISTRA as chamadas, com o
// mesmo formato da API real (`permission`, `requestPermission()`,
// `new Notification(title, {body})`) -- o que se testa aqui é a LÓGICA
// da Papoi (quando chama, com que título/texto), não o navegador em si.
// Servidor de teste isolado precisa estar rodando em
// http://localhost:4123 (mesmo padrão dos outros testes Playwright
// desta cópia).
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

function fakeNotificationInitScript(initialPermission) {
  return (perm) => {
    window.__notifCalls = [];
    window.__requestPermissionCalled = false;
    window.__notifPermission = perm;
    function FakeNotification(title, opts) {
      window.__notifCalls.push({ title, body: (opts && opts.body) || '' });
      this.close = () => {};
      this.onclick = null;
    }
    FakeNotification.requestPermission = () => {
      window.__requestPermissionCalled = true;
      window.__notifPermission = 'granted';
      return Promise.resolve('granted');
    };
    Object.defineProperty(FakeNotification, 'permission', { get: () => window.__notifPermission });
    window.Notification = FakeNotification;
    window.__forceUnfocused = false;
    const realHasFocus = document.hasFocus.bind(document);
    document.hasFocus = () => (window.__forceUnfocused ? false : realHasFocus());
    Object.defineProperty(document, 'hidden', { get: () => !!window.__forceUnfocused, configurable: true });
  };
}

async function login(page) {
  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
}

// 76ª rodada, 2ª correção: #osNotifToggleBtn (mesmo id, mesma lógica de
// sempre) saiu do rodapé solto da barra lateral e virou item do submenu
// Configurações -- por isso precisa abrir esse submenu antes de conseguir
// CLICAR nele (ler o texto com textContent() não exige visibilidade,
// então não afeta as outras verificações deste arquivo).
async function ensureConfiguracoesSubmenuOpen(page) {
  const isHidden = await page.$eval('#navConfiguracoesSubmenu', (el) => el.hidden);
  if (isHidden) await page.click('#navConfiguracoesParent');
  await page.waitForSelector('#navConfiguracoesSubmenu:not([hidden])');
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const consoleErrors = [];

  // ---------- Cenário 1: permissão ainda não pedida ('default') ----------
  // 64ª rodada: 'serviceWorkers: block' evita que o service worker novo
  // (public/service-worker.js, Rodada F da Pendência 51) atrapalhe o
  // page.route()/tempos deste teste -- achado por acaso ao rodar a suíte
  // inteira depois de registrar o service worker: vários testes, que
  // não têm nada a ver com PWA, começaram a falhar/travar junto (ver
  // test-manual/pwaInstalavel.playwright.js, o Único que PRECISA do
  // service worker ativo de verdade e por isso não bloqueia).
  const page1 = await browser.newPage({ serviceWorkers: 'block' });
  page1.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push('[p1] ' + msg.text()); });
  page1.on('pageerror', (err) => consoleErrors.push('[p1] ' + String(err)));
  await page1.addInitScript(fakeNotificationInitScript(), 'default');
  await login(page1);

  check('botão oferece "Ativar" quando a permissão ainda não foi pedida', /Ativar notifica/i.test(await page1.textContent('#osNotifToggleBtn')));
  await ensureConfiguracoesSubmenuOpen(page1);
  await page1.click('#osNotifToggleBtn');
  await page1.waitForFunction(() => window.__requestPermissionCalled === true, { timeout: 5000 });
  check('clicar chama Notification.requestPermission() de verdade', true);
  await page1.waitForFunction(() => /ativadas/i.test(document.querySelector('#osNotifToggleBtn').textContent), { timeout: 5000 });
  check('depois de conceder, o botão muda pra "ativadas"', true);
  await page1.close();

  // ---------- Cenário 2: permissão já concedida ----------
  const page2 = await browser.newPage({ serviceWorkers: 'block' });
  page2.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push('[p2] ' + msg.text()); });
  page2.on('pageerror', (err) => consoleErrors.push('[p2] ' + String(err)));
  await page2.addInitScript(fakeNotificationInitScript(), 'granted');

  await page2.route('**/api/recados/for-me', (route) => {
    // 1ª chamada: lista vazia (define a base). Muda pra 1 recado novo a
    // partir da 2ª chamada em diante (simula o polling achando algo novo).
    route.request().__count = (route.request().__count || 0);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recados: [] }) });
  });

  await login(page2);
  // Espera o boot inteiro terminar (o último passo de loadHome()) --
  // garante que a 1ª chamada de checkNewRecados() (que define a base,
  // sem toast/notificação nenhuma) já aconteceu ANTES de eu trocar a
  // resposta mockada pra simular "chegou um recado novo".
  await page2.waitForSelector('#reisMarketingChart .reis-bar-col', { timeout: 15000 });
  // startNotificationSoundWatcher() (que dispara a 1ª checkNewRecados(),
  // a que define a base sem toast/notificação) só é chamado DEPOIS do
  // gráfico do REIS renderizar -- dá uma folga curta pra essa 1ª busca
  // (fetch simples num servidor local, bem rápida) terminar antes de
  // trocar a resposta mockada, senão o "recado novo" cai bem na 1ª
  // checagem e vira só a base, sem disparar nada (falso negativo).
  await page2.waitForTimeout(1500);
  check('botão já mostra "ativadas" quando a permissão já foi concedida antes', /ativadas/i.test(await page2.textContent('#osNotifToggleBtn')));

  // Com a Papoi em foco (não minimizada/escondida), uma notificação nova
  // NÃO deve virar notificação do sistema -- o aviso de dentro da tela já
  // dá conta disso, duplicar seria irritante.
  await page2.route('**/api/recados/for-me', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ recados: [{ id: 'r1', text: 'Recado de teste', createdByName: 'Fulana', createdByPhoto: null, readByMe: false, targetUserIds: [] }] })
  }));
  await page2.evaluate(() => { window.__forceUnfocused = false; });
  await page2.waitForFunction(() => document.querySelector('#recadosForMe .recado-card'), { timeout: 20000 }).catch(() => {});
  const notifWhileFocused = await page2.evaluate(() => window.__notifCalls.length);
  check('com a Papoi em foco, recado novo NÃO dispara notificação do sistema (já tem o aviso de dentro da tela)', notifWhileFocused === 0);

  await page2.close();

  // ---------- Cenário 3: permissão concedida, mas a Papoi está "minimizada" ----------
  const page3 = await browser.newPage({ serviceWorkers: 'block' });
  page3.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push('[p3] ' + msg.text()); });
  page3.on('pageerror', (err) => consoleErrors.push('[p3] ' + String(err)));
  await page3.addInitScript(fakeNotificationInitScript(), 'granted');
  await page3.route('**/api/recados/for-me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recados: [] }) }));
  await login(page3);
  await page3.waitForSelector('#reisMarketingChart .reis-bar-col', { timeout: 15000 });
  await page3.waitForTimeout(1500); // mesma folga do cenário 2, ver comentário lá
  await page3.evaluate(() => { window.__forceUnfocused = true; }); // simula minimizado/em outra aba
  await page3.route('**/api/recados/for-me', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ recados: [{ id: 'r2', text: 'Recado importante enquanto minimizado', createdByName: 'Beltrana', createdByPhoto: null, readByMe: false, targetUserIds: [] }] })
  }));
  await page3.waitForFunction(() => window.__notifCalls.length > 0, { timeout: 20000 });
  const calls = await page3.evaluate(() => window.__notifCalls);
  check('com a Papoi minimizada/sem foco, recado novo DISPARA notificação do sistema', calls.length > 0);
  check('a notificação leva o texto certo do recado', calls.some((c) => c.body === 'Recado importante enquanto minimizado'));
  await page3.close();

  check('nenhum erro de console em todo o fluxo', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
