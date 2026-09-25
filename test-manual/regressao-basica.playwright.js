// Regressão rápida (Playwright) das telas mais próximas do que foi mexido
// nesta rodada (view-users ganhou o botão/seção "Integrações" logo depois),
// pra garantir que nada colateral quebrou: login, Usuários, Agendamento.
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
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });

  // Usuários -- ainda funciona normalmente do lado do botão vizinho novo?
  // 76ª rodada: Usuários virou item do submenu "Configurações" -- precisa
  // abrir o pai primeiro (mesmo padrão de Budget/Produtos/etc.).
  await page.click('#navConfiguracoesParent');
  await page.click('#navUsers');
  await page.waitForSelector('#view-users:not([hidden])');
  await page.waitForFunction(() => {
    const el = document.querySelector('#userNewBtn');
    return el && el.getBoundingClientRect().width > 0;
  }, { timeout: 10000 });
  check('tela Usuários ainda lista o admin criado', (await page.textContent('#usersTableBody')).includes('Admin Teste'));
  check('botão "+ Novo usuário" continua presente', await page.isVisible('#userNewBtn'));

  // Agendamento -- criar um post pela UI de verdade continua funcionando
  // (fluxo antigo, sem mexer nos campos novos)?
  await page.click('#navAgendamento');
  await page.waitForSelector('#view-agendamento:not([hidden])');
  check('tela Agendamento abre sem erro', await page.isVisible('#view-agendamento'));

  check('nenhum erro de console/página em toda a navegação', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
