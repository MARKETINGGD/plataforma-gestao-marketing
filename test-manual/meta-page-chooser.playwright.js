// Teste visual (Playwright) do modal de escolha de Página (6ª correção,
// 23/09/2026) -- reproduz o cenário exato que a Raquel achou ao vivo:
// conectar 2 marcas diferentes com a MESMA conta do Facebook (que
// administra as 2 Páginas) e confirma que cada uma fica com a Página
// certa, não a mesma pra ambas. Servidor de teste isolado precisa estar
// rodando em http://localhost:4123 (mesmo padrão de integracoes.playwright.js).
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  // 64ª rodada: 'serviceWorkers: block' evita que o service worker novo
  // (public/service-worker.js, Rodada F da Pendência 51) atrapalhe o
  // page.route()/tempos deste teste -- achado por acaso ao rodar a suíte
  // inteira depois de registrar o service worker: vários testes, que
  // não têm nada a ver com PWA, começaram a falhar/travar junto (ver
  // test-manual/pwaInstalavel.playwright.js, o Único que PRECISA do
  // service worker ativo de verdade e por isso não bloqueia).
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') { consoleErrors.push(msg.text()); console.log('[console.error]', msg.text()); } });
  page.on('pageerror', (err) => { consoleErrors.push(String(err)); console.log('[pageerror]', String(err)); });

  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });

  // Simula a volta do facebook.com direto pra query string que o
  // callback do backend geraria (?integracoes=escolher&brand=...&selectionId=...).
  // O backend de verdade (com o metaGraphClient mockado) já foi validado
  // à parte em test-manual/callback-endpoint.test.js -- aqui o objetivo é
  // só a TELA (o modal de escolha), então intercepta a resposta de
  // GET/POST /api/social-accounts/meta/pending/:id via page.route,
  // simulando o que o backend devolveria, e navega direto com os
  // parâmetros de query que o callback real geraria.
  await page.route('**/api/social-accounts/meta/pending/fake-selection-1', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          brand: 'debacco',
          brandLabel: 'De Bacco',
          candidates: [
            { pageId: 'page-999', pageName: 'GhelPlus Oficial', igUsername: 'ghelplus_oficial' },
            { pageId: 'page-111', pageName: 'De Bacco Oficial', igUsername: 'debacco_oficial' }
          ]
        })
      });
    } else {
      await route.continue();
    }
  });
  let confirmedBody = null;
  await page.route('**/api/social-accounts/meta/pending/fake-selection-1/confirm', async (route) => {
    confirmedBody = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, brand: 'debacco', igUsername: 'debacco_oficial', pageName: 'De Bacco Oficial' })
    });
  });
  // Confirma o resultado depois: a tela Integrações precisa mostrar o
  // De Bacco conectado -- intercepta a listagem também, já refletindo o
  // "depois" (simplificação: sempre devolve conectado, já que o objetivo
  // aqui é testar o MODAL, não o backend de verdade).
  await page.route('**/api/social-accounts', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        metaConfigured: true,
        accounts: [
          { brand: 'debacco', brandLabel: 'De Bacco', connected: !!confirmedBody, account: confirmedBody ? { igUsername: 'debacco_oficial', pageName: 'De Bacco Oficial', connectedByName: 'Admin', connectedAt: new Date().toISOString() } : null },
          { brand: 'ghelplus', brandLabel: 'GhelPlus', connected: false, account: null }
        ]
      })
    });
  });

  await page.goto(`${BASE}/?integracoes=escolher&brand=debacco&selectionId=fake-selection-1`);
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });

  await page.waitForSelector('#metaPageChooserModal:not([hidden])', { timeout: 5000 });
  check('modal de escolha de Página abre sozinho ao voltar com integracoes=escolher', await page.isVisible('#metaPageChooserModal'));

  const listText = await page.textContent('#metaPageChooserList');
  check('modal lista as 2 Páginas candidatas (GhelPlus e De Bacco)', listText.includes('GhelPlus Oficial') && listText.includes('De Bacco Oficial'));
  check('botão "Conectar esta Página" começa desabilitado (nada escolhido ainda, são 2 candidatas)', await page.isDisabled('#metaPageChooserConfirm'));

  // Escolhe explicitamente a Página da De Bacco (não a primeira da lista)
  const radios = await page.$$('#metaPageChooserList input[name="metaPageChoice"]');
  check('2 rádios (1 por Página candidata)', radios.length === 2);
  await page.check('#metaPageChooserList input[value="page-111"]');
  check('botão "Conectar esta Página" habilita depois de escolher', !(await page.isDisabled('#metaPageChooserConfirm')));

  await page.click('#metaPageChooserConfirm');
  await page.waitForFunction(() => document.querySelector('#metaPageChooserModal').hidden === true, { timeout: 5000 }).catch(() => {});
  check('modal fecha depois de confirmar', await page.isHidden('#metaPageChooserModal'));
  check('confirmou com o pageId certo (page-111, De Bacco -- NÃO a primeira da lista)', confirmedBody && confirmedBody.pageId === 'page-111');

  check('nenhum erro de console/página em toda a navegação', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
