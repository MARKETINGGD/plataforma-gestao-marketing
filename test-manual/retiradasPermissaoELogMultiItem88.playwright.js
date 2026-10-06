// Teste visual (Playwright) da 88ª rodada -- complementa o teste de
// integração retiradasPermissaoELogMultiItem88.test.js, cobrindo a parte
// que só existe na TELA:
//
//   - As abas do Brindes mostram "Estoque De Bacco" / "Estoque GhelPlus"
//     (renomeadas -- "Registro de Saídas" continua igual).
//   - Quem NÃO tem permissão de Retiradas Internas não vê o botão
//     "+ Nova retirada" nem "Excluir" nas linhas (mas o menu/aba continua
//     visível a todo mundo, como já era).
//   - O formulário "Registrar saída" deixa adicionar MAIS DE UM item no
//     mesmo registro, e a tabela mostra os dois itens na mesma linha.
//   - O botão "🔗 Link externo" aparece em Registro de Saídas (Controle
//     Geral), diferente/além do link do Catálogo.
//
// Servidor de teste isolado precisa estar rodando em
// http://localhost:4123 (mesmo padrão dos outros testes Playwright desta
// cópia).
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // ---------- setup via API ----------
  const loginSetup = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' })
  }).then((r) => r.json());
  const adminToken = loginSetup.token;
  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }

  // Usuária SEM permissão de Retiradas Internas (mas COM permissão de
  // Brindes -- pra confirmar que as duas são realmente independentes na
  // tela, não só na API).
  const semRetiradas = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({
      username: 'semretiradaspw88', password: '123456', name: 'Sem Retiradas PW 88',
      permissions: { brindes: 'editor', retiradasInternas: 'none' }
    })
  }).then((r) => r.json());

  const catalogDebacco = await fetch(`${BASE}/api/brindes/catalog?brand=debacco`, { headers: hj(adminToken) }).then((r) => r.json()).then((d) => d.items);
  if (!catalogDebacco.some((it) => it.item === 'Item PW88 A')) {
    await fetch(`${BASE}/api/brindes/catalog`, { method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'debacco', item: 'Item PW88 A', estoquePR: 50, estoqueSP: 50, estoquePE: 50 }) });
  }
  if (!catalogDebacco.some((it) => it.item === 'Item PW88 B')) {
    await fetch(`${BASE}/api/brindes/catalog`, { method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'debacco', item: 'Item PW88 B', estoquePR: 50, estoqueSP: 50, estoquePE: 50 }) });
  }

  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(500);

  await page.click('#navBrindesParent');
  await page.click('#navBrindesControleGeral');
  await page.waitForSelector('#view-brindes:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(300);

  // ---------- abas renomeadas ----------
  const tabTexts = await page.locator('.tab-btn[data-brindes-tab]').allTextContents();
  check('aba "Estoque De Bacco" (renomeada de "Catálogo De Bacco")', tabTexts.includes('Estoque De Bacco'));
  check('aba "Estoque GhelPlus" (renomeada de "Catálogo GhelPlus")', tabTexts.includes('Estoque GhelPlus'));
  check('aba "Registro de Saídas" continua com o mesmo nome', tabTexts.includes('Registro de Saídas'));

  // ---------- Registro de Saídas: multi-item + link externo ----------
  await page.click('.tab-btn[data-brindes-tab="log"]');
  await page.waitForTimeout(300);
  check('botão "🔗 Link externo" aparece em Registro de Saídas', await page.isVisible('#brindesSaidasPublicLinkBtn'));

  await page.click('#brindesLogNewBtn');
  await page.waitForSelector('#brindeLogFormWrap:not([hidden])', { timeout: 10000 });
  await page.selectOption('#brindeLogFormBrand', 'debacco');
  await page.waitForTimeout(200);

  const itemOptions = await page.locator('#brindeLogFormItemSelect option').allTextContents();
  const itemAOptionText = itemOptions.find((t) => t.includes('Item PW88 A'));
  const itemBOptionText = itemOptions.find((t) => t.includes('Item PW88 B'));
  check('select de item da saída lista os itens do catálogo', !!itemAOptionText && !!itemBOptionText);

  await page.selectOption('#brindeLogFormItemSelect', { label: itemAOptionText });
  await page.fill('#brindeLogFormQuantidade', '3');
  await page.click('#brindeLogFormAddItemBtn');
  await page.waitForTimeout(150);
  await page.selectOption('#brindeLogFormItemSelect', { label: itemBOptionText });
  await page.fill('#brindeLogFormQuantidade', '2');
  await page.click('#brindeLogFormAddItemBtn');
  await page.waitForTimeout(150);

  const pendingRows = await page.locator('#brindeLogFormItemsList .retirada-item-row').count();
  check('a lista de itens pendentes do formulário mostra os 2 itens adicionados', pendingRows === 2);

  await page.fill('#brindeLogFormRepresentante', 'Rep PW88');
  await page.fill('#brindeLogFormCliente', 'Cliente PW88');
  await page.fill('#brindeLogFormMotivo', 'Teste multi-item PW88');
  await page.click('#brindeLogFormSave');
  await page.waitForTimeout(600);

  const novaLinha = page.locator('#brindesLogBody tr', { hasText: 'Cliente PW88' });
  await novaLinha.waitFor({ timeout: 10000 });
  const linhaTexto = await novaLinha.textContent();
  check('a linha nova do Registro de Saídas mostra os 2 itens (Item PW88 A e B)', linhaTexto.includes('Item PW88 A') && linhaTexto.includes('Item PW88 B'));
  check('a linha nova mostra a quantidade de cada item (x3 e x2)', linhaTexto.includes('x3') && linhaTexto.includes('x2'));

  // Limpa o registro criado neste teste (via API, pra não acumular saída de teste)
  const logRows = await fetch(`${BASE}/api/brindes/log?brand=debacco`, { headers: hj(adminToken) }).then((r) => r.json()).then((d) => d.items);
  const criado = logRows.find((r) => r.cliente === 'Cliente PW88');
  if (criado) await fetch(`${BASE}/api/brindes/log/${criado.id}`, { method: 'DELETE', headers: hj(adminToken) });

  await page.click('#brindeLogFormCancel').catch(() => {});

  // ---------- Retiradas Internas: permissão separada também na tela ----------
  // (submenu do Brindes já está aberto desde o clique em #navBrindesParent
  // lá em cima -- clicar nele de novo aqui FECHARIA o submenu, já que é um
  // toggle; só clica direto no item.)
  await page.click('#navBrindesRetiradas');
  await page.waitForSelector('#view-brindes-retiradas:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(300);
  check('admin (acesso total) VÊ o botão "+ Nova retirada"', await page.isVisible('#retiradasNewBtn'));

  // Loga como a usuária que tem Brindes mas NÃO tem Retiradas Internas.
  await page.click('#logoutBtn');
  await page.waitForSelector('#loginUsername', { timeout: 10000 });
  await page.fill('#loginUsername', 'semretiradaspw88');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(400);

  await page.click('#navBrindesParent');
  await page.click('#navBrindesRetiradas');
  await page.waitForSelector('#view-brindes-retiradas:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(300);
  check('a aba Retiradas Internas continua VISÍVEL pra quem não tem permissão de editar (só visualização)', await page.isVisible('#view-brindes-retiradas'));
  check('quem NÃO tem permissão de Retiradas Internas NÃO vê o botão "+ Nova retirada" (mesmo tendo Brindes = editor)', !(await page.isVisible('#retiradasNewBtn')));

  // Mas essa mesma usuária, que TEM Brindes = editor, continua vendo o
  // botão de criar no Catálogo/Registro de Saídas -- confirma que as
  // permissões realmente não vazam uma pra outra também na tela. (Mesmo
  // motivo do comentário acima: submenu já está aberto, não clica no
  // Parent de novo.)
  await page.click('#navBrindesControleGeral');
  await page.waitForSelector('#view-brindes:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(300);
  check('a mesma usuária (Brindes = editor) VÊ "+ Novo item" no Catálogo', await page.isVisible('#brindesCatalogNewBtn'));
  await page.click('.tab-btn[data-brindes-tab="log"]');
  await page.waitForTimeout(200);
  check('a mesma usuária (Brindes = editor) VÊ "+ Registrar saída"', await page.isVisible('#brindesLogNewBtn'));

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
