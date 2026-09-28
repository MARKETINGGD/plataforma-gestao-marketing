// Teste visual (Playwright) do modal de escolha/confirmação de conta da
// TikTok (76ª rodada, "Vamos para o tik tok, usamos ele na Ghel e na De
// Bacco, então precisaremos de 2 acessos") -- mesmo espírito de
// youtube-page-chooser.playwright.js: como ainda não existe nenhum teste
// real contra a API da TikTok nesta cópia isolada (depende de uma auditoria
// própria da TikTok pra publicar público, ver
// PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md), este teste confere só a TELA
// (o modal de confirmação e a lista de Integrações), interceptando as
// respostas via page.route -- o backend (com tiktokClient mockado) fica
// coberto à parte por test-manual/tiktokPublisher.test.js. Servidor de
// teste isolado precisa estar rodando em http://localhost:4123.
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function main() {
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

  await page.route('**/api/social-accounts/tiktok/pending/fake-selection-tt-1', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          brand: 'ghelplus',
          brandLabel: 'GhelPlus',
          candidates: [{ creatorUsername: 'ghelplus.oficial', creatorNickname: 'GhelPlus', creatorAvatarUrl: 'https://example.com/avatar.jpg' }]
        })
      });
    } else {
      await route.continue();
    }
  });
  let confirmedBody = null;
  await page.route('**/api/social-accounts/tiktok/pending/fake-selection-tt-1/confirm', async (route) => {
    confirmedBody = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, brand: 'ghelplus', creatorUsername: 'ghelplus.oficial' })
    });
  });
  await page.route('**/api/social-accounts', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        metaConfigured: true,
        linkedinConfigured: true,
        youtubeConfigured: true,
        pinterestConfigured: true,
        tiktokConfigured: true,
        accounts: [
          { platform: 'meta', brand: 'debacco', brandLabel: 'De Bacco', connected: false, account: null },
          { platform: 'meta', brand: 'ghelplus', brandLabel: 'GhelPlus', connected: false, account: null }
        ],
        linkedinAccounts: [
          { platform: 'linkedin', brand: 'ghelplus', brandLabel: 'GhelPlus', connected: false, account: null }
        ],
        youtubeAccounts: [
          { platform: 'youtube', brand: 'debacco', brandLabel: 'De Bacco', connected: false, account: null },
          { platform: 'youtube', brand: 'ghelplus', brandLabel: 'GhelPlus', connected: false, account: null }
        ],
        pinterestAccounts: [
          { platform: 'pinterest', brand: 'debacco', brandLabel: 'De Bacco', connected: false, account: null }
        ],
        tiktokAccounts: [
          { platform: 'tiktok', brand: 'debacco', brandLabel: 'De Bacco', connected: false, account: null },
          { platform: 'tiktok', brand: 'ghelplus', brandLabel: 'GhelPlus', connected: !!confirmedBody, account: confirmedBody ? { creatorUsername: 'ghelplus.oficial', connectedByName: 'Admin', connectedAt: new Date().toISOString() } : null }
        ]
      })
    });
  });

  await page.goto(`${BASE}/?integracoes=escolher-tiktok&brand=ghelplus&selectionId=fake-selection-tt-1`);
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });

  await page.waitForSelector('#tiktokPageChooserModal:not([hidden])', { timeout: 5000 });
  check('modal de confirmação da TikTok abre sozinho ao voltar com integracoes=escolher-tiktok', await page.isVisible('#tiktokPageChooserModal'));
  check('modal da Meta NÃO abriu por engano (fluxos isolados)', await page.isHidden('#metaPageChooserModal'));
  check('modal do YouTube NÃO abriu por engano (fluxos isolados)', await page.isHidden('#youtubePageChooserModal'));
  check('modal do Pinterest NÃO abriu por engano (fluxos isolados)', await page.isHidden('#pinterestPageChooserModal'));

  const listText = await page.textContent('#tiktokPageChooserList');
  check('modal mostra a criadora encontrada (nickname e @username)', listText.includes('GhelPlus') && listText.includes('ghelplus.oficial'));
  check('com 1 criadora só, já vem pré-marcada (botão de confirmar já habilitado)', !(await page.isDisabled('#tiktokPageChooserConfirm')));

  const radios = await page.$$('#tiktokPageChooserList input[name="tiktokPageChoice"]');
  check('1 rádio (1 criadora candidata)', radios.length === 1);

  await page.click('#tiktokPageChooserConfirm');
  await page.waitForFunction(() => document.querySelector('#tiktokPageChooserModal').hidden === true, { timeout: 5000 }).catch(() => {});
  check('modal fecha depois de confirmar', await page.isHidden('#tiktokPageChooserModal'));
  check('confirmou com o creatorUsername certo', confirmedBody && confirmedBody.creatorUsername === 'ghelplus.oficial');

  // Confere a tela de Integrações mostrando a seção da TikTok com a marca
  // conectada -- navega pra lá de novo depois de fechar o modal.
  await page.click('#navConfiguracoesParent').catch(() => {});
  await page.click('#navIntegracoes').catch(() => {});
  await page.waitForSelector('#integracoesTiktokList', { state: 'attached', timeout: 5000 });
  const tiktokListText = await page.textContent('#integracoesTiktokList');
  check('tela Integrações mostra a seção da TikTok com a marca conectada', tiktokListText.includes('ghelplus.oficial') && tiktokListText.includes('Conectado'));
  check('a De Bacco continua "Não conectado" (as 2 marcas são independentes)', tiktokListText.includes('Não conectado'));
  check('aviso de App não configurado fica escondido quando tiktokConfigured é true', await page.isHidden('#integracoesTiktokWarning'));

  check('nenhum erro de console/página em toda a navegação', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
