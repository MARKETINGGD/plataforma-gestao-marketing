// Regressão Playwright (13ª melhoria, 24/09/2026, pedidos diretos da
// Raquel): som de "chamar atenção" tocando também pra quem manda (não só
// pra quem recebe), som de troca de "rei" no REIS DO MARKETING, Recados
// limitados a 3 com rolagem, e botões-pai de submenu ficando coloridos
// assim que clicados (não só depois de escolher um item do submenu).
// Servidor de teste isolado precisa estar rodando em
// http://localhost:4123 (mesmo padrão dos outros testes Playwright desta
// cópia).
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

const FAKE_TEAM = [
  { id: 'user-fake-1', name: 'Fulana Teste', username: 'fulana', cargo: 'analista', photoUrl: null },
  { id: 'user-fake-2', name: 'Beltrana Teste', username: 'beltrana', cargo: 'analista', photoUrl: null }
];

function fakeRecado(i) {
  return {
    id: 'recado-fake-' + i,
    text: 'Recado de teste número ' + i,
    color: '#6D63E0',
    targetUserIds: [],
    readBy: [],
    readByMe: false,
    archived: false,
    createdAt: new Date().toISOString(),
    createdBy: null,
    createdByName: 'Papoi',
    createdByPhoto: null,
    system: true
  };
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  // Instrumenta HTMLMediaElement.play ANTES de qualquer script da página
  // rodar, pra capturar qual arquivo de som tocou em cada ação (sem
  // precisar de áudio de verdade, que autoplay bloqueia de qualquer jeito
  // em navegador headless).
  await page.addInitScript(() => {
    window.__playedSrcs = [];
    const realPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__playedSrcs.push(this.src);
      try { return realPlay.call(this); } catch (e) { return Promise.resolve(); }
    };
  });

  // Registra os mocks de Recados/Time/REIS ANTES do login -- loadHome()
  // só roda 1 vez, no boot logo após o login (nem clicar em #navHome de
  // novo depois recarrega os dados, só troca a tela visível), então pra
  // esses mocks valerem de verdade eles precisam estar de pé ANTES desse
  // boot, não depois.
  await page.route('**/api/recados/for-me', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ recados: [1, 2, 3, 4, 5].map(fakeRecado) })
  }));
  await page.route('**/api/auth/team', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ users: FAKE_TEAM }) }));
  let reisCounts = { 'user-fake-1': 5, 'user-fake-2': 1 };
  await page.route('**/api/demandas/reis-do-marketing', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ counts: reisCounts }) }));

  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  // O boot pós-login faz vários `await` em sequência (dashboards, recados,
  // resumo de demandas, REIS DO MARKETING...) e só DEPOIS disso liga os
  // handlers de clique da navegação lateral -- clicar em qualquer botão do
  // menu antes disso terminar não faz nada (não tem handler ainda ainda).
  // Espera o REIS DO MARKETING renderizar, o ÚLTIMO passo de loadHome(),
  // como sinal de que o boot -- e junto os handlers de clique -- já
  // terminaram de verdade.
  await page.waitForSelector('#reisMarketingChart .reis-bar-col', { timeout: 15000 });

  // ---------- 1. Som de "chamar atenção" também pra quem manda ----------
  await page.click('#navChat').catch(() => {});
  await page.waitForSelector('#view-chat:not([hidden])', { timeout: 10000 }).catch(() => {});
  // Garante que uma conversa está de fato selecionada (dispara loadChat()
  // -> applyChatHeader(), que desconde o botão) -- clicar só em #navChat
  // pode não bastar se a lista de conversas ainda está carregando.
  await page.waitForSelector('.chat-conversation-item', { timeout: 10000 }).catch(() => {});
  await page.locator('.chat-conversation-item').first().click().catch(() => {});
  await page.waitForFunction(() => {
    const el = document.querySelector('#chatNudgeBtn');
    return el && !el.hidden && el.getBoundingClientRect().width > 0;
  }, { timeout: 15000 }).catch(() => {});
  if (await page.isVisible('#chatNudgeBtn')) {
    await page.evaluate(() => { window.__playedSrcs = []; });
    await page.click('#chatNudgeBtn');
    await page.waitForFunction(() => window.__playedSrcs.some((s) => s.includes('nudge.mp3')), { timeout: 10000 }).catch(() => {});
    const playedNudge = await page.evaluate(() => window.__playedSrcs.some((s) => s.includes('nudge.mp3')));
    check('clicar em "Chamar atenção" toca nudge.mp3 pra quem MANDOU (13ª melhoria)', playedNudge);
  } else {
    check('botão de "Chamar atenção" encontrado no Chat (pré-requisito do teste acima)', false);
  }

  // ---------- 2. Recados: até 3 na tela, resto com rolagem ----------
  await page.click('#navHome');
  await page.waitForSelector('#recadosForMe .recado-card', { timeout: 10000 });
  const cardCount = await page.locator('#recadosForMe .recado-card').count();
  check('os 5 recados de teste estão todos no DOM (rolagem, não paginação)', cardCount === 5);
  const overflowY = await page.evaluate(() => getComputedStyle(document.querySelector('#recadosForMe')).overflowY);
  check('lista de recados tem rolagem própria (overflow-y) quando passa de poucos itens', overflowY === 'auto' || overflowY === 'scroll');
  const hasRealOverflow = await page.evaluate(() => {
    const el = document.querySelector('#recadosForMe');
    return el.scrollHeight > el.clientHeight;
  });
  check('conteúdo passa da altura visível (scrollHeight > clientHeight -- mostra só parte, resto rola)', hasRealOverflow);

  // ---------- 3. Som de troca de "rei" no REIS DO MARKETING ----------
  // O gráfico já carregou 1x no boot (loadHome(), com reisCounts=A —
  // user-fake-1 na frente) -- confirma que essa 1ª carga da sessão não
  // tocou som nenhum (só define quem é o rei atual como base).
  await page.click('#navHome');
  await page.waitForSelector('#reisMarketingChart .reis-bar-col', { timeout: 10000 });
  const playedBeforeChange = await page.evaluate(() => window.__playedSrcs.some((s) => s.includes('reis.mp3')));
  check('carga inicial do gráfico NÃO toca som (só define quem é o rei atual como base)', !playedBeforeChange);
  // Troca o "rei" (user-fake-2 passa à frente) -- o próximo ciclo do
  // polling de 15s (startReisMarketingPolling) vai buscar essa mudança
  // sozinho, já que a tela Início está ativa; espera a PRÓXIMA chamada de
  // verdade à rota (não um clique/reload, que não reconsulta a API).
  reisCounts = { 'user-fake-1': 2, 'user-fake-2': 9 };
  await page.waitForResponse((res) => res.url().includes('/api/demandas/reis-do-marketing'), { timeout: 20000 });
  await page.waitForFunction(() => window.__playedSrcs.some((s) => s.includes('reis.mp3')), { timeout: 5000 }).catch(() => {});
  const playedOnChange = await page.evaluate(() => window.__playedSrcs.some((s) => s.includes('reis.mp3')));
  check('troca de "rei" toca reis.mp3 (13ª melhoria)', playedOnChange);

  // ---------- 4. Botões-pai de submenu ficam coloridos ao clicar ----------
  await page.evaluate(() => document.querySelectorAll('.navlink').forEach((b) => b.classList.remove('active')));
  await page.click('#navBudgetParent');
  const budgetActiveRightAway = await page.evaluate(() => document.querySelector('#navBudgetParent').classList.contains('active'));
  check('"Budget" fica colorido assim que clicado (antes só depois de escolher a marca)', budgetActiveRightAway);
  await page.click('#navExpositoresParent');
  const expositoresActiveRightAway = await page.evaluate(() => document.querySelector('#navExpositoresParent').classList.contains('active'));
  check('"Expositores" fica colorido assim que clicado', expositoresActiveRightAway);
  const budgetStillActive = await page.evaluate(() => document.querySelector('#navBudgetParent').classList.contains('active'));
  check('clicar em outro botão-pai desmarca o anterior (só 1 ativo por vez, como o resto do menu)', !budgetStillActive);

  check('nenhum erro de console em todo o fluxo', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
