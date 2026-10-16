// Teste visual (Playwright) da correção crítica da 95ª rodada (16/10/2026)
// -- complementa test-manual/pontoScheduleBugCritico95.test.js (que já
// cobre a API/o banco) confirmando que o bug realmente sumia NA TELA e que
// a correção resolve isso onde a Raquel de fato enxerga o problema: o
// formulário de edição de usuário, em Configurações > Usuários.
//
// Servidor de teste isolado precisa estar rodando em http://localhost:4123
// (mesmo padrão dos outros testes Playwright desta cópia), já com o
// usuário "admin"/"123456" (super admin) cadastrado.
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function ensureConfiguracoesSubmenuOpen(page) {
  const isHidden = await page.$eval('#navConfiguracoesSubmenu', (el) => el.hidden);
  if (isHidden) await page.click('#navConfiguracoesParent');
  await page.waitForSelector('#navConfiguracoesSubmenu:not([hidden])');
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

  const created = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'pontopw95', password: '123456', name: 'Ponto PW95', cargo: 'analista' })
  }).then((r) => r.json());
  const userId = created.user.id;
  const horario = { entradaManha: '07:45', saidaAlmoco: '12:15', voltaAlmoco: '13:15', saidaFinal: '18:30' };
  await fetch(`${BASE}/api/auth/users/${userId}`, { method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ pontoSchedule: horario }) });

  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(500);

  await ensureConfiguracoesSubmenuOpen(page);
  await page.click('#navUsers');
  await page.waitForSelector('#view-users:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(300);

  // ---------- abre "Editar" na linha da pessoa de teste ----------
  const linha = page.locator('#usersTableBody tr', { hasText: 'Ponto PW95' });
  await linha.locator('button', { hasText: 'Editar' }).click();
  await page.waitForSelector('#userFormWrap:not([hidden])', { timeout: 10000 });

  // ---------- os 4 campos já vêm preenchidos (era o bug: vinham em branco) ----------
  check('campo "entrada manhã" já vem preenchido ao abrir o form', await page.inputValue('#userFormPontoEntradaManha') === '07:45');
  check('campo "saída almoço" já vem preenchido ao abrir o form', await page.inputValue('#userFormPontoSaidaAlmoco') === '12:15');
  check('campo "volta almoço" já vem preenchido ao abrir o form', await page.inputValue('#userFormPontoVoltaAlmoco') === '13:15');
  check('campo "saída final" já vem preenchido ao abrir o form', await page.inputValue('#userFormPontoSaidaFinal') === '18:30');

  // ---------- edita só o CARGO (nada de ponto) e salva ----------
  await page.selectOption('#userFormCargo', { index: 1 }).catch(() => {});
  await page.click('#userFormSave');
  await page.waitForTimeout(500);

  // ---------- confere no banco que o horário sobreviveu à edição ----------
  const depois = await fetch(`${BASE}/api/auth/users`, { headers: hj(adminToken) }).then((r) => r.json());
  const userDepois = depois.users.find((u) => u.id === userId);
  check('depois de editar o cargo pela TELA, o horário de ponto continua intacto no banco', JSON.stringify(userDepois.pontoSchedule) === JSON.stringify(horario));

  // ---------- reabre o form e confere que os campos continuam preenchidos ----------
  await linha.locator('button', { hasText: 'Editar' }).click();
  await page.waitForSelector('#userFormWrap:not([hidden])', { timeout: 10000 });
  check('reabrindo o form depois da edição, os horários continuam aparecendo certinho na tela', await page.inputValue('#userFormPontoEntradaManha') === '07:45' && await page.inputValue('#userFormPontoSaidaFinal') === '18:30');

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
