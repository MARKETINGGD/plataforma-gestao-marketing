// Teste visual (Playwright) da 91ª rodada -- complementa o teste de
// integração analiseInfluencerPlanilhaNova91.test.js, cobrindo a parte
// que só existe na TELA:
//
//   - Os campos novos da planilha (Email, Tipo de conteúdo) aparecem no
//     formulário, na posição certa (logo depois de Gênero).
//   - As 9 candidatas pré-cadastradas (seed) aparecem na lista da aba
//     GhelPlus sem precisar fazer nada.
//   - Criar uma análise nova reabre o formulário em modo edição (pra
//     liberar o upload do mídia kit), mesmo comportamento já usado em
//     Lançamento de Produtos.
//   - Upload/exclusão de arquivo do mídia kit funcionando de ponta a
//     ponta pela tela.
//
// Sobe o PRÓPRIO server.js numa porta dedicada (mesmo padrão de
// previaFeedSeparaInstagramFacebook87.playwright.js) -- não mexe no
// servidor compartilhado de dev nem no banco de produção.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

process.env.JWT_SECRET = 'teste-analise-influencer-planilha-nova-91-pw';
process.env.PORT = '4349';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4349';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-analise-influencer-91-pw-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

const BASE = 'http://localhost:4349';
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
      body: JSON.stringify({ name: 'Admin PW 91', username: 'admin', password: '123456' })
    }).then((r) => r.json());
  }

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') { consoleErrors.push(msg.text()); console.log('[console.error]', msg.text()); } });
  page.on('pageerror', (err) => { consoleErrors.push(String(err)); console.log('[pageerror]', String(err)); });

  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(400);

  if (await page.$eval('#navInfluencersSubmenu', (el) => el.hidden)) {
    await page.click('#navInfluencersParent');
    await page.waitForSelector('#navInfluencersSubmenu:not([hidden])');
  }
  await page.click('#navInfluencersAnalise');
  await page.waitForSelector('#view-influencer-analises:not([hidden])');
  await page.waitForTimeout(300);

  // ---------- candidatas pré-cadastradas aparecem na aba GhelPlus ----------
  await page.click('[data-analise-brand="ghelplus"]');
  await page.waitForTimeout(300);
  const biGoesCard = page.locator('.card-grid > *', { hasText: 'Bi Goes' }).first();
  check('candidata pré-cadastrada "Bi Goes" aparece na lista GhelPlus, sem fazer nada', await biGoesCard.isVisible());
  const graziCard = page.locator('.card-grid > *', { hasText: 'graziribeiroo__' }).first();
  check('candidata pré-cadastrada "graziribeiroo__" também aparece', await graziCard.isVisible());

  // ---------- campos novos (Email, Tipo de conteúdo) existem e salvam ----------
  await page.click('#analiseNewBtn');
  await page.waitForSelector('#analiseFormWrap:not([hidden])');
  check('título do formulário é "Nova análise"', (await page.textContent('#analiseFormTitle')).trim() === 'Nova análise');
  check('input de Email existe no formulário', (await page.locator('#analiseFormEmail').count()) === 1);
  check('input de Tipo de conteúdo existe no formulário', (await page.locator('#analiseFormTipoConteudo').count()) === 1);

  // Confere a ORDEM dos campos na tela -- Email/Tipo de conteúdo logo
  // depois de Gênero, antes de Estado, igual à planilha nova da Raquel.
  const fieldOrder = await page.$$eval('#analiseFormWrap input[id^="analiseForm"]', (els) => els.map((el) => el.id));
  const idxGenero = fieldOrder.indexOf('analiseFormGenero');
  const idxEmail = fieldOrder.indexOf('analiseFormEmail');
  const idxTipoConteudo = fieldOrder.indexOf('analiseFormTipoConteudo');
  const idxEstado = fieldOrder.indexOf('analiseFormEstado');
  check('ordem dos campos bate com a planilha nova (Gênero < Email < Tipo de conteúdo < Estado)', idxGenero < idxEmail && idxEmail < idxTipoConteudo && idxTipoConteudo < idxEstado);

  // Upload de mídia kit começa escondido numa análise nova (ainda sem id).
  check('input de mídia kit começa escondido numa análise nova (ainda sem id)', !(await page.isVisible('#analiseMidiaKitInput')));

  const uniq = Date.now();
  const nomeCandidata = 'Candidata PW91 ' + uniq;
  await page.fill('#analiseFormNome', nomeCandidata);
  await page.fill('#analiseFormGenero', 'Feminino');
  await page.fill('#analiseFormEmail', 'candidatapw91@exemplo.com');
  await page.fill('#analiseFormTipoConteudo', 'Organização e decoração');
  await page.click('#analiseFormSave');
  await page.waitForTimeout(400);

  // ---------- salvar uma análise NOVA reabre em modo edição (libera o upload) ----------
  check('depois de criar, o formulário NÃO fecha -- reabre em modo edição', !(await page.isHidden('#analiseFormWrap')));
  check('título vira "Editar análise" depois de criar', (await page.textContent('#analiseFormTitle')).trim() === 'Editar análise');
  check('input de mídia kit fica visível depois de criar (análise já tem id)', await page.isVisible('#analiseMidiaKitInput'));
  check('o email digitado continua preenchido depois de reabrir', (await page.inputValue('#analiseFormEmail')) === 'candidatapw91@exemplo.com');

  // ---------- mídia kit: subir e excluir arquivo pela tela ----------
  const tmpFile = path.join(os.tmpdir(), `midia-kit-pw91-${uniq}.jpg`);
  fs.writeFileSync(tmpFile, Buffer.from('conteudo-fake-pw91'));
  await page.setInputFiles('#analiseMidiaKitInput', tmpFile);
  await page.waitForTimeout(500);
  const midiaKitItem = page.locator('#analiseMidiaKit .file-item');
  check('arquivo do mídia kit aparece na lista depois do upload', await midiaKitItem.first().isVisible());
  check('nome do arquivo aparece certo na lista', (await midiaKitItem.first().textContent()).includes(`midia-kit-pw91-${uniq}.jpg`));

  await midiaKitItem.first().locator('button').click();
  await page.waitForTimeout(400);
  check('arquivo do mídia kit some da lista depois de excluir', (await page.locator('#analiseMidiaKit .file-item').count()) === 0);
  fs.rmSync(tmpFile, { force: true });

  await page.click('#analiseFormCancel');
  await page.waitForTimeout(200);
  check('cancelar fecha o formulário normalmente', await page.isHidden('#analiseFormWrap'));
  const cardCriada = page.locator('.card-grid > *', { hasText: nomeCandidata }).first();
  check('a candidata criada pela tela aparece na lista', await cardCriada.isVisible());

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
