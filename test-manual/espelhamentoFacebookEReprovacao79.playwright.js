// Teste visual (Playwright) da 79ª rodada -- complementa o teste de
// integração espelhamentoFacebookEReprovacao79.test.js, cobrindo a parte
// que só existe na TELA (não dá pra checar batendo direto na API):
//
//   - O aviso (alert) confirmando que o post nasceu espelhado no Facebook
//     ao criar um agendamento de Instagram para De Bacco/GhelPlus.
//   - A faixa "🔗 Este post nasceu do espelhamento automático..." ao abrir
//     pra editar o post espelho (Facebook), na aba Agendamento.
//   - O botão "✓ Já ajustei -- reenviar para aprovação" aparecendo SÓ pra
//     quem é responsável (estrelinha) num post reprovado, no quadradinho
//     de aprovação da Prévia do Feed (Cronograma), e reenviando de verdade
//     pra aprovação ao clicar.
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

  // ---------- setup via API (mais rápido/estável que clicar tudo na tela) ----------
  const setupRes = await fetch(`${BASE}/api/auth/setup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Admin PW', username: 'admin', password: '123456' })
  }).then((r) => r.json());
  const adminToken = setupRes.token;
  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }
  const adminUser = await fetch(`${BASE}/api/auth/me`, { headers: hj(adminToken) }).then((r) => r.json()).then((d) => d.user);
  await fetch(`${BASE}/api/auth/users/${adminUser.id}`, { method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ cargo: 'coordenador' }) });
  const analista = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'analistapw79', password: '123456', name: 'Analista PW', cargo: 'analista' })
  }).then((r) => r.json()).then((d) => d.user);

  const page = await browser.newPage({ serviceWorkers: 'block' });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') { consoleErrors.push(msg.text()); console.log('[console.error]', msg.text()); } });
  page.on('pageerror', (err) => { consoleErrors.push(String(err)); console.log('[pageerror]', String(err)); });
  const alerts = [];
  page.on('dialog', async (d) => { alerts.push(d.message()); await d.accept(); });

  await page.goto(BASE);
  await page.fill('#loginUsername', 'analistapw79');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(1000);

  // ---------- Agendamento: aba GhelPlus, "Novo agendamento", post Instagram ----------
  // Data dentro do mês atual (hoje é 2026-09-30) -- evita ter que navegar
  // de mês na Prévia do Feed do Cronograma mais abaixo.
  const TEST_DATE = '2026-09-30';
  await page.click('#navAgendamento');
  await page.waitForSelector('#view-agendamento:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.click('.tab-btn[data-social-tab="ghelplus"]');
  await page.waitForTimeout(300);
  await page.click('#socialPostNewBtn');
  await page.waitForSelector('#socialPostFormWrap:not([hidden])', { timeout: 10000 });

  await page.selectOption('#socialPostFormBrand', 'ghelplus');
  await page.selectOption('#socialPostFormPlatform', 'instagram');
  await page.fill('#socialPostFormDate', TEST_DATE);
  await page.fill('#socialPostFormCaption', 'Legenda do teste Playwright 79');
  // Marca a analista como envolvida + responsável (estrelinha) -- os chips
  // de #socialPostFormInvolvedList não têm atributo por usuário, só o nome
  // no texto do <label>, então localiza pelo texto.
  const chip = page.locator('#socialPostFormInvolvedList .chip-toggle', { hasText: 'Analista PW' });
  await chip.locator('input[type="checkbox"]').check();
  await page.waitForTimeout(150);
  await chip.locator('.chip-responsible-btn').click();
  await page.waitForTimeout(300);

  await page.click('#socialPostFormSave');
  await page.waitForTimeout(1500);

  check('alerta de espelhamento automático apareceu ao criar post Instagram/GhelPlus', alerts.some((a) => /espelhado automaticamente no Facebook/i.test(a)));

  // ---------- confirma pela API qual foi o post/espelho criados (mais robusto que farejar a tela) ----------
  const igPost = await fetch(`${BASE}/api/social-posts`, { headers: hj(adminToken) })
    .then((r) => r.json()).then((d) => d.posts.find((p) => p.platform === 'instagram' && p.caption === 'Legenda do teste Playwright 79'));
  check('post de Instagram foi criado de verdade (via API)', !!igPost);
  check('post de Instagram ganhou mirroredToPostId', !!(igPost && igPost.mirroredToPostId));

  if (igPost && igPost.mirroredToPostId) {
    // Fecha o formulário atual (já reaproveitado pra edição do post recém-
    // criado) e abre de novo, agora pro post ESPELHO (Facebook) -- via
    // Editar na linha da tabela, igual a pessoa faria de verdade.
    await page.click('#socialPostFormCancel');
    await page.waitForTimeout(300);
    // A mesma legenda aparece em 2 linhas (post original de Instagram + o
    // espelho de Facebook) -- distingue pela coluna de rede social.
    const mirrorRow = page.locator('#socialPostsBody tr', { hasText: 'Legenda do teste Playwright 79' }).filter({ hasText: 'Facebook' });
    await mirrorRow.getByRole('button', { name: 'Editar' }).click();
    await page.waitForSelector('#socialPostFormWrap:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(400);
    const mirrorInfoVisible = await page.evaluate(() => {
      const el = document.getElementById('socialPostFormMirrorInfo');
      return el && !el.hidden ? el.textContent : null;
    });
    check('faixa de espelhamento aparece ao abrir o post ESPELHO (Facebook) pra editar', !!(mirrorInfoVisible && /nasceu do espelhamento automático/i.test(mirrorInfoVisible)));
    await page.click('#socialPostFormCancel');
    await page.waitForTimeout(300);
  }

  // ---------- reprovação + botão de reenvio (quadradinho de aprovação, Cronograma > Prévia do Feed) ----------
  if (igPost) {
    // Upload de um criativo qualquer (só pra ficar "pronto pra aprovar" e poder reprovar).
    const fakeBuf = Buffer.from('fake-pw-79');
    const form = new (globalThis.FormData)();
    form.append('file', new (globalThis.Blob)([fakeBuf], { type: 'image/jpeg' }), 'pw79.jpg');
    await fetch(`${BASE}/api/social-posts/${igPost.id}/files`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: form });
    await fetch(`${BASE}/api/social-posts/${igPost.id}/approval`, {
      method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ approvalStatus: 'reprovado', approvalNotes: 'Ajustar o texto do post, por favor.' })
    });

    await page.reload();
    await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
    await page.click('#navCronograma');
    await page.waitForSelector('#view-cronograma:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.click('#view-cronograma .tabs .tab-btn[data-cronograma-brand="ghelplus"]');
    await page.click('#view-cronograma [data-cronograma-tab="feed"]');
    await page.waitForSelector('#cronogramaFeedWrap:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(500);

    const feedCard = page.locator('#cronogramaFeedList .feed-preview-card', { hasText: 'Legenda do teste Playwright 79' });
    check('o card do post reprovado aparece na Prévia do Feed (Instagram/Facebook, GhelPlus, mês atual)', await feedCard.count() > 0);

    const resubmitBtn = feedCard.locator('button', { hasText: 'Já ajustei' });
    check('botão "✓ Já ajustei -- reenviar para aprovação" aparece pro responsável no post reprovado', await resubmitBtn.count() > 0);

    if (await resubmitBtn.count() > 0) {
      await resubmitBtn.first().click();
      await page.waitForTimeout(1000);
      const postAfter = await fetch(`${BASE}/api/social-posts`, { headers: hj(adminToken) }).then((r) => r.json()).then((d) => d.posts.find((p) => p.id === igPost.id));
      check('clicar no botão reenviou o post pra aprovação (approvalStatus volta pra pendente)', postAfter && postAfter.approvalStatus === 'pendente');
    }
  }

  check('nenhum erro de console/JS durante o teste', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console encontrados:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
