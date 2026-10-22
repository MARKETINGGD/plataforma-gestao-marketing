// Teste visual (Playwright) da 104ª rodada -- confirma na TELA o
// calendário de Ausências dentro de Usuários, o aviso na coluna da
// pessoa em Demandas quando ela está ausente HOJE, e o aviso de conflito
// ao marcar a entrega de uma demanda durante a ausência de quem foi
// marcado.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

process.env.JWT_SECRET = 'teste-ausencias-104-pw';
process.env.PORT = '4371';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4371';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-ausencias-104-pw-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

const BASE = 'http://localhost:4371';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function run() {
  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  let adminToken;
  if (statusRes.needsSetup) {
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin PW 104', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
  } else {
    adminToken = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456' })
    }).then((r) => r.json()).then((d) => d.token);
  }
  const hj = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };

  // Colaboradora que já está de férias HOJE (pro aviso na coluna dela em
  // Demandas) + que vai ficar afastada numa data futura (pro aviso de
  // conflito ao marcar entrega).
  const colab = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj,
    body: JSON.stringify({ username: 'colabPW104', password: '123456', name: 'Colab Ausência PW 104' })
  }).then((r) => r.json()).then((d) => d.user);

  const hoje = new Date().toISOString().slice(0, 10);
  await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hj,
    body: JSON.stringify({ userId: colab.id, tipo: 'ferias', dataInicio: addDays(hoje, -1), dataFim: addDays(hoje, 5), observacoes: 'Férias de teste' })
  });

  const afastamentoInicio = addDays(hoje, 30);
  const afastamentoFim = addDays(hoje, 35);
  await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hj,
    body: JSON.stringify({ userId: colab.id, tipo: 'afastamento', dataInicio: afastamentoInicio, dataFim: afastamentoFim })
  });

  // Pessoa sem nenhuma permissão -- confirma que a aba Ausências continua
  // escondida junto com o resto de Usuários (mesmo padrão da 103ª rodada).
  await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj,
    body: JSON.stringify({ username: 'semacesso104pw', password: '123456', name: 'Sem Acesso PW 104' })
  });

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') { consoleErrors.push(msg.text()); console.log('[console.error]', msg.text()); } });
  page.on('pageerror', (err) => { consoleErrors.push(String(err)); console.log('[pageerror]', String(err)); });
  let lastDialogMessage = null;
  page.on('dialog', (d) => { lastDialogMessage = d.message(); d.accept(); });

  // ---------- parte 1: logado como ADMIN -- calendário de Ausências ----------
  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(400);

  await page.click('#navConfiguracoesParent');
  await page.waitForSelector('#navConfiguracoesSubmenu:not([hidden])', { timeout: 5000 });
  await page.click('#navUsers');
  await page.waitForSelector('#view-users:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(300);
  check('aba "Ausências" aparece dentro de Usuários', await page.isVisible('button[data-users-tab="ausencias"]'));

  await page.click('button[data-users-tab="ausencias"]');
  await page.waitForSelector('#usersTabAusencias:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(300);
  check('o calendário de Ausências aparece, com o mês atual no rótulo', (await page.textContent('#ausenciasMonthLabel')).trim().length > 0);
  check('a ausência de férias da colaboradora aparece na tabela', (await page.locator('#ausenciasTableBody tr', { hasText: 'Colab Ausência PW 104' }).count()) >= 1);
  check('o calendário mostra o chip da ausência no mês de hoje', await page.locator('#ausenciasCalGrid .cal-post-chip', { hasText: 'Colab Ausência PW 104' }).count() >= 1);

  // Cadastrar uma 3ª ausência direto na tela (saída fora do horário).
  await page.click('#ausenciaNewBtn');
  await page.waitForSelector('#ausenciaFormWrap:not([hidden])', { timeout: 5000 });
  await page.selectOption('#ausenciaFormUser', colab.id);
  await page.selectOption('#ausenciaFormTipo', 'saida');
  check('ao escolher "Saída fora do horário", o campo Data fim some (sempre 1 dia só)', await page.isHidden('#ausenciaFormFimWrap'));
  await page.fill('#ausenciaFormInicio', addDays(hoje, 10));
  await page.fill('#ausenciaFormObs', 'Consulta médica às 14h');
  await page.click('#ausenciaFormSave');
  await page.waitForTimeout(500);
  check('o formulário de ausência fecha sozinho depois de salvar', await page.isHidden('#ausenciaFormWrap'));
  check('a nova ausência (saída) aparece na tabela depois de salvar', (await page.locator('#ausenciasTableBody tr', { hasText: 'Saída fora do horário' }).count()) >= 1);

  // ---------- parte 2: aviso na coluna da pessoa em Demandas (ausente HOJE) ----------
  await page.click('#navDemandas');
  await page.waitForSelector('#view-demandas:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(400);
  const colunaColab = page.locator('.kanban-col', { has: page.locator('.kanban-col-header-name', { hasText: 'Colab Ausência PW 104' }) });
  check('a coluna da colaboradora, que está de férias HOJE, mostra o aviso "🏖️ Férias"', (await colunaColab.locator('.kanban-col-header', { hasText: '🏖️ Férias' }).count()) >= 1);

  // ---------- parte 3: aviso de conflito ao marcar entrega durante a ausência ----------
  await page.click('#demandasNewBtn');
  await page.waitForSelector('#demandaModal:not([hidden])', { timeout: 5000 });
  await page.fill('#demCardTitle', 'Demanda de teste -- conflito com afastamento PW 104');
  const chipColab = page.locator('#demAssigneeList .chip-toggle', { hasText: 'Colab Ausência PW 104' });
  await chipColab.locator('input[type="checkbox"]').check();
  await chipColab.locator('.chip-responsible-btn').click();
  // Data de entrega CAI dentro do período de afastamento cadastrado acima.
  await page.fill('#demCardDueDate', addDays(afastamentoInicio, 2));
  lastDialogMessage = null;
  await page.click('#demCardSave');
  await page.waitForTimeout(600);
  check('salvar a demanda com entrega durante a ausência dispara um aviso (confirm) mencionando a colaboradora e o afastamento', !!lastDialogMessage && lastDialogMessage.includes('Colab Ausência PW 104') && lastDialogMessage.includes('Afastado'));
  await page.waitForTimeout(500);
  check('mesmo com o aviso, a demanda foi criada normalmente (aviso não bloqueia, só confirma)', (await page.locator('.kanban-card', { hasText: 'conflito com afastamento PW 104' }).count()) >= 1);
  // Criar um card de novo reabre o modal (já salvo) em vez de fechar
  // sozinho -- fecha explicitamente antes de navegar (mesmo comportamento
  // de sempre, ver $('#demCardSave').onclick em app.js).
  await page.click('#demCardClose');
  await page.waitForTimeout(400);

  // ---------- parte 4: pessoa sem permissão nenhuma continua sem ver nada em Usuários/Ausências ----------
  await page.click('#logoutBtn');
  await page.waitForSelector('#screen-login:not([hidden])', { timeout: 10000 });
  await page.fill('#loginUsername', 'semacesso104pw');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.click('#navConfiguracoesParent');
  await page.waitForSelector('#navConfiguracoesSubmenu:not([hidden])', { timeout: 5000 });
  await page.click('#navUsers');
  await page.waitForSelector('#view-users:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(300);
  check('sem nenhuma permissão, nem a barra de abas (Usuários/Ausências) aparece', await page.isHidden('#usersTabsBar'));
  check('sem nenhuma permissão, continua mostrando o aviso de bloqueio de sempre', await page.isVisible('#usersAccessDenied'));

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
