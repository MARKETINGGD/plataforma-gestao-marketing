// Teste visual (Playwright) do modal de escolha de Página da LinkedIn (67ª
// rodada, "vamos para a proxima integração de API, vamos para o
// linkedin") -- mesmo espírito de meta-page-chooser.playwright.js: como
// não existe (ainda) uma conta de verdade aprovada pra testar contra a API
// real da LinkedIn (a Raquel precisa terminar a aprovação do "Community
// Management API" primeiro -- ver PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md,
// seção 7), este teste confere só a TELA (o modal de escolha e a lista de
// Integrações), interceptando as respostas via page.route -- o backend
// (com linkedinClient mockado) fica coberto à parte por
// test-manual/linkedinPublisher.test.js. Servidor de teste isolado precisa
// estar rodando em http://localhost:4123.
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

  await page.route('**/api/social-accounts/linkedin/pending/fake-selection-li-1', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          brand: 'ghelplus',
          brandLabel: 'GhelPlus',
          candidates: [
            { organizationId: '111222', orgName: 'GhelPlus Oficial' },
            { organizationId: '333444', orgName: 'GhelPlus Distribuidora' }
          ]
        })
      });
    } else {
      await route.continue();
    }
  });
  let confirmedBody = null;
  await page.route('**/api/social-accounts/linkedin/pending/fake-selection-li-1/confirm', async (route) => {
    confirmedBody = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, brand: 'ghelplus', orgName: 'GhelPlus Distribuidora' })
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
        accounts: [
          { platform: 'meta', brand: 'debacco', brandLabel: 'De Bacco', connected: false, account: null },
          { platform: 'meta', brand: 'ghelplus', brandLabel: 'GhelPlus', connected: false, account: null }
        ],
        linkedinAccounts: [
          { platform: 'linkedin', brand: 'debacco', brandLabel: 'De Bacco', connected: false, account: null },
          { platform: 'linkedin', brand: 'ghelplus', brandLabel: 'GhelPlus', connected: !!confirmedBody, account: confirmedBody ? { orgName: 'GhelPlus Distribuidora', connectedByName: 'Admin', connectedAt: new Date().toISOString() } : null }
        ]
      })
    });
  });

  await page.goto(`${BASE}/?integracoes=escolher-linkedin&brand=ghelplus&selectionId=fake-selection-li-1`);
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });

  await page.waitForSelector('#linkedinPageChooserModal:not([hidden])', { timeout: 5000 });
  check('modal de escolha de Página da LinkedIn abre sozinho ao voltar com integracoes=escolher-linkedin', await page.isVisible('#linkedinPageChooserModal'));
  check('modal da Meta NÃO abriu por engano (fluxos isolados)', await page.isHidden('#metaPageChooserModal'));

  const listText = await page.textContent('#linkedinPageChooserList');
  check('modal lista as 2 Páginas candidatas', listText.includes('GhelPlus Oficial') && listText.includes('GhelPlus Distribuidora'));
  check('botão "Conectar esta Página" começa desabilitado (2 candidatas, nada escolhido ainda)', await page.isDisabled('#linkedinPageChooserConfirm'));

  const radios = await page.$$('#linkedinPageChooserList input[name="linkedinPageChoice"]');
  check('2 rádios (1 por Página candidata)', radios.length === 2);
  await page.check('#linkedinPageChooserList input[value="333444"]');
  check('botão "Conectar esta Página" habilita depois de escolher', !(await page.isDisabled('#linkedinPageChooserConfirm')));

  await page.click('#linkedinPageChooserConfirm');
  await page.waitForFunction(() => document.querySelector('#linkedinPageChooserModal').hidden === true, { timeout: 5000 }).catch(() => {});
  check('modal fecha depois de confirmar', await page.isHidden('#linkedinPageChooserModal'));
  check('confirmou com o organizationId certo (333444 -- NÃO a primeira da lista)', confirmedBody && confirmedBody.organizationId === '333444');

  // Confere a tela de Integrações mostrando as 2 seções (Meta e LinkedIn)
  // separadas -- navega pra lá de novo depois de fechar o modal.
  // 76ª rodada: Integrações virou item do submenu "Configurações" -- precisa
  // abrir o pai primeiro (mesmo padrão de Budget/Produtos/etc.).
  await page.click('#navConfiguracoesParent').catch(() => {});
  await page.click('#navIntegracoes').catch(() => {});
  await page.waitForSelector('#integracoesLinkedinList', { state: 'attached', timeout: 5000 });
  const linkedinListText = await page.textContent('#integracoesLinkedinList');
  check('tela Integrações mostra a seção da LinkedIn com a marca conectada', linkedinListText.includes('GhelPlus Distribuidora'));

  check('nenhum erro de console/página em toda a navegação', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
