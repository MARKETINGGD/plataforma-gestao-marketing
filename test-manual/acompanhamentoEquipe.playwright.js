// Teste visual (Playwright) da 77ª rodada -- "Acompanhamento Equipe",
// pedido literal da Raquel: "todo mundo pode ver o botão, mas é clicavel
// apenas para mim e a gerente" (coordenadora + gerente + admin da
// Plataforma). Mocka GET /api/demandas/team-report (mesmo padrão de
// test-manual/agendamentoFiltros.playwright.js), em vez de depender do
// banco de teste, pra conferir exatamente o que cada filtro deveria
// mostrar. Servidor de teste isolado precisa estar rodando em
// http://localhost:4123, já com um usuário "admin"/"123456" (isSuperAdmin,
// serve de "autorizado") e um usuário comum "testenaoadmin"/"123456" (sem
// cargo gerente/coordenador nem isSuperAdmin, serve de "não autorizado").
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function login(page, username, password) {
  await page.goto(BASE);
  await page.fill('#loginUsername', username);
  await page.fill('#loginPassword', password);
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(600);
}

function jsonResponse(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

const MOCK_TEAM = [
  { id: 'u1', name: 'Analista Um', photoUrl: null, cargo: 'analista', totals: { total: 3, a_fazer: 1, andamento: 1, aprovacao: 0, concluida: 1, atrasada: 0 } },
  { id: 'u2', name: 'Analista Dois', photoUrl: null, cargo: 'analista', totals: { total: 2, a_fazer: 0, andamento: 0, aprovacao: 0, concluida: 1, atrasada: 1 } }
];

function baseDemanda(overrides) {
  return Object.assign({
    id: 'd1', title: 'Demanda de teste', brand: 'debacco', network: null,
    status: 'a_fazer', statusKey: 'a_fazer', assigneeIds: ['u1'], assigneeCount: 1,
    createdAt: '2026-06-01T10:00:00.000Z', dueDate: '2026-12-31',
    link: null, files: [], overdue: false
  }, overrides);
}

const MOCK_DEMANDAS = [
  baseDemanda({ id: 'd1', title: 'Post do Instagram', assigneeIds: ['u1'], assigneeCount: 1, status: 'concluida', statusKey: 'concluida', link: 'https://example.com/brief' }),
  baseDemanda({ id: 'd2', title: 'Vídeo institucional', assigneeIds: ['u1', 'u2'], assigneeCount: 2, status: 'andamento', statusKey: 'andamento', brand: 'ghelplus' }),
  baseDemanda({ id: 'd3', title: 'Catálogo atrasado', assigneeIds: ['u2'], assigneeCount: 1, status: 'a_fazer', statusKey: 'atrasada', dueDate: '2020-01-01', files: [{ id: 'f1', url: '/uploads/x/arte.jpg', name: 'arte.jpg', uploadedByName: 'Analista Dois' }] })
];

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') { consoleErrors.push(msg.text()); console.log('[console.error]', msg.text()); } });
  page.on('pageerror', (err) => { consoleErrors.push(String(err)); console.log('[pageerror]', String(err)); });
  const dialogMessages = [];
  page.on('dialog', (d) => { dialogMessages.push(d.message()); d.accept(); });

  const requestedUrls = [];
  await page.route('**/api/demandas/team-report**', (route) => {
    requestedUrls.push(route.request().url());
    return route.fulfill(jsonResponse({ team: MOCK_TEAM, demandas: MOCK_DEMANDAS }));
  });

  // Submenu de Relatórios só fica visível depois de clicar no botão-pai
  // (mesmo padrão de Budget/Configurações, ver ensureConfiguracoesSubmenuOpen
  // em menuReorganizacao.playwright.js) -- abre só se ainda estiver fechado.
  async function ensureRelatoriosSubmenuOpen(pg) {
    const isHidden = await pg.$eval('#navRelatoriosSubmenu', (el) => el.hidden);
    if (isHidden) await pg.click('#navRelatoriosParent');
    await pg.waitForSelector('#navRelatoriosSubmenu:not([hidden])');
  }

  // ---------- Usuária SEM permissão (testenaoadmin): botão visível, clique bloqueado ----------
  await login(page, 'testenaoadmin', '123456');
  await ensureRelatoriosSubmenuOpen(page);
  check('usuária comum: botão "Acompanhamento Equipe" está VISÍVEL no menu (todo mundo pode ver)', await page.isVisible('#navDashAcompanhamento'));
  await page.click('#navDashAcompanhamento');
  await page.waitForTimeout(300);
  check('usuária comum: clique dispara alerta de acesso restrito', dialogMessages.some((m) => /restrita/i.test(m)));
  check('usuária comum: NÃO navega pra tela (continua escondida)', await page.isHidden('#view-acompanhamento-equipe'));
  check('usuária comum: nenhuma chamada foi feita a GET /api/demandas/team-report', requestedUrls.length === 0);

  await page.click('#logoutBtn');
  await page.waitForSelector('#screen-login:not([hidden])', { timeout: 10000 });

  // ---------- Admin (super_admin, autorizado): tela abre e renderiza os mocks ----------
  dialogMessages.length = 0; // zera pra não carregar o alerta da usuária anterior
  await login(page, 'admin', '123456');
  await ensureRelatoriosSubmenuOpen(page);
  await page.click('#navDashAcompanhamento');
  await page.waitForSelector('#view-acompanhamento-equipe:not([hidden])', { timeout: 10000 });
  await page.waitForSelector('#acompanhamentoResumoBody tr', { timeout: 10000 });
  check('admin: navegou pra tela sem alerta nenhum', !dialogMessages.some((m) => /restrita/i.test(m)));
  check('admin: chamou GET /api/demandas/team-report', requestedUrls.length >= 1);

  const resumoRowCount = await page.locator('#acompanhamentoResumoBody tr').count();
  check('resumo por pessoa: 2 linhas (Analista Um + Analista Dois)', resumoRowCount === 2);
  const resumoText = await page.textContent('#acompanhamentoResumoBody');
  check('resumo mostra nome das duas pessoas', resumoText.includes('Analista Um') && resumoText.includes('Analista Dois'));

  const detalheRowCount = await page.locator('#acompanhamentoDetalheBody tr').count();
  check('detalhe: 3 linhas (d1/d2/d3)', detalheRowCount === 3);
  const detalheText = await page.textContent('#acompanhamentoDetalheBody');
  check('detalhe mostra os 3 títulos', ['Post do Instagram', 'Vídeo institucional', 'Catálogo atrasado'].every((t) => detalheText.includes(t)));
  check('detalhe mostra status "Atrasada" pra d3', detalheText.includes('Atrasada'));
  check('detalhe mostra o link de d1', await page.locator('#acompanhamentoDetalheBody a:has-text("Abrir")').count() === 1);
  check('detalhe mostra o arquivo de d3', detalheText.includes('arte.jpg'));
  check('#acompanhamentoEmpty está escondido (tem demanda pra mostrar)', await page.isHidden('#acompanhamentoEmpty'));

  // ---------- Clique numa linha do resumo filtra pela pessoa ----------
  requestedUrls.length = 0;
  await page.click('#acompanhamentoResumoBody tr:first-child');
  await page.waitForTimeout(300);
  check('clicar na linha da pessoa dispara nova busca com userId=u1', requestedUrls.some((u) => u.includes('userId=u1')));
  check('o select de pessoa reflete a seleção (u1)', await page.$eval('#acompanhamentoFilterPessoa', (el) => el.value) === 'u1');

  // ---------- Filtro de marca ----------
  requestedUrls.length = 0;
  await page.selectOption('#acompanhamentoFilterBrand', 'ghelplus');
  await page.waitForTimeout(300);
  check('trocar o filtro de marca dispara nova busca com brand=ghelplus', requestedUrls.some((u) => u.includes('brand=ghelplus')));

  // ---------- Limpar filtros ----------
  requestedUrls.length = 0;
  await page.click('#acompanhamentoFilterClear');
  await page.waitForTimeout(300);
  check('"Limpar filtros" zera o select de pessoa', await page.$eval('#acompanhamentoFilterPessoa', (el) => el.value) === '');
  check('"Limpar filtros" zera o select de marca', await page.$eval('#acompanhamentoFilterBrand', (el) => el.value) === '');
  check('"Limpar filtros" recarrega sem nenhum parâmetro extra', requestedUrls.some((u) => !u.includes('userId=') && !u.includes('brand=')));

  check('nenhum erro de console/JS na tela inteira', consoleErrors.length === 0);

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
