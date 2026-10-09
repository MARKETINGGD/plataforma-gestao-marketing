// Teste visual (Playwright) da 89ª rodada -- complementa o teste de
// integração influencerAnalises89.test.js, cobrindo a parte que só existe
// na TELA:
//
//   - Influencers virou um submenu (Gerenciamento de Influencers / Análise
//     de Influencer), mesmo padrão visual de Budget/Produtos/Brindes.
//   - A tela "Análise de Influencer" abre, lista por marca, e o formulário
//     tem os campos da planilha "MAPEAMENTO DE INFLUENCIADORES".
//   - Aprovar uma análise na tela cria o influencer de verdade e ele já
//     aparece em "Gerenciamento de Influencers" sem precisar recarregar a
//     página inteira.
//
// Servidor de teste isolado precisa estar rodando em http://localhost:4123
// (mesmo padrão dos outros testes Playwright desta cópia).
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
  await page.waitForTimeout(400);

  // ---------- submenu (Gerenciamento de Influencers / Análise de Influencer) ----------
  check('submenu de Influencers começa fechado', await page.isHidden('#navInfluencersSubmenu'));
  await page.click('#navInfluencersParent');
  await page.waitForSelector('#navInfluencersSubmenu:not([hidden])');
  const subOrder = await page.$$eval('#navInfluencersSubmenu .navlink-sub', (els) => els.map((el) => el.id));
  check('submenu de Influencers tem Gerenciamento + Análise, nessa ordem', JSON.stringify(subOrder) === JSON.stringify(['navInfluencersGerenciamento', 'navInfluencersAnalise']));

  await page.click('#navInfluencersAnalise');
  await page.waitForSelector('#view-influencer-analises:not([hidden])');
  await page.waitForTimeout(300);
  check('botão-pai "Influencers" fica marcado como ativo ao abrir um item do submenu', await page.evaluate(() => document.querySelector('#navInfluencersParent').classList.contains('active')));

  // ---------- criar uma análise pela tela, na aba GhelPlus ----------
  await page.click('[data-analise-brand="ghelplus"]');
  await page.waitForTimeout(150);
  const uniq = Date.now();
  const nomeCandidata = 'Candidata PW89 ' + uniq;
  await page.click('#analiseNewBtn');
  await page.waitForSelector('#analiseFormWrap:not([hidden])');
  check('título do formulário é "Nova análise"', (await page.textContent('#analiseFormTitle')).trim() === 'Nova análise');

  await page.click('#analiseFormSave');
  await page.waitForTimeout(200);
  check('salvar sem nome mostra erro claro', !(await page.isHidden('#analiseFormError')) && /nome/i.test(await page.textContent('#analiseFormError')));

  await page.fill('#analiseFormNome', nomeCandidata);
  await page.fill('#analiseFormEstado', 'RJ');
  await page.fill('#analiseFormSeguidores', '42000');
  await page.fill('#analiseFormInstagramHandle', '@candidatapw89');
  await page.fill('#analiseFormValorPostFotoStories', '1200.00');
  await page.click('#analiseFormSave');
  await page.waitForTimeout(400);
  // Nota (91ª rodada): criar uma análise NOVA agora reabre o formulário em
  // modo edição, pra liberar o upload do mídia kit -- mesmo cuidado já
  // tomado em Lançamento de Produtos (senão quem cria e quer anexar um
  // arquivo teria que salvar, fechar e abrir de novo). Fecha manualmente
  // aqui pra continuar testando o fluxo de fora do formulário, igual antes.
  check('depois de criar, o formulário reabre em modo edição (91ª rodada)', !(await page.isHidden('#analiseFormWrap')) && (await page.textContent('#analiseFormTitle')).trim() === 'Editar análise');
  await page.click('#analiseFormCancel');
  await page.waitForTimeout(200);
  check('fechar o formulário volta pra lista', await page.isHidden('#analiseFormWrap'));

  const card = page.locator('.card-grid > *', { hasText: nomeCandidata }).first();
  check('a candidata aparece na lista da aba GhelPlus, com status "Em análise"', await card.getByText('Em análise').isVisible());

  // ---------- editar pela tela ----------
  await card.getByText('Editar').click();
  await page.waitForSelector('#analiseFormWrap:not([hidden])');
  check('reabrir pra editar vem com os dados preenchidos (Estado)', (await page.inputValue('#analiseFormEstado')) === 'RJ');
  await page.fill('#analiseFormSeguidores', '50000');
  await page.click('#analiseFormSave');
  await page.waitForTimeout(400);
  const cardDepoisEditar = page.locator('.card-grid > *', { hasText: nomeCandidata }).first();
  check('depois de editar, o novo valor de seguidores aparece no card', await cardDepoisEditar.getByText('50.000 seguidores').isVisible());

  // ---------- aprovar: cria o influencer automaticamente (pedido central da Raquel) ----------
  page.once('dialog', (d) => d.accept());
  await cardDepoisEditar.getByText('✔ Aprovar').click();
  await page.waitForTimeout(500);
  const cardAprovada = page.locator('.card-grid > *', { hasText: nomeCandidata }).first();
  check('depois de aprovar, o card mostra status "Aprovada" (sem mais botões de aprovar/reprovar)', await cardAprovada.getByText('Aprovada').isVisible());
  check('card aprovado não mostra mais o botão "✔ Aprovar"', (await cardAprovada.getByText('✔ Aprovar').count()) === 0);

  // Vai pra "Gerenciamento de Influencers" e confere que o cadastro já
  // existe de verdade lá, SEM precisar recarregar a página inteira. O
  // submenu é um toggle (abre/fecha no clique) -- só clica no pai se ainda
  // estiver fechado, mesmo cuidado do helper ensureConfiguracoesSubmenuOpen
  // em menuReorganizacao.playwright.js.
  if (await page.$eval('#navInfluencersSubmenu', (el) => el.hidden)) {
    await page.click('#navInfluencersParent');
    await page.waitForSelector('#navInfluencersSubmenu:not([hidden])');
  }
  await page.click('#navInfluencersGerenciamento');
  await page.waitForSelector('#view-influencers:not([hidden])');
  await page.click('[data-inf-tab="ghelplus"]');
  await page.waitForTimeout(400);
  const influencerCriadoCard = page.locator('.card-grid > *', { hasText: nomeCandidata }).first();
  check('o influencer criado pela aprovação já aparece em Gerenciamento de Influencers, na mesma sessão', await influencerCriadoCard.isVisible());

  await influencerCriadoCard.getByText('Ver tabela').click();
  await page.waitForSelector('#influencerTableWrap:not([hidden])');
  check('a "planilha" (tabela de ações) do influencer recém-criado está vazia', await page.isVisible('#influencerPostsEmpty'));

  check('nenhum erro de console/página em toda a navegação', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
