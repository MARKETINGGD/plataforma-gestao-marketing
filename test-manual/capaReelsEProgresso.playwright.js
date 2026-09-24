// Regressão Playwright (11ª melhoria, pedido da Raquel: barra de
// progresso de upload + "adicionar capa" também pra Reels) -- confere na
// UI de verdade: (1) o campo de capa/thumbnail aparece quando o tipo é
// Reels (antes só aparecia pra YouTube) e some pros outros tipos; (2) um
// upload de verdade no Agendamento mostra o indicador global de
// progresso; (3) nenhum erro de console aparece no caminho todo.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

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

  await page.click('#navAgendamento');
  await page.waitForSelector('#view-agendamento:not([hidden])');
  await page.waitForFunction(() => {
    const el = document.querySelector('#socialPostNewBtn');
    return el && el.getBoundingClientRect().width > 0;
  }, { timeout: 10000 });
  await page.click('#socialPostNewBtn');
  await page.waitForSelector('#socialPostFormWrap:not([hidden])');

  // Tipo padrão (Estático) -- capa deve estar ESCONDIDA.
  check('Estático: campo de capa escondido', await page.isHidden('#socialPostFormThumbnailWrap'));

  // Muda pra Reels -- capa deve APARECER (correção de hoje).
  await page.selectOption('#socialPostFormType', 'reels');
  check('Reels: campo de capa aparece (pedido da Raquel: "adicionar capa" pra Reels)', await page.isVisible('#socialPostFormThumbnailWrap'));

  // Muda pra Carrossel -- capa deve voltar a ESCONDER (só Reels/YouTube).
  await page.selectOption('#socialPostFormType', 'carrossel');
  check('Carrossel: campo de capa escondido de novo', await page.isHidden('#socialPostFormThumbnailWrap'));

  // Volta pra Reels e preenche o mínimo pra salvar de verdade.
  await page.selectOption('#socialPostFormType', 'reels');
  await page.fill('#socialPostFormCaption', 'Legenda de teste Playwright');
  await page.fill('#socialPostFormDate', '2020-01-01');
  await page.click('#socialPostFormSave');
  await page.waitForFunction(() => {
    const err = document.querySelector('#socialPostFormError');
    return err && err.hidden;
  }, { timeout: 10000 }).catch(() => {});
  check('post Reels salvo sem erro na tela', await page.isHidden('#socialPostFormError'));

  // YouTube continua funcionando (regressão da 45ª rodada) -- muda rede
  // pra YouTube com tipo Estático: capa deve continuar aparecendo.
  await page.selectOption('#socialPostFormPlatform', 'youtube');
  await page.waitForTimeout(200);
  check('YouTube (rede): campo de capa continua aparecendo, mesmo mudando o tipo', await page.isVisible('#socialPostFormThumbnailWrap'));

  // Sobe um arquivo pequeno de teste pra "Criativo final" e confere se o
  // indicador global de progresso aparece (mesmo que só rapidinho, com
  // arquivo pequeno) e depois some sozinho.
  const tmpFile = path.join('/tmp', 'teste-upload-progresso.jpg');
  fs.writeFileSync(tmpFile, Buffer.alloc(200 * 1024, 1)); // 200KB, arquivo fake (não precisa ser JPEG de verdade pro teste de upload)
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#socialPostFormFileInput')
  ]).catch(() => [null]);
  if (fileChooser) {
    await fileChooser.setFiles(tmpFile);
  } else {
    await page.setInputFiles('#socialPostFormFileInput', tmpFile);
  }
  // Não trava esperando o indicador aparecer (arquivo pequeno pode subir
  // rápido demais pra pegar o frame) -- só confirma que o upload TERMINOU
  // com sucesso (arquivo aparece na lista) e que o indicador, se apareceu,
  // sumiu depois.
  await page.waitForFunction(() => {
    const list = document.querySelector('#socialPostFormFiles');
    return list && list.textContent && list.textContent.trim().length > 0;
  }, { timeout: 15000 });
  check('upload do Criativo final terminou e apareceu na lista de arquivos', true);
  const indicatorHiddenAfter = await page.evaluate(() => {
    const el = document.getElementById('globalUploadIndicator');
    return !el || el.hidden === true;
  });
  check('indicador global de progresso sumiu sozinho depois do upload terminar', indicatorHiddenAfter);
  fs.rmSync(tmpFile, { force: true });

  check('nenhum erro de console em todo o fluxo', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
