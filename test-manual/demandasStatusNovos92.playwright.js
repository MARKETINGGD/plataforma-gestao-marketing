// Teste visual (Playwright) da 92ª rodada -- complementa o teste de
// integração demandasStatusNovos92.test.js, cobrindo a parte que só existe
// na TELA: os 2 status novos ("Em Revisão"/"Em Refação") aparecendo no
// seletor de status do card de Demandas, podendo ser escolhidos e salvos
// de verdade, e também no filtro de status do quadro Kanban e no filtro do
// Acompanhamento Equipe.
//
// Sobe o PRÓPRIO server.js numa porta dedicada (mesmo padrão de
// brindesLinkExternoDoisModos91.playwright.js) -- não mexe no servidor
// compartilhado de dev nem no banco de produção.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

process.env.JWT_SECRET = 'teste-demandas-status-novos-92-pw';
process.env.PORT = '4354';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4354';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-demandas-status-novos-92-pw-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

const BASE = 'http://localhost:4354';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function run() {
  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  if (statusRes.needsSetup) {
    await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin PW 92', username: 'admin', password: '123456' })
    }).then((r) => r.json());
  }

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') { consoleErrors.push(msg.text()); console.log('[console.error]', msg.text()); } });
  page.on('pageerror', (err) => { consoleErrors.push(String(err)); console.log('[pageerror]', String(err)); });
  page.on('dialog', (d) => d.accept());

  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(500);

  // ---------- Card de Demandas: seletor de status (#demCardStatus) ----------
  await page.click('#navDemandas');
  await page.waitForSelector('#view-demandas:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.click('#demandasNewBtn');
  await page.waitForSelector('#demandaModal:not([hidden])', { timeout: 10000 });

  const statusOptions = await page.locator('#demCardStatus option').allTextContents();
  check('seletor de status do card tem "Em Revisão"', statusOptions.includes('Em Revisão'));
  check('seletor de status do card tem "Em Refação"', statusOptions.includes('Em Refação'));
  check('seletor de status do card manteve os 4 status antigos', ['A Fazer', 'Em Andamento', 'Em Aprovação', 'Concluída'].every((l) => statusOptions.includes(l)));

  await page.fill('#demCardTitle', 'Card Playwright 92 status novos');
  await page.selectOption('#demCardStatus', 'em_revisao');
  // Quadro geral exige responsável marcado (ver #demCardSave no app.js) --
  // marca o admin como responsável (checkbox + estrela).
  await page.locator('#demAssigneeList .chip-toggle input').first().check();
  await page.waitForTimeout(150);
  await page.locator('#demAssigneeList .chip-responsible-btn').first().click();
  await page.waitForTimeout(150);
  await page.click('#demCardSave');
  await page.waitForTimeout(600);
  // Card NOVO: ao salvar, o modal não fecha sozinho -- continua aberto já
  // em modo edição do card recém-criado (ver #demCardSave em app.js, bloco
  // "else" do POST) -- confere o status direto aqui antes de fechar.
  const statusLogoApósSalvar = await page.inputValue('#demCardStatus');
  check('[92ª rodada] status "em_revisao" continua selecionado no card recém-criado', statusLogoApósSalvar === 'em_revisao');
  await page.click('#demCardClose');
  await page.waitForTimeout(500);

  // Reabre o mesmo card pelo quadro Kanban (releitura do servidor, não só
  // o estado que já estava na tela) e confere que o status "Em Revisão"
  // foi salvo de verdade no banco.
  const cardLocator = page.locator('.kanban-card', { hasText: 'Card Playwright 92 status novos' }).first();
  await cardLocator.waitFor({ timeout: 10000 });
  await cardLocator.click();
  await page.waitForSelector('#demandaModal:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(300);
  const statusSalvo = await page.inputValue('#demCardStatus');
  check('[92ª rodada] status "em_revisao" foi salvo de verdade e reabre selecionado', statusSalvo === 'em_revisao');
  await page.click('#demCardClose');
  await page.waitForTimeout(500);

  // ---------- Filtro de status do quadro Kanban (dinâmico, de STATUS_COLUMNS) ----------
  const kanbanFilterOptions = await page.locator('#demandasFilterStatus option').allTextContents();
  check('filtro de status do quadro Kanban tem "Em Revisão"', kanbanFilterOptions.includes('Em Revisão'));
  check('filtro de status do quadro Kanban tem "Em Refação"', kanbanFilterOptions.includes('Em Refação'));
  await page.selectOption('#demandasFilterStatus', 'em_revisao');
  await page.waitForTimeout(300);
  const cardVisivelNoFiltro = await page.locator('.kanban-card', { hasText: 'Card Playwright 92 status novos' }).count();
  check('filtrar por "Em Revisão" mostra o card recém-criado', cardVisivelNoFiltro > 0);
  await page.selectOption('#demandasFilterStatus', '');

  // ---------- Filtro do Acompanhamento Equipe (precisa ser coordenador/
  // gerente -- admin já é isSuperAdmin, que também enxerga) ----------
  await page.click('#navRelatoriosParent');
  await page.waitForSelector('#navRelatoriosSubmenu:not([hidden])', { timeout: 5000 });
  await page.click('#navDashAcompanhamento');
  await page.waitForSelector('#view-acompanhamento-equipe:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(500);
  const acompanhamentoOptions = await page.locator('#acompanhamentoFilterStatus option').allTextContents();
  check('filtro do Acompanhamento Equipe tem "Em Revisão"', acompanhamentoOptions.includes('Em Revisão'));
  check('filtro do Acompanhamento Equipe tem "Em Refação"', acompanhamentoOptions.includes('Em Refação'));

  check('nenhum erro de console/página em toda a navegação', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(process.exitCode);
}

run().catch((e) => {
  console.error(e);
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(1);
});
