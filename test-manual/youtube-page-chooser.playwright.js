// Teste visual (Playwright) do modal de escolha/confirmação de canal do
// YouTube (69ª rodada, "amanhã ás 8 horas vamos começar a fazer a
// integração com o you tube") -- mesmo espírito de
// linkedin-page-chooser.playwright.js: como ainda não existe nenhum teste
// real contra a API do YouTube nesta cópia isolada, este teste confere só a
// TELA (o modal de confirmação e a lista de Integrações), interceptando as
// respostas via page.route -- o backend (com youtubeClient mockado) fica
// coberto à parte por test-manual/youtubePublisher.test.js. Servidor de
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

  await page.route('**/api/social-accounts/youtube/pending/fake-selection-yt-1', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          brand: 'ghelplus',
          brandLabel: 'GhelPlus',
          candidates: [{ channelId: 'UC_ghelplus_fake', channelTitle: 'GhelPlus' }]
        })
      });
    } else {
      await route.continue();
    }
  });
  let confirmedBody = null;
  await page.route('**/api/social-accounts/youtube/pending/fake-selection-yt-1/confirm', async (route) => {
    confirmedBody = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, brand: 'ghelplus', channelTitle: 'GhelPlus' })
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
        accounts: [
          { platform: 'meta', brand: 'debacco', brandLabel: 'De Bacco', connected: false, account: null },
          { platform: 'meta', brand: 'ghelplus', brandLabel: 'GhelPlus', connected: false, account: null }
        ],
        linkedinAccounts: [
          { platform: 'linkedin', brand: 'debacco', brandLabel: 'De Bacco', connected: false, account: null },
          { platform: 'linkedin', brand: 'ghelplus', brandLabel: 'GhelPlus', connected: false, account: null }
        ],
        youtubeAccounts: [
          { platform: 'youtube', brand: 'debacco', brandLabel: 'De Bacco', connected: false, account: null },
          { platform: 'youtube', brand: 'ghelplus', brandLabel: 'GhelPlus', connected: !!confirmedBody, account: confirmedBody ? { channelTitle: 'GhelPlus', connectedByName: 'Admin', connectedAt: new Date().toISOString() } : null }
        ]
      })
    });
  });

  await page.goto(`${BASE}/?integracoes=escolher-youtube&brand=ghelplus&selectionId=fake-selection-yt-1`);
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });

  await page.waitForSelector('#youtubePageChooserModal:not([hidden])', { timeout: 5000 });
  check('modal de confirmação do YouTube abre sozinho ao voltar com integracoes=escolher-youtube', await page.isVisible('#youtubePageChooserModal'));
  check('modal da Meta NÃO abriu por engano (fluxos isolados)', await page.isHidden('#metaPageChooserModal'));
  check('modal da LinkedIn NÃO abriu por engano (fluxos isolados)', await page.isHidden('#linkedinPageChooserModal'));

  const listText = await page.textContent('#youtubePageChooserList');
  check('modal mostra o canal encontrado', listText.includes('GhelPlus'));
  check('com 1 canal só, já vem pré-marcado (botão de confirmar já habilitado)', !(await page.isDisabled('#youtubePageChooserConfirm')));

  const radios = await page.$$('#youtubePageChooserList input[name="youtubePageChoice"]');
  check('1 rádio (1 canal candidato)', radios.length === 1);

  await page.click('#youtubePageChooserConfirm');
  await page.waitForFunction(() => document.querySelector('#youtubePageChooserModal').hidden === true, { timeout: 5000 }).catch(() => {});
  check('modal fecha depois de confirmar', await page.isHidden('#youtubePageChooserModal'));
  check('confirmou com o channelId certo', confirmedBody && confirmedBody.channelId === 'UC_ghelplus_fake');

  // Confere a tela de Integrações mostrando a seção do YouTube com a marca
  // conectada -- navega pra lá de novo depois de fechar o modal.
  await page.click('button[data-view="integracoes"]').catch(() => {});
  await page.waitForSelector('#integracoesYoutubeList', { state: 'attached', timeout: 5000 });
  const youtubeListText = await page.textContent('#integracoesYoutubeList');
  check('tela Integrações mostra a seção do YouTube com a marca conectada', youtubeListText.includes('GhelPlus') && youtubeListText.includes('Conectado'));
  check('aviso de App não configurado fica escondido quando youtubeConfigured é true', await page.isHidden('#integracoesYoutubeWarning'));

  check('nenhum erro de console/página em toda a navegação', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
