// Teste visual (Playwright) da 78ª rodada -- confere na tela de verdade:
//   1. Filtro por produto na Análise de Concorrência (dentro da Papoi).
//   2. A lista ganhou área com rolagem própria (max-height + overflow-y).
//   3. O mesmo filtro + rolagem também no link externo agregado.
// Servidor de teste isolado precisa estar rodando em http://localhost:4123.
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
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });

  const uniq = Date.now();
  const created = await page.evaluate(async (uniq) => {
    const token = localStorage.getItem('token');
    const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    async function criar(nossoProduto) {
      const r = await fetch('/api/produtos/concorrencia', {
        method: 'POST', headers: h,
        body: JSON.stringify({
          brand: 'ghelplus', titulo: 'Análise 78 ' + uniq + ' ' + nossoProduto, data: '2026-09-29',
          nossoProduto, nossoPreco: 100,
          concorrentes: [{ nome: 'Concorrente X', produto: nossoProduto + ' concorrente' }]
        })
      });
      return r.json();
    }
    const cuba = await criar('Cuba Inox 78');
    const pia = await criar('Pia Cozinha 78');
    return { cubaId: cuba.item && cuba.item.id, piaId: pia.item && pia.item.id };
  }, uniq);
  check('2 análises de teste criadas (Cuba e Pia)', !!(created.cubaId && created.piaId));

  await page.click('#navProdutosParent');
  await page.click('#navProdutosConcorrencia');
  await page.waitForSelector('#produtosConcorrenciaWrap:not([hidden])');
  await page.waitForTimeout(400);

  check('campo de filtro por produto aparece na tela', await page.isVisible('#concorrenciaProductFilter'));

  const scrollStyle = await page.$eval('#concorrenciaList', (el) => {
    const s = getComputedStyle(el);
    return { maxHeight: s.maxHeight, overflowY: s.overflowY };
  });
  check('lista de análises tem altura máxima definida (não cresce infinito)', scrollStyle.maxHeight !== 'none');
  check('lista de análises tem rolagem própria (overflow-y: auto)', scrollStyle.overflowY === 'auto');

  const titlesBefore = await page.$$eval('.compare-card-head h4', (els) => els.map((e) => e.textContent));
  check('as 2 análises aparecem antes de filtrar', titlesBefore.some((t) => t.includes('Cuba Inox 78')) && titlesBefore.some((t) => t.includes('Pia Cozinha 78')));

  await page.fill('#concorrenciaProductFilter', 'cuba');
  await page.waitForTimeout(200);
  const titlesAfter = await page.$$eval('.compare-card-head h4', (els) => els.map((e) => e.textContent));
  check('filtrar por "cuba" mostra só a análise da Cuba', titlesAfter.some((t) => t.includes('Cuba Inox 78')) && !titlesAfter.some((t) => t.includes('Pia Cozinha 78')));

  await page.fill('#concorrenciaProductFilter', '');
  await page.waitForTimeout(200);

  // ---------- Link externo agregado ----------
  await page.click('#concorrenciaPublicLinkBtn');
  await page.waitForSelector('#concorrenciaPublicLinkPanel:not([hidden])');
  const genVisible = await page.isVisible('#concorrenciaGenLinkBtn');
  if (genVisible) await page.click('#concorrenciaGenLinkBtn');
  await page.waitForTimeout(400);
  const shareUrl = await page.inputValue('#concorrenciaPublicLinkField');
  check('link externo agregado foi gerado', !!shareUrl);

  if (shareUrl) {
    const page2 = await browser.newPage({ serviceWorkers: 'block' });
    await page2.goto(shareUrl);
    await page2.waitForSelector('#screen-share-public:not([hidden])', { timeout: 10000 });
    await page2.waitForTimeout(400);
    check('link externo mostra o campo de filtro por produto', await page2.isVisible('#sharePublicConcorrenciaFilter'));
    const shareScrollStyle = await page2.$eval('#sharePublicConcorrenciaList', (el) => {
      const s = getComputedStyle(el);
      return { maxHeight: s.maxHeight, overflowY: s.overflowY };
    });
    check('link externo: lista com altura máxima definida', shareScrollStyle.maxHeight !== 'none');
    check('link externo: lista com rolagem própria (overflow-y: auto)', shareScrollStyle.overflowY === 'auto');
    const shareTitlesBefore = await page2.$$eval('.compare-card-head h4', (els) => els.map((e) => e.textContent));
    check('link externo mostra as análises antes de filtrar', shareTitlesBefore.some((t) => t.includes('Cuba Inox 78')));
    await page2.fill('#sharePublicConcorrenciaFilter', 'pia');
    await page2.waitForTimeout(200);
    const shareTitlesAfter = await page2.$$eval('.compare-card-head h4', (els) => els.map((e) => e.textContent));
    check('link externo: filtrar por "pia" mostra só a análise da Pia', shareTitlesAfter.some((t) => t.includes('Pia Cozinha 78')) && !shareTitlesAfter.some((t) => t.includes('Cuba Inox 78')));
    await page2.close();
  }

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
