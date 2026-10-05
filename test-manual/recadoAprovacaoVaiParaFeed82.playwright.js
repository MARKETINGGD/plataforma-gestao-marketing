// Teste de integração (servidor de verdade + navegador de verdade,
// mesmo padrão dos *.test.js que sobem o próprio server.js -- ver
// aprovacaoCargoAdmin79.test.js -- combinado com Playwright, igual os
// outros *.playwright.js desta pasta) da 82ª rodada, pedido direto da
// Raquel, em cima de um clique com a tela de Recados aberta (mural da
// Início):
//
//   "quando vem o pedido de aprovação, ao clicar nele, deve ser
//   direcionado para a previa do feed, onde ele esta cadastrado para
//   aprovar, ajuste isso por favor"
//
// Antes, TODO recado automático com post ligado (sourceSocialPostId) ia
// pro Agendamento (formulário de edição) ao ser clicado -- inclusive o
// aviso de "pronto pra aprovar" (kind 'post_ready_for_approval'), que é
// visto SÓ por quem pode aprovar (admin/gerente/coordenador). Esse
// público clicando ali quer aprovar/reprovar, ação que só existe na
// Prévia do Feed (dentro de Cronograma) -- não no formulário de edição.
// Agora openPostInFeedPreview() (ver public/app.js) leva direto pra lá,
// já na marca/mês/rede certos, com o card do post piscando.
//
// Sobe o PRÓPRIO server.js numa porta dedicada (não mexe no servidor
// compartilhado de dev, porta 4123, nem no banco de produção -- faz
// backup/restauração de data/db.json, mesmo padrão de todo
// *.test.js desta pasta). Precisa ser um servidor PRÓPRIO (não o
// compartilhado) porque o teste escreve direto no banco (`db.get(...)`)
// pra simular o arquivo de criativo já anexado (sem precisar fazer um
// upload de verdade) -- isso só funciona com certeza de estar vendo o
// MESMO processo/instância de banco que o servidor que o navegador vai
// bater, o que só é garantido rodando o próprio server.js aqui dentro
// (ver comentário de `require('../server')` abaixo).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

process.env.JWT_SECRET = 'teste-recado-aprovacao-feed-82';
process.env.PORT = '4346';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4346';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-recado-aprovacao-feed-82-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

