// Regressão Playwright (63ª rodada, "Rodada E" da Pendência 51, pedido
// direto da Raquel: "posts agendados/aprovados devem notificar só a dona
// do post (a estrelinha marcada)"). Isso INVERTE uma decisão da 42ª
// rodada ("ao aprovar os posts... todos devem receber a notificação") --
// o toast flutuante de "Post aprovado" (checkNewPostApprovals em
// public/app.js) agora só dispara pra quem é o responsável marcado no
// post (ou, sem ninguém marcado, quem criou/está envolvido).
//
// Também confere a dica nova do campo "Link" quando o tipo do post é
// Storie (pedido "Stories devem suportar um link clicável" -- como a
// Graph API da Meta não aceita link/sticker nenhum na publicação
// automática, a Papoi troca a promessa por uma dica clara de colar o
// link à mão no Instagram, ver storieLinkReminder em
// routes/socialPosts.js/utils/metaPublisher.js).
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

async function login(page) {
  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
}

function postsResponse(posts) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify({ posts }) };
}

function basePost(overrides) {
  return Object.assign({
    id: 'post1',
    brand: 'debacco',
    platform: 'instagram',
    postType: 'estatico',
    scheduledDate: '2026-12-31',
    approvalStatus: 'aprovado',
    approvedAt: '2026-09-24T10:00:00.000Z',
    approvedBy: 'someone-else-id',
    approvedByName: 'Fulana',
    responsibleId: null,
    createdBy: null,
    involvedUserIds: []
  }, overrides);
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  // ---------- Parte 1: toast de "Post aprovado" só pro responsável ----------
  // 1ª resposta mockada: nenhum post aprovado ainda -- define a base (sem
  // toast nenhum), igual ao 1º ciclo de todo watcher por polling da Papoi.
  let mockPosts = [];
  await page.route('**/api/social-posts', (route) => route.fulfill(postsResponse(mockPosts)));

  await login(page);
  await page.waitForSelector('#reisMarketingChart .reis-bar-col', { timeout: 15000 });
  // Mesma folga documentada em notificacaoSistema.playwright.js -- dá
  // tempo da 1ª checagem (que define a base) terminar antes de trocar o
  // mock, senão o post "novo" cai bem na 1ª checagem e vira só a base.
  await page.waitForTimeout(1500);

  // Descobre o id do usuário logado (admin) pra montar os posts mockados
  // -- direto de uma chamada à API, sem depender de estado interno do
  // front.
  const meRes = await page.evaluate(async () => {
    const token = localStorage.getItem('token');
    const r = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
    return (await r.json()).user;
  });
  const meId = meRes.id;

  // Post aprovado, mas o responsável marcado é OUTRA pessoa -- não deve
  // aparecer nenhum toast pro admin logado.
  mockPosts = [basePost({ id: 'post-outro-dono', responsibleId: 'outra-pessoa-id' })];
  await page.waitForFunction(() => document.querySelector('#reisMarketingChart .reis-bar-col'), { timeout: 5000 });
  await page.waitForTimeout(11000); // 1 ciclo do polling de 10s
  const toastVisibleForOutherOwner = await page.isVisible('#notifToast').catch(() => false);
  check('post aprovado de OUTRA pessoa responsável NÃO mostra toast pro admin', !toastVisibleForOutherOwner);

  // Agora o post aprovado é do PRÓPRIO admin (responsável marcado) --
  // precisa aparecer o toast "Post aprovado".
  mockPosts = [basePost({ id: 'post-meu', responsibleId: meId, approvedByName: 'Fulana' })];
  await page.waitForFunction(() => {
    const t = document.querySelector('#notifToast');
    return t && !t.hidden && /Post aprovado/i.test(t.textContent);
  }, { timeout: 15000 });
  check('post aprovado do PRÓPRIO admin (responsável) mostra o toast "Post aprovado"', true);

  // ---------- Parte 2: dica do campo Link pra Storie ----------
  await page.unroute('**/api/social-posts');
  await page.route('**/api/social-posts', (route) => route.fulfill(postsResponse([])));
  await page.click('#navAgendamento');
  await page.waitForSelector('#view-agendamento:not([hidden])', { timeout: 10000 });
  await page.click('#socialPostNewBtn').catch(async () => {
    // fallback -- alguns layouts usam um id diferente pro botão "+ novo"; a
    // aba já abre um formulário vazio por padrão em algumas versões.
  });
  await page.waitForSelector('#socialPostFormWrap:not([hidden])', { timeout: 10000 });
  await page.selectOption('#socialPostFormType', 'storie').catch(() => {});
  await page.waitForFunction(() => /sticker de link do Story/i.test(document.querySelector('#socialPostFormLinkHint').textContent), { timeout: 5000 });
  check('dica do campo Link avisa sobre o sticker de link do Story (colar à mão)', true);

  // Trocar pra outro tipo (Reels) volta pra dica normal (nenhuma, já que
  // Instagram não tem dica específica) -- confirma que não ficou "preso"
  // na dica de Storie.
  await page.selectOption('#socialPostFormType', 'reels').catch(() => {});
  await page.waitForFunction(() => !/sticker de link do Story/i.test(document.querySelector('#socialPostFormLinkHint').textContent), { timeout: 5000 });
  check('trocar pra outro tipo (Reels) tira a dica de Storie', true);

  check('nenhum erro de console em toda a navegação', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
