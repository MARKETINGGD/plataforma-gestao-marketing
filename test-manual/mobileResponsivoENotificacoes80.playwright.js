// Teste visual (Playwright) da 80ª rodada, pedido direto da Raquel:
//
//   "a versão para celular do papoi não esta se ajustando na tela, ela
//   fica muito ruim de usar, totalmente desconfigurada, ajuste isso por
//   favor e tbm ajuste as notificações para o telefone."
//
//   "Quando o papoi é aberto no google, ele n fica com o simbolo na
//   abinha do google sabe? ajuste tbm por favor"
//
// Três problemas, três blocos de checagem neste arquivo:
//
//   1. Favicon (ícone na aba do navegador) -- faltava <link rel="icon">
//      no <head> (só existia manifest + apple-touch-icon, nenhum dos
//      dois é o que Chrome/Edge/Firefox usam pra aba de desktop).
//
//   2. Menu no celular -- a barra lateral virava uma faixa horizontal
//      com 13 itens + submenus disputando espaço (e um submenu de
//      item-pai aberto quebrava essa faixa por completo). Agora vira uma
//      gaveta (painel escondido fora da tela, abre por cima do conteúdo
//      com um botão de menu próprio).
//
//   3. Notificação do sistema no celular -- `new Notification(...)`
//      chamado direto da página dá erro ("Illegal constructor") no
//      Android/Chrome sempre que já existe um service worker registrado
//      (é sempre o caso aqui), fazendo a notificação nunca aparecer de
//      verdade no celular. Agora passa a pedir pro PRÓPRIO service
//      worker mostrar a notificação (`registration.showNotification`),
//      que funciona em desktop E celular.
//
// Servidor de teste isolado precisa estar rodando em
// http://localhost:4123 (mesmo padrão dos outros testes Playwright desta
// cópia -- este arquivo roda sozinho, sem bloquear o service worker,
// justamente pra poder testar o registro/showNotification de verdade).
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function login(page, username, password) {
  await page.goto(BASE);
  await page.fill('#loginUsername', username);
  await page.fill('#loginPassword', password);
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const allConsoleErrors = [];

  // ---------- Bloco 1: favicon ----------
  {
    const page = await browser.newPage({ serviceWorkers: 'block' });
    page.on('console', (msg) => { if (msg.type() === 'error') allConsoleErrors.push('[favicon] ' + msg.text()); });
    await page.goto(BASE);
    const icons = await page.$$eval('link[rel="icon"]', (els) => els.map((el) => ({ href: el.getAttribute('href'), sizes: el.getAttribute('sizes') })));
    check('<head> agora tem <link rel="icon"> (faltava por completo antes)', icons.length >= 1);
    check('ícone 192x192 declarado', icons.some((i) => i.sizes === '192x192'));
    check('ícone 512x512 declarado', icons.some((i) => i.sizes === '512x512'));
    for (const icon of icons) {
      const res = await page.goto(`${BASE}${icon.href}`);
      check(`arquivo do favicon "${icon.href}" existe de verdade (200)`, res.status() === 200);
    }
    await page.close();
  }

  // ---------- Bloco 2: menu no celular (gaveta) ----------
  {
    const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } }); // tamanho de iPhone comum
    page.on('console', (msg) => { if (msg.type() === 'error') allConsoleErrors.push('[mobile] ' + msg.text()); });
    page.on('pageerror', (err) => allConsoleErrors.push('[mobile] ' + String(err)));
    await login(page, 'admin', '123456');

    check('no celular, o botão de menu (☰) está visível', await page.isVisible('#mobileMenuToggle'));
    const sidebarOpenInitially = await page.$eval('#appSidebar', (el) => el.classList.contains('sidebar-open'));
    check('a gaveta do menu começa FECHADA (não empurra/sobrepõe o conteúdo sem pedir)', !sidebarOpenInitially);

    // Nenhuma rolagem horizontal na tela Início logada, no tamanho de
    // celular -- é o sintoma mais direto de "desconfigurada" (algo
    // estourando a largura da tela).
    const noHorizontalOverflowHome = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    check('tela Início não estoura a largura da tela no celular (sem rolagem horizontal)', noHorizontalOverflowHome);

    // Abre a gaveta.
    await page.click('#mobileMenuToggle');
    await page.waitForTimeout(150);
    check('clicar no ☰ abre a gaveta (.sidebar-open)', await page.$eval('#appSidebar', (el) => el.classList.contains('sidebar-open')));
    check('o fundo escurecido (backdrop) aparece junto', await page.$eval('#sidebarBackdrop', (el) => !el.hidden));

    // Um item-PAI (com submenu) abre o submenu, mas a gaveta continua
    // aberta -- a pessoa ainda precisa escolher um item de dentro dele.
    await page.click('#navBudgetParent');
    await page.waitForTimeout(150);
    check('abrir um submenu (Budget) dentro da gaveta não fecha a gaveta', await page.$eval('#appSidebar', (el) => el.classList.contains('sidebar-open')));
    check('o submenu do Budget realmente abriu', await page.$eval('#navBudgetSubmenu', (el) => !el.hidden));

    // Escolher uma tela de verdade (Chat) navega E fecha a gaveta sozinha.
    await page.click('#navChat');
    await page.waitForSelector('#view-chat:not([hidden])', { timeout: 5000 });
    check('clicar numa tela de verdade (Chat) navega pra ela', await page.isVisible('#view-chat'));
    check('e fecha a gaveta sozinha, sem precisar de mais um clique', !(await page.$eval('#appSidebar', (el) => el.classList.contains('sidebar-open'))));
    check('o fundo escurecido some junto', await page.$eval('#sidebarBackdrop', (el) => el.hidden));

    const noHorizontalOverflowChat = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    check('tela de Chat também não estoura a largura no celular', noHorizontalOverflowChat);

    // Reabre e fecha clicando no fundo escurecido (sem escolher nada) --
    // continua na mesma tela (Chat), só a gaveta fecha. Clica perto da
    // borda DIREITA do fundo escurecido de propósito -- a gaveta em si
    // ocupa só ~260px à esquerda (82vw no máximo); clicar no centro da
    // tela cairia POR CIMA da própria gaveta (um item de menu), não no
    // fundo escurecido ao lado dela -- o que seria o comportamento
    // certo (tocar no menu não fecha o menu), só não é o que este passo
    // quer testar.
    await page.click('#mobileMenuToggle');
    await page.waitForTimeout(150);
    await page.click('#sidebarBackdrop', { position: { x: 370, y: 400 } });
    await page.waitForTimeout(150);
    check('clicar no fundo escurecido fecha a gaveta sem navegar pra lugar nenhum', !(await page.$eval('#appSidebar', (el) => el.classList.contains('sidebar-open'))) && await page.isVisible('#view-chat'));

    await page.close();
  }

  // ---------- Bloco 3: desktop continua exatamente como sempre foi ----------
  {
    const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
    page.on('console', (msg) => { if (msg.type() === 'error') allConsoleErrors.push('[desktop] ' + msg.text()); });
    await login(page, 'admin', '123456');
    const mobileTopbarVisible = await page.isVisible('.mobile-topbar');
    check('em tela grande, a barra de topo do celular fica escondida', !mobileTopbarVisible);
    check('em tela grande, a barra lateral já aparece sozinha, sem precisar abrir nada', await page.isVisible('.sidebar'));
    await page.close();
  }

  // ---------- Bloco 4: notificação do sistema usa o service worker (não quebra no celular) ----------
  {
    const context = await browser.newContext();
    await context.grantPermissions(['notifications'], { origin: BASE });
    const page = await context.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') allConsoleErrors.push('[notif] ' + msg.text()); });
    page.on('pageerror', (err) => allConsoleErrors.push('[notif] ' + String(err)));

    // Instrumentação ANTES de qualquer script da página rodar: espiona
    // `registration.showNotification` (sem bloquear o service worker de
    // verdade, ao contrário de notificacaoSistema.playwright.js -- aqui
    // o objetivo é justamente testar o registro real), espiona se o
    // construtor `new Notification(...)` chegou a ser chamado (não
    // deveria mais, com o service worker ativo) e permite simular
    // "minimizado"/sem foco, e registra cliques por id (pra confirmar
    // que o clique na notificação chega de volta na função certa).
    await page.addInitScript(() => {
      window.__shownNotifications = [];
      window.__realNotificationConstructed = false;
      window.__clickLog = [];
      window.addEventListener('click', (e) => {
        if (e.target && e.target.id) window.__clickLog.push(e.target.id);
      }, true);

      const OrigNotification = window.Notification;
      function SpyNotification(title, opts) {
        window.__realNotificationConstructed = true;
        return new OrigNotification(title, opts);
      }
      SpyNotification.requestPermission = (...args) => OrigNotification.requestPermission(...args);
      Object.defineProperty(SpyNotification, 'permission', { get: () => OrigNotification.permission });
      window.Notification = SpyNotification;

      if (window.ServiceWorkerRegistration && ServiceWorkerRegistration.prototype.showNotification) {
        const origShow = ServiceWorkerRegistration.prototype.showNotification;
        ServiceWorkerRegistration.prototype.showNotification = function (title, opts) {
          window.__shownNotifications.push({ title, opts });
          return Promise.resolve();
        };
        window.__origShowNotification = origShow;
      }

      window.__forceUnfocused = false;
      const realHasFocus = document.hasFocus.bind(document);
      document.hasFocus = () => (window.__forceUnfocused ? false : realHasFocus());
      Object.defineProperty(document, 'hidden', { get: () => !!window.__forceUnfocused, configurable: true });
    });

    await login(page, 'admin', '123456');

    // Espera o service worker ASSUMIR o controle desta página de verdade
    // (clients.claim() no activate -- ver service-worker.js) antes de
    // simular "minimizado", senão o código ainda cairia no caminho de
    // fallback (sem controller ativo) em vez do caminho novo que se quer
    // testar aqui.
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 15000 });
    check('o service worker assumiu o controle da página (clients.claim)', true);

    await page.waitForSelector('#reisMarketingChart .reis-bar-col, #reisMarketingEmpty:not([hidden])', { timeout: 15000 });
    await page.waitForTimeout(1200); // mesma folga usada em notificacaoSistema.playwright.js, pra deixar a 1ª checagem (que só define a base) terminar antes de criar o recado novo
    await page.evaluate(() => { window.__forceUnfocused = true; });

    // Cria o recado por uma chamada DIRETA à API (sem `page.route()`) --
    // com o service worker de verdade ativo e no controle da página, o
    // mock de rota do Playwright não intercepta com confiabilidade (o
    // próprio comentário de notificacaoSistema.playwright.js já registra
    // esse achado, motivo de aquele teste bloquear o service worker; este
    // aqui precisa dele ATIVO pra testar o caminho novo, então contorna
    // criando o dado de verdade em vez de mockar a resposta).
    const loginRes = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: '123456' }) }).then((r) => r.json());
    const me = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${loginRes.token}` } }).then((r) => r.json()).then((d) => d.user);
    await fetch(`${BASE}/api/recados`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginRes.token}` },
      body: JSON.stringify({ text: 'Recado de teste da 80ª rodada', targetUserIds: [me.id] })
    });

    await page.waitForFunction(() => window.__shownNotifications.length > 0, { timeout: 20000 });
    const shown = await page.evaluate(() => window.__shownNotifications);
    check('com o celular "minimizado" e o service worker ativo, a notificação usa registration.showNotification (não quebra mais no Android)', shown.length > 0);
    check('a notificação leva o texto certo do recado', shown.some((n) => n.opts && n.opts.body === 'Recado de teste da 80ª rodada'));
    const realConstructed = await page.evaluate(() => window.__realNotificationConstructed);
    check('o `new Notification(...)` direto (o que quebrava no celular) NÃO foi usado desta vez', !realConstructed);

    // Round-trip do clique: o service worker não tem como chamar uma
    // função de JS da página — ele só devolve o clickId por mensagem (ver
    // notificationclick em service-worker.js); simula aqui exatamente essa
    // mensagem chegando de volta, do jeito que o service worker de
    // verdade manda.
    const clickId = shown[0].opts && shown[0].opts.data && shown[0].opts.data.clickId;
    check('a notificação leva um clickId (pro clique saber qual ação chamar de volta)', !!clickId);
    await page.evaluate((id) => {
      navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'papoi-notification-click', clickId: id } }));
    }, clickId);
    await page.waitForFunction(() => window.__clickLog.includes('navHome'), { timeout: 5000 });
    check('clicar na notificação executa a ação certa (recado novo leva pra Início)', true);

    await context.close();
  }

  // 81ª rodada: `ensurePushSubscription()` (chamado sozinho no fim de
  // startApp(), ver app.js) tenta consultar/inscrever push assim que
  // loga -- o Chrome imprime esse erro específico de propósito sempre
  // que isso roda num contexto incógnito (como as páginas deste arquivo,
  // via `browser.newPage()` puro -- o próprio Chrome documenta essa
  // limitação: https://crbug.com/401439, "Push API não funciona em modo
  // incógnito"). Não é um bug -- é só uma particularidade de ambiente de
  // teste automatizado, nunca acontece com uma pessoa de verdade usando
  // a Papoi (ninguém abre a Papoi numa aba anônima pra trabalhar nela);
  // o próprio `ensurePushSubscription()` já trata isso num try/catch e
  // não deixa vazar pra lugar nenhum da tela. Filtrado daqui só pra não
  // confundir esse "ruído" esperado com um erro de verdade.
  const realErrors = allConsoleErrors.filter((e) => !e.includes('Push API in incognito mode'));
  check('nenhum erro de console/JS em todo o fluxo (celular + desktop + notificação)', realErrors.length === 0);
  if (realErrors.length) console.log('Erros de console encontrados:', realErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
