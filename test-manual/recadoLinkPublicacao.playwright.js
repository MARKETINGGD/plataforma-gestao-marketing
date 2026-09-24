// Teste visual (Playwright) do link de publicação nos Recados (11ª
// melhoria, pedido da Raquel: "a papoi n mostrou nenhum link após a
// publicação, e isso seria importante ter. Um link na aba recado,
// avisando que o post foi publicado e ao clicar no link ser levado até a
// rede social com o post publicado"). Mocka as respostas de
// /api/recados* via page.route (mesmo padrão de meta-page-chooser.
// playwright.js) -- o backend de verdade (criação do recado com
// externalUrl em utils/metaPublisher.js) já foi validado à parte em
// test-manual/metaPublisher.test.js; aqui o objetivo é só a TELA.
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

const FAKE_RECADO = {
  id: 'recado-fake-1',
  text: 'Papoi: seu post de Instagram · GhelPlus (2026-09-24) foi publicado com sucesso! Clique aqui pra ver o post no ar.',
  color: '#6D63E0',
  targetUserIds: [],
  readBy: [],
  readByMe: false,
  archived: false,
  createdAt: new Date().toISOString(),
  createdBy: null,
  createdByName: 'Papoi',
  createdByPhoto: null,
  system: true,
  postTitle: 'Instagram · GhelPlus',
  postBrand: 'ghelplus',
  postNetwork: 'instagram',
  sourceSocialPostId: 'post-fake-1',
  externalUrl: 'https://www.instagram.com/reel/FAKE123/'
};

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.route('**/api/recados/for-me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recados: [FAKE_RECADO] }) }));
  await page.route('**/api/recados', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recados: [FAKE_RECADO], suggestedColors: [] }) });
    }
    return route.continue();
  });

  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });

  await page.click('#navHome');
  await page.waitForSelector('.recado-card', { timeout: 10000 });

  // Escopado em #recadosForMe (o card da Início) -- o mesmo recado também
  // aparece na tabela "mural completo" (#recadosAllBody, só super admin),
  // que reaproveita a MESMA recadoPostNoticeHtml() de propósito (DRY) --
  // por isso o link aparece 2x na página, uma vez em cada lugar.
  const link = page.locator('#recadosForMe .recado-card-external-link a');
  check('link "Ver post publicado" aparece no recado', await link.count() === 1);
  check('link aponta pra URL de verdade da Meta (externalUrl)', await link.getAttribute('href') === FAKE_RECADO.externalUrl);
  check('link abre em nova aba (target=_blank) -- não navega pra fora da Papoi', await link.getAttribute('target') === '_blank');
  check('link tem rel=noopener (segurança de link externo)', (await link.getAttribute('rel') || '').includes('noopener'));

  // Clicar no link não deve TAMBÉM disparar a navegação interna do card
  // (que levaria pro Agendamento) -- intercepta a criação de popup em vez
  // de deixar abrir de verdade, e confere que a tela CONTINUOU nos
  // Recados (não navegou pro Agendamento por engano).
  const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 5000 }).catch(() => null),
    link.click()
  ]);
  check('clicar no link abre popup/nova aba de verdade', !!popup);
  if (popup) await popup.close();
  check('a tela principal continua em Recados/Início (não foi pro Agendamento por engano)', await page.isVisible('#view-home'));

  check('nenhum erro de console em todo o fluxo', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
