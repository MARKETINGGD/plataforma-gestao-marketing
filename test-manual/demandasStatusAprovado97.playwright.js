// Teste visual (Playwright) da 97ª rodada -- complementa o teste de
// integração demandasStatusAprovado97.test.js, cobrindo a parte que só
// existe na TELA: o status novo ("Aprovado") aparecendo no seletor de
// status do card de Demandas, podendo ser escolhido e salvo de verdade, e
// também no filtro de status do quadro Kanban e no filtro do
// Acompanhamento Equipe -- mesmo padrão de
// demandasStatusNovos92.playwright.js.
//
// Sobe o PRÓPRIO server.js numa porta dedicada -- não mexe no servidor
// compartilhado de dev nem no banco de produção.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

process.env.JWT_SECRET = 'teste-demandas-status-aprovado-97-pw';
process.env.PORT = '4359';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4359';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-demandas-status-aprovado-97-pw-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

const BASE = 'http://localhost:4359';
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
      body: JSON.stringify({ name: 'Admin PW 97', username: 'admin', password: '123456' })
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
  check('seletor de status do card tem "Aprovado"', statusOptions.includes('Aprovado'));
  check('seletor de status do card manteve os status antigos (inclusive "Em Aprovação", distinto)',
    ['A Fazer', 'Em Andamento', 'Em Revisão', 'Em Refação', 'Em Aprovação', 'Concluída'].every((l) => statusOptions.includes(l)));

  await page.fill('#demCardTitle', 'Card Playwright 97 status aprovado');
  await page.selectOption('#demCardStatus', 'aprovado');
  // Quadro geral exige responsável marcado (ver #demCardSave no app.js) --
  // marca o admin como responsável (checkbox + estrela).
  await page.locator('#demAssigneeList .chip-toggle input').first().check();
  await page.waitForTimeout(150);
  await page.locator('#demAssigneeList .chip-responsible-btn').first().click();
  await page.waitForTimeout(150);
  await page.click('#demCardSave');
  await page.waitForTimeout(600);
  // Card NOVO: ao salvar, o modal não fecha sozinho -- continua aberto já
  // em modo edição do card recém-criado -- confere o status direto aqui
  // antes de fechar.
  const statusLogoApósSalvar = await page.inputValue('#demCardStatus');
  check('[97ª rodada] status "aprovado" continua selecionado no card recém-criado', statusLogoApósSalvar === 'aprovado');
  await page.click('#demCardClose');
  await page.waitForTimeout(500);

  // Reabre o mesmo card pelo quadro Kanban (releitura do servidor, não só
  // o estado que já estava na tela) e confere que o status "Aprovado" foi
  // salvo de verdade no banco.
  const cardLocator = page.locator('.kanban-card', { hasText: 'Card Playwright 97 status aprovado' }).first();
  await cardLocator.waitFor({ timeout: 10000 });
  await cardLocator.click();
  await page.waitForSelector('#demandaModal:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(300);
  const statusSalvo = await page.inputValue('#demCardStatus');
  check('[97ª rodada] status "aprovado" foi salvo de verdade e reabre selecionado', statusSalvo === 'aprovado');
  const badgeNoCard = await cardLocator.textContent().catch(() => '');
  await page.click('#demCardClose');
  await page.waitForTimeout(500);
  check('badge do card no quadro mostra "Aprovado"', (await cardLocator.textContent()).includes('Aprovado'));

  // ---------- Filtro de status do quadro Kanban (dinâmico, de STATUS_COLUMNS) ----------
  const kanbanFilterOptions = await page.locator('#demandasFilterStatus option').allTextContents();
  check('filtro de status do quadro Kanban tem "Aprovado"', kanbanFilterOptions.includes('Aprovado'));
  await page.selectOption('#demandasFilterStatus', 'aprovado');
  await page.waitForTimeout(300);
  const cardVisivelNoFiltro = await page.locator('.kanban-card', { hasText: 'Card Playwright 97 status aprovado' }).count();
  check('filtrar por "Aprovado" mostra o card recém-criado', cardVisivelNoFiltro > 0);
  await page.selectOption('#demandasFilterStatus', '');

  // ---------- Filtro do Acompanhamento Equipe (precisa ser coordenador/
  // gerente -- admin já é isSuperAdmin, que também enxerga) ----------
  await page.click('#navRelatoriosParent');
  await page.waitForSelector('#navRelatoriosSubmenu:not([hidden])', { timeout: 5000 });
  await page.click('#navDashAcompanhamento');
  await page.waitForSelector('#view-acompanhamento-equipe:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(500);
  const acompanhamentoOptions = await page.locator('#acompanhamentoFilterStatus option').allTextContents();
  check('filtro do Acompanhamento Equipe tem "Aprovado"', acompanhamentoOptions.includes('Aprovado'));
  await page.selectOption('#acompanhamentoFilterStatus', 'aprovado');
  await page.waitForTimeout(500);
  const linhaDetalhe = page.locator('#acompanhamentoDetalheBody tr', { hasText: 'Card Playwright 97 status aprovado' });
  check('detalhe do Acompanhamento Equipe mostra o card filtrado por "Aprovado" com o badge certo',
    (await linhaDetalhe.count()) > 0 && (await linhaDetalhe.textContent()).includes('Aprovado'));

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
