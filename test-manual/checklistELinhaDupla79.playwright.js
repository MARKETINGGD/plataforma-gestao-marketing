// Teste visual (Playwright) da 79ª rodada -- correção de bug relatado pela
// Raquel logo após a 78ª: "check list ainda esta ruim, ele ficou como no
// print, precisa ficar adequado" (texto do item aparecia espremido numa
// coluna de 1 caractere de largura). Também confere o novo seletor de
// emojis do chat ("no chat, coloque a opção de mandar emojis").
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
  page.on('console', (msg) => { if (msg.type() === 'error') { consoleErrors.push(msg.text()); console.log('[console.error]', msg.text()); } });
  page.on('pageerror', (err) => { consoleErrors.push(String(err)); console.log('[pageerror]', String(err)); });
  page.on('dialog', (d) => d.accept());

  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(1200);

  // ---------- Checklist: reproduz o cenário exato do bug reportado ----------
  await page.click('#navDemandas');
  await page.waitForSelector('#view-demandas:not([hidden])');
  await page.click('#demandasNewBtn');
  await page.waitForSelector('#demandaModal:not([hidden])');
  await page.fill('#demCardTitle', 'Teste 79ª rodada - checklist');
  await page.fill('#demChecklistInput', 'de reparo youtube');
  await page.click('#demChecklistAdd');
  await page.waitForTimeout(300);
  // Preenche data e responsável do item -- é a combinação que espremia o
  // texto do checkbox contra a parede na 78ª rodada.
  await page.locator('.checklist-due-input').first().fill('2026-10-15');
  const assigneeSelect = page.locator('.checklist-assignee-select').first();
  if (await assigneeSelect.locator('option').count() > 1) await assigneeSelect.selectOption({ index: 1 });
  await page.waitForTimeout(300);

  const textSpan = page.locator('.checklist-item-text').first();
  const spanBox = await textSpan.boundingBox();
  const checkboxBox = await page.locator('.checklist-item input[type=checkbox]').first().boundingBox();
  check('checkbox tem o tamanho normal (não esticou pra ~540px)', checkboxBox && checkboxBox.width < 30);
  check('texto do item NÃO ficou espremido (largura > 60px)', spanBox && spanBox.width > 60);
  const textContent = await textSpan.textContent();
  check('texto do item continua correto', textContent.trim() === 'de reparo youtube');
  check('nenhum erro de console na tela de Demandas', consoleErrors.length === 0);

  await page.click('#demCardClose');
  await page.waitForTimeout(300);

  // ---------- Seletor de emojis do chat ----------
  await page.click('#navChat');
  await page.waitForSelector('#view-chat:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(800);
  check('botão de emoji aparece no chat principal', await page.locator('#chatEmojiBtn').isVisible());
  await page.click('#chatEmojiBtn');
  await page.waitForTimeout(200);
  check('painel de emojis abre ao clicar', await page.locator('.chat-emoji-picker').isVisible());
  const firstEmoji = page.locator('.chat-emoji-picker button').first();
  const emojiChar = await firstEmoji.textContent();
  await firstEmoji.click();
  await page.waitForTimeout(150);
  const inputVal = await page.inputValue('#chatInput');
  check('emoji foi inserido no campo de mensagem', inputVal.includes(emojiChar));
  check('painel fecha depois de escolher um emoji', !(await page.locator('.chat-emoji-picker').isVisible()));
  check('nenhum erro de console no chat', consoleErrors.length === 0);

  console.log(failures === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${failures} TESTE(S) FALHARAM`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
