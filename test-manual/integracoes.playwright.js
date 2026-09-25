// Teste visual (Playwright) da tela "Integrações" (54ª rodada) -- servidor
// de teste isolado precisa estar rodando em http://localhost:4123, já com
// um admin criado (ver test-manual/metaPublisher.test.js e os testes de API
// anteriores, que já deixaram um usuário "admin"/"123456").
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
  page.on('requestfailed', (req) => console.log('[requestfailed]', req.url(), req.failure() && req.failure().errorText));

  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });

  // 76ª rodada: Integrações virou item do submenu "Configurações" -- precisa
  // abrir o pai primeiro pra aparecer (mesmo padrão de Budget/Produtos/etc.),
  // continua visível pra super admin (e, desde a 76ª, pra qualquer pessoa
  // logada -- só os botões de ação continuam restritos, ver
  // test-manual/menuReorganizacao.playwright.js).
  await page.click('#navConfiguracoesParent');
  check('botão "Integrações" aparece no menu (super admin)', await page.isVisible('#navIntegracoes'));

  await page.click('#navIntegracoes');
  await page.waitForSelector('#view-integracoes:not([hidden])');
  await page.waitForTimeout(400); // loadIntegracoes() é async (fetch)

  const cardsText = await page.textContent('#integracoesList');
  check('cartão da GhelPlus presente', cardsText.includes('GhelPlus'));
  check('cartão da De Bacco presente', cardsText.includes('De Bacco'));
  check('as 2 mostram "Não conectado" (banco de teste limpo)', (cardsText.match(/Não conectado/g) || []).length === 2);

  // META_APP_ID/SECRET estão configurados no .env de teste (fake) -- o
  // aviso de "app não configurado" não deve aparecer, e os botões de
  // conectar devem estar habilitados.
  check('aviso de app não configurado ESCONDIDO (.env de teste tem credenciais fake)', await page.isHidden('#integracoesMetaWarning'));
  const connectBtns = await page.$$('[data-integ-connect]');
  check('2 botões "Conectar conta Meta" (1 por marca)', connectBtns.length === 2);
  const disabled = await connectBtns[0].isDisabled();
  check('botão de conectar habilitado (credenciais configuradas)', !disabled);

  // Clicar em "Conectar conta Meta" deve chamar a API autenticada e então
  // navegar pro facebook.com -- intercepta a navegação em vez de deixar ir
  // de verdade (não queremos realmente sair pro Facebook no teste).
  let navigatedTo = null;
  await page.route('https://www.facebook.com/**', async (route) => {
    navigatedTo = route.request().url();
    await route.fulfill({ status: 200, body: 'stub' });
  });
  await connectBtns[0].click();
  await page.waitForTimeout(500);
  // 5ª correção (23/09/2026): não fixa mais a versão da Graph API aqui --
  // era v21.0, virou v23.0 -- só confere o formato /vNN.N/dialog/oauth pra
  // não voltar a quebrar numa próxima atualização de versão.
  check('clicar em "Conectar conta Meta" navega pra URL do facebook.com com os parâmetros certos',
    !!navigatedTo && /^https:\/\/www\.facebook\.com\/v\d+\.\d+\/dialog\/oauth/.test(navigatedTo) && navigatedTo.includes('client_id=1749362466318676') && navigatedTo.includes('state='));

  check('nenhum erro de console/página em toda a navegação', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
