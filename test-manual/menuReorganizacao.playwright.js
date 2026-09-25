// Teste visual (Playwright) da reorganização do menu lateral (76ª rodada,
// pedido literal da Raquel: "no menu coloque na seguinte ordem: Inicio,
// Chat, Demandas, Agendamento, Cronograma, Influencers, Produtos (com os
// sub menus que já existem), Expositores (idem), Brindes (idem), Budget
// (GhelPlus/De Bacco/Feiras), APP Externos (Ponto/Gestor/Power BI),
// Relatórios (Tráfego Pago/Mídias/Ações Sazonais), Configurações
// (Usuários/Integrações -- visível pra todos, só o admin edita --, Ativar
// notificações, Tema escuro)". A 2ª correção da mesma rodada trocou a
// posição de Relatórios/Configurações (Configurações virou o ÚLTIMO item),
// encurtou o rótulo "Agendamentos de Redes Sociais" pra só "Agendamento", e
// moveu Tema escuro/Ativar notificações (antes soltos no rodapé da barra
// lateral) pra dentro do submenu de Configurações. Servidor de teste
// isolado precisa estar rodando em http://localhost:4123, já com um
// usuário "admin"/"123456" e um usuário comum "testenaoadmin"/"123456"
// (sem isSuperAdmin) -- ver comando usado pra criar esse 2º usuário no
// histórico desta rodada.
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
}

