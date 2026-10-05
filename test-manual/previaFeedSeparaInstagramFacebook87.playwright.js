// Teste visual (Playwright) da 87ª rodada -- cobre a 3ª parte do pedido
// da Raquel que só existe na TELA (a parte de publicar de verdade já é
// coberta por espelharFacebookPublicaDeVerdade87.test.js):
//
//   "e separe a previa do feed do Instagram e do Facebook, para n foicar
//   confuso. Mas mantenha o espelhamento no card, quando for instagram e
//   face."
//
// Antes, a Prévia do Feed tinha uma única aba "Instagram / Facebook"
// (chave ig_fb em FEED_NETWORKS, public/app.js) misturando os posts das
// duas redes na mesma lista -- confuso quando as duas tinham posts no
// mesmo mês. Agora cada rede tem sua própria aba, mas o aviso/badge de
// espelhamento no card (🔗 Facebook / 🔗 Instagram / ⚠ sem espelho)
// continua aparecendo nos dois lados quando o post tem par espelhado.
//
// Sobe o PRÓPRIO server.js numa porta dedicada (mesmo padrão de
// recadoAprovacaoVaiParaFeed82.playwright.js) -- não mexe no servidor
// compartilhado de dev nem no banco de produção.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

process.env.JWT_SECRET = 'teste-previa-feed-separa-ig-fb-87';
process.env.PORT = '4348';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4348';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-previa-feed-separa-ig-fb-87-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

