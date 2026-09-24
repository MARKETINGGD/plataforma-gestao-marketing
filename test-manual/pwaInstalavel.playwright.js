// Regressão Playwright (64ª rodada, "Rodada F" da Pendência 51, pedido
// direto da Raquel: "preciso que o Papoi tbm seja um app e possa ser
// instalado no cel"). Confere os requisitos técnicos que o Chrome/
// Android checam pra oferecer "Instalar app" (manifest válido, ícones de
// verdade, service worker registrado com sucesso) e que o Safari do
// iPhone usa pra "Adicionar à Tela de Início" abrir em modo app (meta
// tags próprias dele, que não dependem de manifest nenhum).
//
// Servidor de teste isolado precisa estar rodando em
// http://localhost:4123 (mesmo padrão dos outros testes Playwright).
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(BASE);

  // ---------- <head> aponta pro manifest e pras meta tags do iOS ----------
  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
  check('<head> tem <link rel="manifest"> apontando pro arquivo certo', manifestHref === '/manifest.webmanifest');

  const appleIconHref = await page.getAttribute('link[rel="apple-touch-icon"]', 'href');
  check('<head> tem apple-touch-icon (Safari/iOS)', !!appleIconHref);

  const appleCapable = await page.getAttribute('meta[name="apple-mobile-web-app-capable"]', 'content');
  check('meta apple-mobile-web-app-capable="yes" (abre sem barra de endereço no iPhone)', appleCapable === 'yes');

  const themeColor = await page.getAttribute('meta[name="theme-color"]', 'content');
  check('meta theme-color presente (cor da barra do sistema ao abrir o app)', !!themeColor);

  // ---------- manifest.webmanifest é JSON válido com os campos certos ----------
  const manifestRes = await page.goto(`${BASE}/manifest.webmanifest`);
  check('manifest.webmanifest responde 200', manifestRes.status() === 200);
  const manifestBody = await manifestRes.json();
  check('manifest tem name/short_name', !!manifestBody.name && !!manifestBody.short_name);
  check('manifest pede display "standalone" (abre como app, não como aba de navegador)', manifestBody.display === 'standalone');
  check('manifest tem pelo menos 1 ícone 192x192 e 1 512x512 (exigido pelo Chrome pra instalar)',
    manifestBody.icons.some((i) => i.sizes === '192x192') && manifestBody.icons.some((i) => i.sizes === '512x512'));
  check('manifest tem pelo menos 1 ícone "maskable" (Android recorta em círculo/squircle sem cortar a logo)',
    manifestBody.icons.some((i) => i.purpose === 'maskable'));

  // Cada ícone listado no manifest responde 200 de verdade (um ícone
  // quebrado impede o Chrome de oferecer "Instalar app").
  for (const icon of manifestBody.icons) {
    const res = await page.goto(`${BASE}${icon.src}`);
    check(`ícone do manifest "${icon.src}" existe de verdade (200)`, res.status() === 200);
  }

  // ---------- service worker registra com sucesso ----------
  await page.goto(BASE);
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg && !!(reg.active || reg.installing || reg.waiting);
  }, { timeout: 15000 });
  check('service worker foi registrado com sucesso', true);

  // ---------- login continua funcionando normalmente com tudo isso plugado ----------
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  check('login continua funcionando normalmente com o service worker ativo', true);

  check('nenhum erro de console em toda a navegação', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
