// Teste visual (Playwright) da 78ª rodada -- confere na tela de verdade:
//   1. Cadastro de influencer novo exige os dados pessoais (mensagem de
//      erro clara quando faltam, salva certo quando completos).
//   2. Campo "Link de publicação" no formulário da ação e na tabela.
//   3. Filtro de status na tabela do influencer e em "Todas as ações".
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
  page.on('dialog', (d) => d.accept());
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });

  // 89ª rodada: Influencers virou submenu (Gerenciamento de Influencers /
  // Análise de Influencer) -- mesmo padrão de 2 cliques já usado em
  // Budget/Produtos/Brindes/Expositores.
  await page.click('#navInfluencersParent');
  await page.click('#navInfluencersGerenciamento');
  await page.waitForSelector('#view-influencers:not([hidden])');
  await page.waitForTimeout(300);

  // ---------- 1. Dados pessoais obrigatórios ----------
  await page.click('#influencerNewBtn');
  await page.waitForSelector('#influencerFormWrap:not([hidden])');
  check('rótulo avisa que dados pessoais são obrigatórios (cadastro novo)', (await page.textContent('#influencerFormPersonalHint')).includes('obrigatório'));
  const uniq = Date.now();
  await page.fill('#influencerFormName', 'Influencer UI 78 ' + uniq);
  await page.click('#influencerFormSave');
  await page.waitForTimeout(300);
  const errorText = await page.textContent('#influencerFormError');
  check('salvar sem dados pessoais mostra erro claro (não deixa passar em branco)', !(await page.isHidden('#influencerFormError')) && /Informe o campo/.test(errorText));

  await page.fill('#influencerFormCpf', '123.456.789-00');
  await page.fill('#influencerFormRg', '12.345.678-9');
  await page.fill('#influencerFormTelefone', '(11) 99999-0000');
  await page.fill('#influencerFormEmail', 'ui78@teste.com');
  await page.fill('#influencerFormDataNascimento', '1995-05-20');
  await page.fill('#influencerFormEndereco', 'Rua Teste UI, 78');
  await page.click('#influencerFormSave');
  await page.waitForTimeout(500);
  check('com todos os dados pessoais, salva sem erro (volta pra lista)', await page.isHidden('#influencerFormWrap'));

  // ---------- 2 e 3. Link de publicação + filtro de status ----------
  const card = page.locator('.card-grid > *', { hasText: 'Influencer UI 78 ' + uniq }).first();
  await card.getByText('Ver tabela').click();
  await page.waitForSelector('#influencerTableWrap:not([hidden])');
  check('filtro de status aparece na tabela do influencer', await page.isVisible('#influencerPostsStatusFilter'));

  await page.click('#influencerPostNewBtn');
  await page.waitForSelector('#influencerPostFormWrap:not([hidden])');
  check('campo "Link de publicação" aparece no formulário da ação', await page.isVisible('#influencerPostFormLink'));
  await page.fill('#influencerPostFormFormato', 'Reels de teste');
  await page.fill('#influencerPostFormLink', 'https://instagram.com/p/uiteste78');
  // Responsável obrigatório -- marca a si mesma.
  await page.click('#influencerPostFormInvolvedList .chip-toggle:first-child input[type="checkbox"]');
  await page.click('#influencerPostFormInvolvedList .chip-toggle:first-child .chip-responsible-btn');
  await page.click('#influencerPostFormSave');
  await page.waitForTimeout(500);

  const rowHtml = await page.$eval('#influencerPostsBody tr', (tr) => tr.innerHTML);
  check('link de publicação aparece na tabela do influencer (link clicável "Ver post")', rowHtml.includes('Ver post') && rowHtml.includes('uiteste78'));

  // Filtro de status: item está "A publicar" -- filtrar por "Publicada" deve escondê-lo.
  await page.selectOption('#influencerPostsStatusFilter', 'publicada');
  await page.waitForTimeout(200);
  check('filtro por "Publicada" esconde o item (que está "A publicar")', await page.isVisible('#influencerPostsEmpty'));
  await page.selectOption('#influencerPostsStatusFilter', '');
  await page.waitForTimeout(200);
  check('voltar pra "Todos os status" mostra o item de novo', !(await page.isVisible('#influencerPostsEmpty')));

  // "Todas as ações" -- filtro de status + coluna de link.
  await page.click('#influencerTableBackBtn');
  await page.waitForTimeout(300);
  await page.click('[data-inf-tab="todas"]');
  await page.waitForTimeout(400);
  check('filtro de status aparece em "Todas as ações"', await page.isVisible('#influencerAllStatusFilter'));
  const allBodyHtml = await page.$eval('#influencerAllBody', (el) => el.innerHTML);
  check('coluna de link de publicação aparece em "Todas as ações"', allBodyHtml.includes('uiteste78'));

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
