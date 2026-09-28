// Teste visual (Playwright) do filtro do Agendamento de Redes Sociais (76ª
// rodada, pedido literal da Raquel: "e agendamento, adicione a opção de
// filtro por: rede, tipo, assunto, data"). Mesmo padrão de mock de
// test-manual/agendamentoAvisosDono.playwright.js: intercepta GET
// /api/social-posts com uma lista fixa conhecida, em vez de depender do
// banco de teste (mais direto pra conferir exatamente quais linhas cada
// combinação de filtro deveria mostrar). Servidor de teste isolado precisa
// estar rodando em http://localhost:4123.
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function login(page) {
  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
}

function postsResponse(posts) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify({ posts }) };
}

function basePost(overrides) {
  return Object.assign({
    id: 'post1',
    brand: 'debacco',
    platform: 'instagram',
    postType: 'estatico',
    subject: '',
    scheduledDate: '2026-10-01',
    caption: '',
    status: 'rascunho',
    approvalStatus: 'pendente',
    responsibleId: null,
    createdBy: null,
    involvedUserIds: []
  }, overrides);
}

const MOCK_POSTS = [
  basePost({ id: 'p1', platform: 'instagram', postType: 'estatico', subject: 'Lançamento de verão', scheduledDate: '2026-10-01' }),
  basePost({ id: 'p2', platform: 'facebook', postType: 'carrossel', subject: 'Promoção Black Friday', scheduledDate: '2026-10-05' }),
  basePost({ id: 'p3', platform: 'instagram', postType: 'reels', subject: 'Bastidores da loja', scheduledDate: '2026-10-10' }),
  basePost({ id: 'p4', platform: 'youtube', postType: 'video_youtube', subject: 'Vídeo institucional', scheduledDate: '2026-10-15' }),
  // Marca diferente -- confirma que o filtro novo funciona JUNTO com o
  // filtro de marca (aba) que já existia, não no lugar dele.
  basePost({ id: 'p5', brand: 'ghelplus', platform: 'instagram', postType: 'estatico', subject: 'Outra marca', scheduledDate: '2026-10-01' })
];

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.route('**/api/social-posts', (route) => {
    if (route.request().method() === 'GET') return route.fulfill(postsResponse(MOCK_POSTS));
    return route.continue();
  });

  await login(page);
  await page.click('#navAgendamento');
  await page.waitForSelector('#view-agendamento:not([hidden])');
  await page.waitForSelector('#socialPostsBody tr', { timeout: 10000 });

  async function rowCount() { return (await page.$$('#socialPostsBody tr')).length; }
  async function rowSubjects() { return page.$$eval('#socialPostsBody tr td:nth-child(3)', (els) => els.map((el) => el.textContent.trim())); }

  // ---------- Sem filtro nenhum: só os 4 posts da aba ativa (De Bacco) ----------
  check('sem filtro: mostra os 4 posts da marca ativa (De Bacco), sem o da GhelPlus', await rowCount() === 4);

  // ---------- Filtro por Rede ----------
  await page.selectOption('#socialFilterPlatform', 'instagram');
  check('filtro Rede=Instagram: só p1 e p3 (2 linhas)', await rowCount() === 2);
  const subjectsInstagram = await rowSubjects();
  check('filtro Rede=Instagram: mostra "Lançamento de verão" e "Bastidores da loja"', subjectsInstagram.includes('Lançamento de verão') && subjectsInstagram.includes('Bastidores da loja'));
  await page.selectOption('#socialFilterPlatform', '');

  // ---------- Filtro por Tipo ----------
  await page.selectOption('#socialFilterType', 'carrossel');
  check('filtro Tipo=Carrossel: só p2 (1 linha)', await rowCount() === 1);
  check('filtro Tipo=Carrossel: é o post certo ("Promoção Black Friday")', (await rowSubjects())[0] === 'Promoção Black Friday');
  await page.selectOption('#socialFilterType', '');

  // ---------- Filtro por Assunto (busca por trecho, sem diferenciar maiúsculas) ----------
  await page.fill('#socialFilterSubject', 'black');
  check('filtro Assunto="black" (minúsculo): acha "Promoção Black Friday" (1 linha)', await rowCount() === 1);
  await page.fill('#socialFilterSubject', '');

  // ---------- Filtro por Data ----------
  await page.fill('#socialFilterDate', '2026-10-10');
  check('filtro Data=10/10: só p3 (1 linha)', await rowCount() === 1);
  check('filtro Data=10/10: é o post certo ("Bastidores da loja")', (await rowSubjects())[0] === 'Bastidores da loja');
  await page.fill('#socialFilterDate', '');

  // ---------- Combinação de filtros que não bate com NADA ----------
  await page.selectOption('#socialFilterPlatform', 'instagram');
  await page.selectOption('#socialFilterType', 'carrossel');
  check('combinação Instagram + Carrossel (não existe): 0 linhas', await rowCount() === 0);
  check('mensagem de vazio avisa que é POR CAUSA DO FILTRO (não "nenhum agendamento ainda")', /filtros/i.test(await page.textContent('#socialPostsEmpty')));

  // ---------- Limpar filtros ----------
  await page.click('#socialFilterClear');
  check('Limpar filtros: campo Rede volta pra "Todas as redes"', await page.inputValue('#socialFilterPlatform') === '');
  check('Limpar filtros: campo Tipo volta pra "Todos os tipos"', await page.inputValue('#socialFilterType') === '');
  check('Limpar filtros: volta a mostrar os 4 posts da marca ativa', await rowCount() === 4);

  // ---------- Filtro combinado com a aba de marca (De Bacco → GhelPlus) ----------
  await page.selectOption('#socialFilterPlatform', 'instagram');
  await page.click('[data-social-tab="ghelplus"]');
  check('trocar pra aba GhelPlus com filtro Rede=Instagram ativo: mostra só o post da GhelPlus (p5)', await rowCount() === 1);
  check('é o post certo da GhelPlus ("Outra marca")', (await rowSubjects())[0] === 'Outra marca');
  await page.click('#socialFilterClear');
  await page.click('[data-social-tab="debacco"]');

  check('nenhum erro de console/página em toda a navegação', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