// O submenu de "Configurações" só fica visível DEPOIS de clicar no botão-pai
// (mesmo padrão do Budget/Produtos/Expositores/Brindes, ver setActiveNav()
// em app.js) -- e continua aberto até alguém clicar no pai de novo (que
// FECHA de volta, é um toggle). Abre só se ainda estiver fechado, pra nunca
// fechar sem querer no meio do teste.
async function ensureConfiguracoesSubmenuOpen(page) {
  const isHidden = await page.$eval('#navConfiguracoesSubmenu', (el) => el.hidden);
  if (isHidden) await page.click('#navConfiguracoesParent');
  await page.waitForSelector('#navConfiguracoesSubmenu:not([hidden])');
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') { consoleErrors.push(msg.text()); console.log('[console.error]', msg.text()); } });
  page.on('pageerror', (err) => { consoleErrors.push(String(err)); console.log('[pageerror]', String(err)); });

  // ---------- Ordem/agrupamento do menu (logada como admin) ----------
  await login(page, 'admin', '123456');

  const navIds = await page.$$eval('.sidebar-nav > *', (els) => els.map((el) => el.id));
  const expectedTopLevelOrder = [
    'navHome', 'navChat', 'navDemandas', 'navAgendamento', 'navCronograma', 'navInfluencers',
    'navProdutosGroup', 'navExpositoresGroup', 'navBrindesGroup', 'navBudgetGroup',
    'navAppExternosGroup', 'navRelatoriosGroup', 'navConfiguracoesGroup'
  ];
  check('ordem/agrupamento do menu bate exatamente com o pedido da Raquel (Configurações agora é o ÚLTIMO item)', JSON.stringify(navIds) === JSON.stringify(expectedTopLevelOrder));

  const agendamentoLabel = await page.textContent('#navAgendamento');
  check('rótulo do menu é só "Agendamento" (sem "de Redes Sociais")', agendamentoLabel.trim() === 'Agendamento');

  const budgetSubOrder = await page.$$eval('#navBudgetSubmenu .navlink-sub', (els) => els.map((el) => el.id));
  check('Budget: submenu na ordem GhelPlus, De Bacco, Feiras', JSON.stringify(budgetSubOrder) === JSON.stringify(['navBudgetGhelplus', 'navBudgetDebacco', 'navFeiras']));

  const appExternosSubOrder = await page.$$eval('#navAppExternosSubmenu .navlink-sub', (els) => els.map((el) => el.id));
  check('APP Externos: submenu com Ponto, Gestor, Power BI', JSON.stringify(appExternosSubOrder) === JSON.stringify(['navPonto', 'navGestor', 'navPowerBI']));

  const configuracoesSubOrder = await page.$$eval('#navConfiguracoesSubmenu .navlink-sub', (els) => els.map((el) => el.id));
  check('Configurações: submenu com Usuários, Integrações, Ativar notificações, Tema escuro (nessa ordem)', JSON.stringify(configuracoesSubOrder) === JSON.stringify(['navUsers', 'navIntegracoes', 'osNotifToggleBtn', 'themeToggleBtn']));

  const relatoriosSubOrder = await page.$$eval('#navRelatoriosSubmenu .navlink-sub', (els) => els.map((el) => el.id));
  check('Relatórios: submenu com Tráfego Pago, Mídias, Ações Sazonais', JSON.stringify(relatoriosSubOrder) === JSON.stringify(['navDashTrafego', 'navDashMidias', 'navDashAcoes']));

  // ---------- Tema escuro / Ativar notificações continuam funcionando
  // depois de mudar de lugar (agora dentro do submenu Configurações) ----------
  await ensureConfiguracoesSubmenuOpen(page);
  const themeBtnTextBefore = await page.textContent('#themeToggleBtn');
  check('Tema escuro: botão está dentro do submenu Configurações, texto inicial "🌙 Tema escuro"', themeBtnTextBefore.includes('Tema escuro'));
  await page.click('#themeToggleBtn');
  await page.waitForTimeout(200);
  const htmlTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('Tema escuro: clicar no botão (já no novo lugar) troca data-theme pra "dark"', htmlTheme === 'dark');
  const themeBtnTextAfter = await page.textContent('#themeToggleBtn');
  check('Tema escuro: texto do botão troca sozinho pra "Tema claro"', themeBtnTextAfter.includes('Tema claro'));
  // devolve pro claro, pra não vazar estado pro resto da suíte de testes
  await page.click('#themeToggleBtn');
  await page.waitForTimeout(200);

  // ---------- Configurações visível/editável só pro admin ----------
  await ensureConfiguracoesSubmenuOpen(page);
  check('admin: botão "Usuários" visível', await page.isVisible('#navUsers'));
  check('admin: botão "Integrações" visível', await page.isVisible('#navIntegracoes'));

  await page.click('#navUsers');
  await page.waitForSelector('#view-users:not([hidden])');
  await page.waitForTimeout(400);
  check('admin: vê "+ Novo usuário"', await page.isVisible('#userNewBtn'));
  const adminUserRows = await page.$$('#usersTableBody tr');
  check('admin: tabela de usuários tem pelo menos 2 linhas (admin + testenaoadmin)', adminUserRows.length >= 2);
  const adminEditBtnCount = await page.locator('#usersTableBody button:has-text("Editar")').count();
  check('admin: vê botão "Editar" em pelo menos 1 linha', adminEditBtnCount >= 1);

  await ensureConfiguracoesSubmenuOpen(page);
  await page.click('#navIntegracoes');
  await page.waitForSelector('#view-integracoes:not([hidden])');
  await page.waitForTimeout(400);
  const adminConnectBtnVisible = await page.locator('[data-integ-connect], [data-integ-linkedin-connect], [data-integ-youtube-connect], [data-integ-pinterest-connect]').evaluateAll((els) => els.filter((el) => el.offsetParent !== null).length);
  check('admin: vê botões de conectar VISÍVEIS nas 4 redes', adminConnectBtnVisible > 0);

  await page.click('#logoutBtn');
  await page.waitForSelector('#screen-login:not([hidden])', { timeout: 10000 });

  // ---------- mesma tela, logada como usuária COMUM (não admin) ----------
  await login(page, 'testenaoadmin', '123456');

  await ensureConfiguracoesSubmenuOpen(page);
  check('não-admin: botão "Usuários" também aparece no menu (pedido explícito: visível pra todos)', await page.isVisible('#navUsers'));
  check('não-admin: botão "Integrações" também aparece no menu', await page.isVisible('#navIntegracoes'));
  check('não-admin: "Ativar notificações" também aparece no submenu (não é uma tela admin, é só um botão que mudou de lugar)', await page.isVisible('#osNotifToggleBtn'));
  check('não-admin: "Tema escuro" também aparece no submenu', await page.isVisible('#themeToggleBtn'));

  await page.click('#navUsers');
  await page.waitForSelector('#view-users:not([hidden])');
  await page.waitForTimeout(400);
  check('não-admin: NÃO vê "+ Novo usuário" (edição continua só do admin)', await page.isHidden('#userNewBtn'));
  const naoAdminUserRows = await page.$$('#usersTableBody tr');
  check('não-admin: MESMO ASSIM vê a lista de usuários (visualização liberada pra todos)', naoAdminUserRows.length >= 2);
  const naoAdminEditBtnCount = await page.locator('#usersTableBody button:has-text("Editar")').count();
  check('não-admin: NENHUM botão "Editar" na lista', naoAdminEditBtnCount === 0);
  const naoAdminDelBtnCount = await page.locator('#usersTableBody button:has-text("Excluir")').count();
  check('não-admin: NENHUM botão "Excluir" na lista', naoAdminDelBtnCount === 0);

  await ensureConfiguracoesSubmenuOpen(page);
  await page.click('#navIntegracoes');
  await page.waitForSelector('#view-integracoes:not([hidden])');
  await page.waitForTimeout(400);
  const integracoesCardsText = await page.textContent('#view-integracoes');
  check('não-admin: MESMO ASSIM vê o status das 4 redes (GhelPlus/De Bacco aparecem no texto)', integracoesCardsText.includes('GhelPlus') && integracoesCardsText.includes('De Bacco'));
  const naoAdminConnectBtnVisible = await page.locator('[data-integ-connect], [data-integ-linkedin-connect], [data-integ-youtube-connect], [data-integ-pinterest-connect]').evaluateAll((els) => els.filter((el) => el.offsetParent !== null).length);
  check('não-admin: NENHUM botão de conectar/desconectar VISÍVEL nas 4 redes', naoAdminConnectBtnVisible === 0);

  check('nenhum erro de console/página em toda a navegação', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
