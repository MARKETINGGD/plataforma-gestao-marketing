// Teste visual (Playwright) da 86ª rodada -- complementa o teste de
// integração espelharFacebookManual86.test.js, cobrindo a parte que só
// existe na TELA:
//
//   - O aviso "⚠ sem espelho" aparecendo na lista do Agendamento, num
//     post de Instagram (De Bacco/GhelPlus) que ainda não tem a cópia no
//     Facebook (mesmo aviso aparece na Prévia do Feed).
//   - O aviso + botão "🔗 Espelhar no Facebook também" aparecendo dentro
//     do formulário de edição desse post.
//   - Clicar no botão cria o espelho de verdade (confirma via API) e a
//     tela atualiza sozinha: o aviso de "sem espelho" some da lista e do
//     formulário, e a faixa normal de espelhamento aparece no lugar.
//
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

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // ---------- setup via API ----------
  const loginSetup = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' })
  }).then((r) => r.json());
  const adminToken = loginSetup.token;
  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }
  const analista = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'analistapw86', password: '123456', name: 'Analista PW 86', cargo: 'analista' })
  }).then((r) => r.json()).then((d) => d.user);
  const analistaToken = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'analistapw86', password: '123456' })
  }).then((r) => r.json()).then((d) => d.token);

  // Mesmo truque do teste de integração: cria como Facebook (nunca
  // espelha) e troca pra Instagram via PUT (que também nunca espelha) --
  // simula um post "legado" de Instagram sem nenhum dos dois lados do
  // espelho, igual ao caso real que a Raquel bateu.
  const legadoCriado = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({
      brand: 'debacco', platform: 'facebook', postType: 'estatico', status: 'rascunho',
      scheduledDate: '2026-10-25', scheduledTime: '15:00', caption: 'Legenda do legado PW 86',
      subject: 'Assunto Legado PW 86', involvedUserIds: [analista.id], responsibleId: analista.id
    })
  }).then((r) => r.json());
  const legadoId = legadoCriado.post.id;
  await fetch(`${BASE}/api/social-posts/${legadoId}`, { method: 'PUT', headers: hj(analistaToken), body: JSON.stringify({ platform: 'instagram' }) });

  const page = await browser.newPage({ serviceWorkers: 'block' });
  const alerts = [];
  page.on('dialog', async (d) => { alerts.push(d.message()); await d.accept(); });

  await page.goto(BASE);
  await page.fill('#loginUsername', 'analistapw86');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(500);

  // ---------- Agendamento: lista mostra o aviso "sem espelho" ----------
  await page.click('#navAgendamento');
  await page.waitForSelector('#view-agendamento:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.click('.tab-btn[data-social-tab="debacco"]');
  await page.waitForTimeout(400);

  const legadoRow = page.locator('#socialPostsBody tr', { hasText: 'Legenda do legado PW 86' });
  await legadoRow.waitFor({ timeout: 10000 });
  check('a linha do post legado mostra o aviso "⚠ sem espelho" na lista', await legadoRow.locator('.badge-danger', { hasText: 'sem espelho' }).isVisible());

  // ---------- Formulário de edição mostra o aviso + botão ----------
  await legadoRow.getByRole('button', { name: 'Editar' }).click();
  await page.waitForSelector('#socialPostFormWrap:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(300);
  check('o formulário mostra o aviso de "sem espelho" (wrap visível)', await page.isVisible('#socialPostFormMirrorMissingWrap'));
  check('o botão "Espelhar no Facebook também" está visível', await page.isVisible('#socialPostFormMirrorMissingBtn'));
  check('a faixa normal de espelhamento (mirroredToPostId/mirroredFromPostId) NÃO aparece ainda (não tem nenhum dos dois lados)', !(await page.isVisible('#socialPostFormMirrorInfo')));

  // ---------- Clica no botão -> cria o espelho de verdade ----------
  await page.click('#socialPostFormMirrorMissingBtn');
  await page.waitForTimeout(1200);
  check('o alerta de sucesso do espelhamento manual apareceu', alerts.some((a) => /agora também tem uma cópia no Facebook/i.test(a)));

  const legadoFresh = await fetch(`${BASE}/api/social-posts`, { headers: hj(adminToken) })
    .then((r) => r.json()).then((d) => d.posts.find((p) => p.id === legadoId));
  check('o post original ganhou mirroredToPostId de verdade (via API)', !!(legadoFresh && legadoFresh.mirroredToPostId));

  // Formulário reabriu sozinho pro mesmo post (ver o onclick do botão) --
  // agora precisa mostrar a faixa normal, não mais o aviso de "sem espelho".
  await page.waitForTimeout(300);
  check('depois de espelhar, o aviso de "sem espelho" sumiu do formulário', !(await page.isVisible('#socialPostFormMirrorMissingWrap')) || (await page.locator('#socialPostFormMirrorMissingWrap').getAttribute('hidden')) !== null);
  const mirrorInfoText = await page.evaluate(() => {
    const el = document.getElementById('socialPostFormMirrorInfo');
    return el && !el.hidden ? el.textContent : null;
  });
  check('a faixa normal de espelhamento aparece agora ("foi espelhado automaticamente no Facebook")', !!(mirrorInfoText && /espelhado automaticamente no Facebook/i.test(mirrorInfoText)));

  await page.click('#socialPostFormCancel');
  await page.waitForTimeout(300);

  // ---------- A lista também não mostra mais "sem espelho" pra este post ----------
  const legadoRowDepois = page.locator('#socialPostsBody tr', { hasText: 'Legenda do legado PW 86' });
  check('na lista, a linha original agora mostra "🔗 Facebook" em vez de "sem espelho"', await legadoRowDepois.locator('.badge', { hasText: 'Facebook' }).isVisible());
  check('não sobrou nenhum aviso de "sem espelho" nessa linha', (await legadoRowDepois.locator('.badge-danger').count()) === 0);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
