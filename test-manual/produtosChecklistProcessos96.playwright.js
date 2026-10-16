// Teste visual (Playwright) da 96ª rodada -- complementa o teste de
// integração produtosChecklistProcessos96.test.js, cobrindo a parte que
// só existe na TELA: a nova aba "⚙️ Checklist de Processos" dentro de
// Lançamento de Produtos (editor do modelo) e o checklist de verdade
// dentro do formulário de cada lançamento (checkboxes por item).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

process.env.JWT_SECRET = 'teste-produtos-checklist-96-pw';
process.env.PORT = '4354';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4354';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-produtos-checklist-96-pw-test');
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
      body: JSON.stringify({ name: 'Admin PW 96b', username: 'admin', password: '123456' })
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
  await page.waitForTimeout(400);

  await page.click('#navProdutosParent');
  await page.waitForSelector('#navProdutosSubmenu:not([hidden])', { timeout: 5000 });
  await page.click('#navProdutosLancamentos');
  await page.waitForSelector('#produtosLancamentosWrap:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(300);

  // ---------- aba do modelo de checklist ----------
  await page.click('#lancamentosChecklistTemplateTabBtn');
  await page.waitForSelector('#lancamentosChecklistTemplateWrap:not([hidden])', { timeout: 5000 });
  check('lista normal de lançamentos fica escondida na aba do modelo', await page.isHidden('#lancamentosListWrap'));

  await page.click('#checklistTemplateNewBtn');
  await page.waitForSelector('#checklistTemplateFormWrap:not([hidden])', { timeout: 5000 });
  await page.fill('#checklistTemplateFormSetor', 'Engenharia');
  await page.fill('#checklistTemplateFormAtividade', 'Validar desenho técnico PW');
  await page.click('#checklistTemplateFormSave');
  await page.waitForFunction(() => document.querySelector('#checklistTemplateFormWrap').hidden, { timeout: 5000 });
  await page.waitForTimeout(200);
  const templateRows = await page.locator('#checklistTemplateBody tr').allTextContents();
  check('item do modelo aparece na tabela com setor + atividade', templateRows.some((t) => /Engenharia/.test(t) && /Validar desenho técnico PW/.test(t)));

  // ---------- volta pra lista e cria um lançamento novo ----------
  await page.click('[data-lancamentos-brand="todos"]');
  await page.waitForSelector('#lancamentosListWrap:not([hidden])', { timeout: 5000 });
  check('voltar pra aba de marca esconde o editor do modelo', await page.isHidden('#lancamentosChecklistTemplateWrap'));

  await page.click('#lancamentosNewBtn');
  await page.waitForSelector('#lancamentoFormWrap:not([hidden])', { timeout: 5000 });
  check('lançamento NOVO (ainda sem salvar) não mostra a seção de checklist ainda', await page.isHidden('#lancamentoChecklistSection'));
  await page.fill('#lancamentoFormNome', 'Produto Teste Checklist PW');
  await page.click('#lancamentoFormSave');
  // Depois de salvar, reabre em modo edição automaticamente (mesmo
  // comportamento já usado pro upload de arquivo).
  await page.waitForFunction(() => document.querySelector('#lancamentoFormTitle').textContent.trim() === 'Editar lançamento', { timeout: 5000 });
  await page.waitForTimeout(300);

  check('depois de salvar, a seção de checklist aparece', await page.isVisible('#lancamentoChecklistSection'));
  const checklistRows = page.locator('#lancamentoChecklistWrap .checklist-item');
  check('o checklist do lançamento já vem com o item do modelo', await checklistRows.count() === 1);
  const checklistText = await checklistRows.nth(0).textContent();
  check('o item do checklist mostra o setor e a atividade', /Engenharia/.test(checklistText) && /Validar desenho técnico PW/.test(checklistText));

  // Marca o item como conferido.
  await checklistRows.nth(0).locator('input[type="checkbox"]').check();
  await page.waitForTimeout(400);
  const checklistTextDepois = await checklistRows.nth(0).textContent();
  check('depois de marcar, mostra quem conferiu', /conferido por/.test(checklistTextDepois));

  await page.click('#lancamentoFormCancel');
  await page.waitForTimeout(200);
  const linhaLancamento = page.locator('#lancamentosBody tr', { hasText: 'Produto Teste Checklist PW' });
  const checklistCell = await linhaLancamento.locator('td').nth(6).textContent();
  check('coluna "Checklist" da tabela mostra o progresso "1/1 ✓"', /1\/1/.test(checklistCell));

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