const BASE = 'http://localhost:4348';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function run() {
  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }
  // Mesmo db.json real é reaproveitado (copiado de volta no final) -- já
  // tem admin configurado de rodadas anteriores, então tenta login
  // primeiro e só cai no /setup se for mesmo um banco novo/vazio (mesmo
  // padrão de espelharFacebookManual86.test.js/espelharFacebookPublicaDeVerdade87.test.js).
  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  let adminToken;
  let adminId;
  if (statusRes.needsSetup) {
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin PW 87', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
    adminId = setupRes.user && setupRes.user.id;
  } else {
    adminToken = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456' })
    }).then((r) => r.json()).then((d) => d.token);
    adminId = await fetch(`${BASE}/api/auth/me`, { headers: hj(adminToken) }).then((r) => r.json()).then((d) => d.user && d.user.id);
  }
  check('login/setup do admin devolveu token', !!adminToken);

  const FUTURE_DATE = '2027-04-10';

  // Post de Instagram (GhelPlus) -- nasce JÁ espelhado automaticamente
  // (79ª rodada), então os dois lados do par aparecem prontos sem
  // precisar clicar em "Espelhar" na tela.
  const igCriado = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({
      brand: 'ghelplus', platform: 'instagram', postType: 'estatico', status: 'rascunho',
      scheduledDate: FUTURE_DATE, scheduledTime: '10:00', caption: 'Legenda do par espelhado PW 87',
      subject: 'Assunto par espelhado PW 87', involvedUserIds: [adminId], responsibleId: adminId
    })
  }).then((r) => r.json());
  check('post de Instagram criado', !!(igCriado.post && igCriado.post.id));
  check('nasceu já com o espelho automático no Facebook (79ª rodada)', !!igCriado.mirrorPost);
  const igId = igCriado.post.id;
  const fbMirrorId = igCriado.mirrorPost && igCriado.mirrorPost.id;

  // Post de Facebook "solo" (De Bacco) -- sem par nenhum, pra confirmar
  // que a aba de Facebook também mostra posts que nunca tiveram Instagram
  // ligado.
  const fbSoloCriado = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({
      brand: 'debacco', platform: 'facebook', postType: 'estatico', status: 'rascunho',
      scheduledDate: FUTURE_DATE, scheduledTime: '11:00', caption: 'Legenda Facebook solo PW 87',
      subject: 'Assunto Facebook solo PW 87', involvedUserIds: [adminId], responsibleId: adminId
    })
  }).then((r) => r.json());
  check('post de Facebook solo criado', !!(fbSoloCriado.post && fbSoloCriado.post.id));

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') { consoleErrors.push(msg.text()); console.log('[console.error]', msg.text()); } });
  page.on('pageerror', (err) => { consoleErrors.push(String(err)); console.log('[pageerror]', String(err)); });

  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(500);

  await page.click('#navCronograma');
  await page.waitForSelector('#view-cronograma:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(300);
  await page.click('#view-cronograma [data-cronograma-tab="feed"]');
  await page.waitForSelector('#cronogramaFeedWrap:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(300);

  // Confirma que as duas abas (Instagram / Facebook) existem separadas,
  // em vez da única aba antiga "Instagram / Facebook" (ig_fb).
  const tabsExist = await page.evaluate(() => ({
    igTab: !!document.querySelector('.tab-btn[data-feed-network="instagram"]'),
    fbTab: !!document.querySelector('.tab-btn[data-feed-network="facebook"]'),
    oldCombinedTab: !!document.querySelector('.tab-btn[data-feed-network="ig_fb"]')
  }));
  check('aba própria do Instagram existe', tabsExist.igTab);
  check('aba própria do Facebook existe', tabsExist.fbTab);
  check('a aba antiga combinada (ig_fb) NÃO existe mais', !tabsExist.oldCombinedTab);

  // ---------- Aba Instagram: navega até o mês do teste, GhelPlus ----------
  await page.click('.tab-btn[data-feed-network="instagram"]');
  await page.waitForTimeout(200);
  await page.click('#view-cronograma .tabs .tab-btn[data-cronograma-brand="ghelplus"]');
  await page.waitForTimeout(200);
  // Navega os meses até abril/2027 usando o botão "próximo mês" do
  // Cronograma (mesmo elemento usado pelas duas abas, Calendário/Feed).
  for (let i = 0; i < 24; i++) {
    const label = await page.locator('#cronogramaMonthLabel').textContent();
    if (/2027/.test(label) && /[Aa]bril/.test(label)) break;
    await page.click('#cronogramaNextMonth');
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(300);

  const igTabState = await page.evaluate((pid) => {
    const card = document.querySelector(`.feed-preview-card[data-post-id="${pid}"]`);
    return {
      cardExists: !!card,
      badgeTitle: card ? (card.querySelector('.badge') && card.querySelector('.badge').getAttribute('title')) : null,
      badgeText: card ? (card.querySelector('.badge') && card.querySelector('.badge').textContent) : null
    };
  }, igId);
  check('na aba Instagram, o card do post de Instagram aparece', igTabState.cardExists);
  check('o badge de espelhamento aparece no card do Instagram (aponta pro Facebook)', igTabState.badgeTitle && /Também agendado no Facebook/i.test(igTabState.badgeTitle));
  check('o texto do badge no lado Instagram é "🔗 Facebook"', igTabState.badgeText && /Facebook/.test(igTabState.badgeText));

  const fbCardOnIgTab = await page.evaluate((pid) => !!document.querySelector(`.feed-preview-card[data-post-id="${pid}"]`), fbMirrorId);
  check('o espelho (Facebook) NÃO aparece na aba Instagram (abas separadas de verdade)', !fbCardOnIgTab);

  // ---------- Aba Facebook: confirma o espelho E o post solo da De Bacco, cada um na marca certa ----------
  await page.click('.tab-btn[data-feed-network="facebook"]');
  await page.waitForTimeout(300);
  await page.click('#view-cronograma .tabs .tab-btn[data-cronograma-brand="ghelplus"]');
  await page.waitForTimeout(300);

  const fbTabState = await page.evaluate((pid) => {
    const card = document.querySelector(`.feed-preview-card[data-post-id="${pid}"]`);
    return {
      cardExists: !!card,
      badgeTitle: card ? (card.querySelector('.badge') && card.querySelector('.badge').getAttribute('title')) : null,
      badgeText: card ? (card.querySelector('.badge') && card.querySelector('.badge').textContent) : null
    };
  }, fbMirrorId);
  check('na aba Facebook, o card do espelho aparece', fbTabState.cardExists);
  check('o badge de espelhamento aparece no card do Facebook (aponta pro Instagram)', fbTabState.badgeTitle && /espelhamento automático do Instagram/i.test(fbTabState.badgeTitle));
  check('o texto do badge no lado Facebook é "🔗 Instagram"', fbTabState.badgeText && /Instagram/.test(fbTabState.badgeText));

  const igCardOnFbTab = await page.evaluate((pid) => !!document.querySelector(`.feed-preview-card[data-post-id="${pid}"]`), igId);
  check('o post original (Instagram) NÃO aparece na aba Facebook', !igCardOnFbTab);

  // Post de Facebook solo (De Bacco) -- troca de marca e confirma que
  // aparece na aba Facebook, sem nenhum badge de espelhamento.
  await page.click('#view-cronograma .tabs .tab-btn[data-cronograma-brand="debacco"]');
  await page.waitForTimeout(300);
  const fbSoloState = await page.evaluate((pid) => {
    const card = document.querySelector(`.feed-preview-card[data-post-id="${pid}"]`);
    return { cardExists: !!card, hasBadge: !!(card && card.querySelector('.badge')) };
  }, fbSoloCriado.post.id);
  check('post de Facebook solo (sem Instagram ligado) aparece na aba Facebook', fbSoloState.cardExists);
  check('post de Facebook solo não tem nenhum badge de espelhamento (nunca teve par)', !fbSoloState.hasBadge);

  check('nenhum erro de console/JS durante o teste', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console encontrados:', consoleErrors);

  await browser.close();

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(process.exitCode);
}

run().catch((e) => {
  console.error(e);
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(1);
});