async function run() {
  let failures = 0;
  function check(label, cond) {
    console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
    if (!cond) failures++;
  }

  // Mesmo módulo/instância de banco que o server.js vai usar -- por isso
  // vem ANTES de criar qualquer dado (o require abaixo só garante o
  // cache do Node; a ordem de uso é que importa).
  require('../server');
  await new Promise((r) => setTimeout(r, 800));
  const db = require('../db');

  const BASE = 'http://localhost:4346';
  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }
  async function login(username, password) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then((r) => r.json());
    return res.token;
  }

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  let adminToken;
  if (statusRes.needsSetup) {
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Raquel', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
  } else {
    adminToken = await login('admin', '123456');
  }
  check('login/setup do admin devolveu token', !!adminToken);
  const adminUser = (await fetch(`${BASE}/api/auth/me`, { headers: hj(adminToken) }).then((r) => r.json())).user;
  // super_admin (isSuperAdmin) já entra no público de notifyReadyForApproval
  // (ver routes/socialPosts.js) mesmo sem cargo gerente/coordenador --
  // não precisa setar cargo aqui, diferente do teste da 79ª rodada.

  // ---------- Post de teste: Instagram/GhelPlus, mês bem no futuro ----------
  const futureDate = '2027-03-15';
  const createRes = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({
      brand: 'ghelplus', platform: 'instagram', postType: 'feed',
      scheduledDate: futureDate, scheduledTime: '10:00',
      subject: 'Teste 82ª rodada -- pedido de aprovação', caption: 'Legenda de teste',
      involvedUserIds: [adminUser.id], responsibleId: adminUser.id
    })
  }).then((r) => r.json());
  check('post de teste criado (200)', !!(createRes.post && createRes.post.id));
  const postId = createRes.post.id;

  // Simula o criativo já anexado (sem upload de verdade) -- escreve
  // direto no banco (mesmo processo do server, ver require acima) e
  // reedita via PUT pra disparar notifyReadyForApproval(), exatamente
  // como aprovacaoCargoAdmin79.test.js já faz pro mesmo propósito.
  db.get('socialPosts').find({ id: postId }).assign({
    files: [{ id: 'f1', url: '/uploads/social/x/creative/teste82.jpg', name: 'teste82.jpg' }]
  }).write();
  await fetch(`${BASE}/api/social-posts/${postId}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ scheduledTime: '11:00' })
  });

  const recadosForMe = await fetch(`${BASE}/api/recados/for-me`, { headers: hj(adminToken) }).then((r) => r.json());
  const recadoAprovacao = recadosForMe.recados.find((r) => r.sourceSocialPostId === postId && r.kind === 'post_ready_for_approval');
  check('o recado de "pedido de aprovação" foi criado de verdade (notifyReadyForApproval)', !!recadoAprovacao);

  // ---------- Navegador de verdade: clicar no recado leva até a Prévia do Feed ----------
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(500);

  // Filtra pelo título do post (o "subject" único deste teste), não só
  // pelo texto fixo do aviso -- este servidor roda sobre uma CÓPIA do
  // banco de dev já cheio de recados de teste de rodadas/sweeps
  // anteriores nesta mesma sessão, alguns com esse mesmo texto fixo
  // (achado rodando este teste pela 1ª vez: `.first()` pegava um recado
  // antigo de outro post, não o deste teste).
  const recadoCard = page.locator('.recado-card-clickable', { hasText: 'Teste 82ª rodada -- pedido de aprovação' }).first();
  check('o recado de "pedido de aprovação" aparece na tela Início', await recadoCard.count() > 0);
  await recadoCard.click();
  await page.waitForTimeout(700);

  const state = await page.evaluate(() => ({
    viewCronogramaVisible: !document.getElementById('view-cronograma').hidden,
    viewAgendamentoVisible: !document.getElementById('view-agendamento').hidden,
    feedTabActive: document.querySelector('.tab-btn[data-cronograma-tab="feed"]').classList.contains('active'),
    feedWrapVisible: !document.getElementById('cronogramaFeedWrap').hidden,
    calendarioWrapVisible: !document.getElementById('cronogramaCalendarioWrap').hidden,
    brandTabActive: document.querySelector('.tab-btn[data-cronograma-brand="ghelplus"]').classList.contains('active'),
    networkTabActive: document.querySelector('.tab-btn[data-feed-network="ig_fb"]').classList.contains('active'),
    monthLabel: document.getElementById('cronogramaMonthLabel').textContent,
    highlightedCardPostId: (() => {
      const el = document.querySelector('.feed-preview-card.feed-preview-card-highlight');
      return el ? el.dataset.postId : null;
    })()
  }));

  check('foi direcionado pra tela Cronograma (não Agendamento)', state.viewCronogramaVisible && !state.viewAgendamentoVisible);
  check('a aba ativa é "Prévia do Feed" (não Calendário)', state.feedTabActive && state.feedWrapVisible && !state.calendarioWrapVisible);
  check('a marca certa (GhelPlus) ficou selecionada', state.brandTabActive);
  check('a sub-aba de rede certa (Instagram/Facebook) ficou selecionada', state.networkTabActive);
  check('o mês certo (março de 2027) ficou selecionado', state.monthLabel.includes('2027') && /[Mm]arço/.test(state.monthLabel));
  check('o card destacado é mesmo o post do recado (fácil de achar entre outros)', state.highlightedCardPostId === postId);

  const approvalWidgetVisible = await page.evaluate((pid) => {
    const card = document.querySelector(`.feed-preview-card[data-post-id="${pid}"]`);
    return !!(card && card.querySelector('.approval-widget .approval-square'));
  }, postId);
  check('o quadradinho de aprovar/reprovar está ali no card certo ("onde ele esta cadastrado para aprovar")', approvalWidgetVisible);

  await page.close();

  // ---------- Avisos que NÃO são pedido de aprovação continuam indo pro Agendamento ----------
  await fetch(`${BASE}/api/social-posts/${postId}/approval`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ approvalStatus: 'aprovado' })
  });
  // `manualOverride: true` -- sem isso, a Papoi tentaria publicar de
  // verdade no Instagram/Facebook (11ª melhoria), e falharia com 422 por
  // não ter nenhuma conta conectada nesse banco de teste. Marcar na mão é
  // suficiente aqui -- só precisamos do recado "publicado" que essa
  // transição dispara, não de publicar nada de verdade.
  await fetch(`${BASE}/api/social-posts/${postId}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ status: 'publicado', manualOverride: true })
  });
  const recadosForMe2 = await fetch(`${BASE}/api/recados/for-me`, { headers: hj(adminToken) }).then((r) => r.json());
  const recadoPublicado = recadosForMe2.recados.find((r) => r.sourceSocialPostId === postId && r.kind === 'post_published');
  check('o recado de "publicado" (não é pedido de aprovação) foi criado', !!recadoPublicado);

  const page2 = await browser.newPage({ serviceWorkers: 'block' });
  await page2.goto(BASE);
  await page2.fill('#loginUsername', 'admin');
  await page2.fill('#loginPassword', '123456');
  await page2.click('#loginSubmit');
  await page2.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page2.waitForTimeout(500);
  const recado2Card = page2.locator('.recado-card-clickable', { hasText: 'foi marcado como publicado' }).first();
  check('o recado de "publicado" aparece na tela Início', await recado2Card.count() > 0);
  await recado2Card.click();
  await page2.waitForTimeout(700);
  const state2 = await page2.evaluate(() => ({
    viewAgendamentoVisible: !document.getElementById('view-agendamento').hidden,
    formOpen: !document.getElementById('socialPostFormWrap').hidden
  }));
  check('recado de "publicado" continua indo pro Agendamento (comportamento antigo, intocado)', state2.viewAgendamentoVisible && state2.formOpen);
  await page2.close();

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
