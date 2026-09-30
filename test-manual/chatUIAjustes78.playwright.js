// Teste visual (Playwright) da 78ª rodada -- confere na tela de verdade os
// ajustes de Chat pedidos pela Raquel que dependem de interação (os
// endpoints em si já são cobertos por test-manual/chatAjustes78.test.js):
//   1. Foto de verdade na lista de conversas (DM), não mais um círculo com
//      a inicial (que colidia entre pessoas com a mesma letra).
//   2. Botão de apagar mensagem aparece na própria mensagem e, depois de
//      confirmar, ela vira "Mensagem apagada" na tela sem precisar recarregar.
//   3. Busca dentro da conversa: acha mensagem existente, e mostra "nenhuma
//      encontrada" pra uma busca sem resultado.
// Servidor de teste isolado precisa estar rodando em http://localhost:4123.
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function main() {
  // Cria o usuário de teste com foto ANTES de logar na tela (Node também
  // tem fetch/FormData/Blob globais) -- assim, quando a tela loga de
  // verdade, `teamMembers` já vem carregado com essa pessoa dentro (ela é
  // buscada uma vez só, logo depois do login -- ver `api('/api/auth/team')`
  // em app.js), sem precisar recarregar a página no meio do teste.
  const adminToken = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' })
  }).then((r) => r.json()).then((d) => d.token);
  const uniq = Date.now();
  const userRes = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ username: 'fotouser78_' + uniq, password: '123456', name: 'Foto User 78', cargo: 'analista' })
  }).then((r) => r.json());
  const userId = userRes.user && userRes.user.id;
  const fd = new FormData();
  fd.append('photo', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'foto.png');
  const photoRes = await fetch(`${BASE}/api/auth/users/${userId}/photo`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: fd
  });
  const created = { userId, photoStatus: photoRes.status };
  check('usuário de teste com foto criado (upload OK)', created.photoStatus === 200);

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

  // ---------- 1. Foto de verdade na lista de conversas (DM) ----------
  await page.click('#navChat');
  await page.waitForSelector('#view-chat:not([hidden])');
  await page.click('#chatNewDmBtn');
  await page.waitForSelector('#chatDmModal:not([hidden])');
  await page.selectOption('#chatDmUser', created.userId);
  await page.click('#chatDmSave');
  await page.waitForTimeout(500);

  const dmIconIsPhoto = await page.evaluate((uid) => {
    const items = Array.from(document.querySelectorAll('.chat-conversation-item'));
    // A conversa recém-criada com "Foto User 78" -- identifica pelo nome
    // mostrado na lista, já que o id da conversa é gerado no servidor.
    const item = items.find((it) => it.querySelector('.chat-conversation-name') && it.querySelector('.chat-conversation-name').textContent.includes('Foto User 78'));
    if (!item) return 'not-found';
    // avatarHtml() bota as duas classes no MESMO elemento (a própria
    // <img>, não uma <span> por fora dela) -- ver avatarHtml em app.js.
    if (item.querySelector('img.avatar-img.chat-conversation-icon')) return 'photo';
    if (item.querySelector('.avatar-fallback')) return 'fallback';
    return 'unknown';
  }, created.userId);
  check('DM na lista de conversas mostra a fotinho de verdade (não um círculo com inicial)', dmIconIsPhoto === 'photo');

  // ---------- 2. Apagar mensagem com rastro "mensagem apagada" ----------
  const textoMsg = 'Mensagem de teste pra apagar ' + Date.now();
  await page.fill('#chatInput', textoMsg);
  await page.click('#chatSendBtn');
  await page.waitForTimeout(300);

  const hasDeleteBtn = await page.evaluate((txt) => {
    const rows = Array.from(document.querySelectorAll('#chatMessages .chat-msg-row'));
    const row = rows.find((r) => r.querySelector('.chat-msg-text') && r.querySelector('.chat-msg-text').textContent === txt);
    return !!(row && row.querySelector('.chat-msg-delete-btn'));
  }, textoMsg);
  check('mensagem própria mostra o botão de apagar', hasDeleteBtn);

  await page.evaluate((txt) => {
    const rows = Array.from(document.querySelectorAll('#chatMessages .chat-msg-row'));
    const row = rows.find((r) => r.querySelector('.chat-msg-text') && r.querySelector('.chat-msg-text').textContent === txt);
    row.querySelector('.chat-msg-delete-btn').click();
  }, textoMsg);
  await page.waitForTimeout(400);

  const afterDelete = await page.evaluate((txt) => {
    const rows = Array.from(document.querySelectorAll('#chatMessages .chat-msg-row'));
    // Acha a mesma linha por posição (o texto já não é mais o original) --
    // procura pela linha cujo texto agora é "Mensagem apagada".
    const row = rows.find((r) => r.querySelector('.chat-msg-text') && r.querySelector('.chat-msg-text').textContent.includes('Mensagem apagada'));
    return {
      found: !!row,
      hasDeleteBtn: !!(row && row.querySelector('.chat-msg-delete-btn'))
    };
  }, textoMsg);
  check('depois de apagar, a mensagem vira "Mensagem apagada" na tela na hora (sem recarregar)', afterDelete.found);
  check('depois de apagada, o botão de apagar some (não dá pra apagar 2x)', afterDelete.found && !afterDelete.hasDeleteBtn);

  // ---------- 3. Buscar mensagem dentro da conversa ----------
  const achavel = 'Palavra bem rara de encontrar ' + Date.now();
  await page.fill('#chatInput', achavel);
  await page.click('#chatSendBtn');
  await page.waitForTimeout(300);

  await page.click('#chatSearchToggleBtn');
  await page.waitForSelector('#chatSearchBar:not([hidden])');
  await page.fill('#chatSearchInput', 'Palavra bem rara');
  await page.waitForTimeout(600); // debounce da busca

  const searchFound = await page.$$eval('.chat-search-result-item', (items) => items.map((it) => it.textContent));
  check('busca encontrou a mensagem certa', searchFound.some((t) => t.includes('Palavra bem rara')));

  await page.fill('#chatSearchInput', 'termoquenuncavaiexistiraquiXYZ');
  await page.waitForTimeout(600);
  const emptyMsg = await page.$eval('#chatSearchResults', (el) => el.textContent);
  check('busca sem resultado avisa "nenhuma mensagem encontrada"', /nenhuma mensagem/i.test(emptyMsg));

  await page.click('#chatSearchCloseBtn');
  const barHiddenAfterClose = await page.$eval('#chatSearchBar', (el) => el.hidden);
  check('fechar a busca esconde a barra de novo', barHiddenAfterClose);

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
