// Teste de integração (servidor de verdade, mesmo padrão de
// retiradasPermissaoELogMultiItem88.test.js) da correção de um bug real
// reportado pela Raquel na 91ª rodada:
//
//   "a aba brindes, ao gerar o link externo, tem duas opções certo? Ou é
//   somente leitura, ou leitura e edição. O link externo do estoque Ghel
//   e De Bacco, não esta funcionando a parte de somente leitura"
//
// Causa raiz encontrada: `utils/shareLinks.js` guardava só 1 link ATIVO
// por (resource, scopeKey), não importa o modo -- gerar um link de
// edição pra uma marca SOBRESCREVIA (e invalidava, sem nenhum aviso) o
// link de leitura já ativo pra mesma marca (ou vice-versa). Quem já
// tinha o link de leitura em mãos (ex.: compartilhado com alguém de
// fora) via ele parar de funcionar assim que alguém gerasse, depois, um
// link de edição pra mesma marca -- exatamente o "não está funcionando"
// que a Raquel reportou.
//
// Corrigido tornando leitura e edição 2 links INDEPENDENTES por marca,
// nos 2 recursos que têm os dois modos: Catálogo de Brindes (68ª
// rodada) e Registro de Saídas (88ª rodada). Este teste cobre os dois,
// confirmando que gerar/revogar um nunca mexe no outro.
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-brindes-link-externo-dois-modos-91';
process.env.PORT = '4351';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4351';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-brindes-link-dois-modos-91-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

async function run() {
  let failures = 0;
  function check(label, cond) {
    console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
    if (!cond) failures++;
  }

  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const BASE = 'http://localhost:4351';

  async function login(username, password) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then((r) => r.json());
    return res.token;
  }
  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  let adminToken;
  if (statusRes.needsSetup) {
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Raquel', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
  } else {
    adminToken = await login('admin', '123456');
  }
  check('login/setup do admin devolveu token', !!adminToken);

  // Item de catálogo de verdade pra marca GhelPlus, pra ter algo pra ver/editar.
  const catalogItem = await fetch(`${BASE}/api/brindes/catalog`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ brand: 'ghelplus', item: 'Item Teste 91', estoquePR: 10, estoqueSP: 5, estoquePE: 0 })
  }).then((r) => r.json()).then((d) => d.item);

  // ================= 1) Catálogo de Brindes (resource 'brindes') =================

  const catLeitura1 = await fetch(`${BASE}/api/brindes/public-link/generate`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'ghelplus', mode: 'leitura' })
  }).then((r) => r.json());
  check('[Catálogo] gerou link de leitura (GhelPlus)', !!catLeitura1.publicToken && catLeitura1.mode === 'leitura');

  // Reproduz o bug exato: gera o link de EDIÇÃO da MESMA marca depois.
  const catEdicao1 = await fetch(`${BASE}/api/brindes/public-link/generate`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'ghelplus', mode: 'edicao' })
  }).then((r) => r.json());
  check('[Catálogo] gerou link de edição (GhelPlus) DEPOIS do de leitura', !!catEdicao1.publicToken && catEdicao1.mode === 'edicao');

  // O PONTO CENTRAL do bug: o link de leitura gerado ANTES continua
  // funcionando -- antes da correção, isso devolvia 404.
  const catLeituraAindaFunciona = await fetch(`${BASE}/api/brindes/public/${catLeitura1.publicToken}`);
  const catLeituraAindaFuncionaBody = await catLeituraAindaFunciona.json();
  check('[BUG CORRIGIDO] link de leitura do Catálogo continua funcionando depois de gerar o de edição', catLeituraAindaFunciona.status === 200 && catLeituraAindaFuncionaBody.mode === 'leitura');

  // E o inverso também: o de edição continua funcionando.
  const catEdicaoFunciona = await fetch(`${BASE}/api/brindes/public/${catEdicao1.publicToken}`);
  const catEdicaoFuncionaBody = await catEdicaoFunciona.json();
  check('[Catálogo] link de edição também funciona, em paralelo', catEdicaoFunciona.status === 200 && catEdicaoFuncionaBody.mode === 'edicao');

  // GET /public-link (painel admin) devolve os dois tokens de uma vez.
  const catPainel = await fetch(`${BASE}/api/brindes/public-link?brand=ghelplus`, { headers: hj(adminToken) }).then((r) => r.json());
  check('[Catálogo] painel admin mostra os 2 links ativos ao mesmo tempo', catPainel.leitura.publicToken === catLeitura1.publicToken && catPainel.edicao.publicToken === catEdicao1.publicToken);

  // Tentar editar pelo link de LEITURA continua bloqueado (403).
  const tentaEditarViaLeitura = await fetch(`${BASE}/api/brindes/public/${catLeitura1.publicToken}/catalog/${catalogItem.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'Visitante', estoquePR: 99 })
  });
  check('[Catálogo] editar pelo link de leitura continua bloqueado (403)', tentaEditarViaLeitura.status === 403);

  // Editar pelo link de EDIÇÃO funciona normalmente.
  const editaViaEdicao = await fetch(`${BASE}/api/brindes/public/${catEdicao1.publicToken}/catalog/${catalogItem.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'Visitante Teste 91', estoquePR: 20 })
  });
  check('[Catálogo] editar pelo link de edição funciona', editaViaEdicao.status === 200);

  // Regenerar o link de LEITURA (token novo) não mexe no de EDIÇÃO.
  const catLeitura2 = await fetch(`${BASE}/api/brindes/public-link/generate`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'ghelplus', mode: 'leitura' })
  }).then((r) => r.json());
  check('[Catálogo] regenerar o link de leitura deu um token NOVO', catLeitura2.publicToken !== catLeitura1.publicToken);
  const catLeitura1AgoraInvalido = await fetch(`${BASE}/api/brindes/public/${catLeitura1.publicToken}`);
  check('[Catálogo] o token ANTIGO de leitura foi invalidado pela própria regeneração (esperado)', catLeitura1AgoraInvalido.status === 404);
  const catEdicaoContinuaValido = await fetch(`${BASE}/api/brindes/public/${catEdicao1.publicToken}`);
  check('[Catálogo] regenerar o link de leitura NÃO afetou o link de edição', catEdicaoContinuaValido.status === 200);

  // Revogar só o de LEITURA não mexe no de EDIÇÃO.
  const revogaLeitura = await fetch(`${BASE}/api/brindes/public-link?brand=ghelplus&mode=leitura`, { method: 'DELETE', headers: hj(adminToken) });
  check('[Catálogo] revogar o link de leitura funcionou', revogaLeitura.status === 200);
  const catLeitura2AgoraInvalido = await fetch(`${BASE}/api/brindes/public/${catLeitura2.publicToken}`);
  check('[Catálogo] link de leitura revogado agora dá 404', catLeitura2AgoraInvalido.status === 404);
  const catEdicaoAindaAtivoDepoisDeRevogarLeitura = await fetch(`${BASE}/api/brindes/public/${catEdicao1.publicToken}`);
  check('[Catálogo] link de edição continua ativo depois de revogar só o de leitura', catEdicaoAindaAtivoDepoisDeRevogarLeitura.status === 200);
  const catPainelDepoisRevogar = await fetch(`${BASE}/api/brindes/public-link?brand=ghelplus`, { headers: hj(adminToken) }).then((r) => r.json());
  check('[Catálogo] painel admin reflete: leitura null, edição ainda ativa', catPainelDepoisRevogar.leitura.publicToken === null && catPainelDepoisRevogar.edicao.publicToken === catEdicao1.publicToken);

  // Limpeza
  await fetch(`${BASE}/api/brindes/public-link?brand=ghelplus&mode=edicao`, { method: 'DELETE', headers: hj(adminToken) });

  // ================= 2) Registro de Saídas (resource 'brindesSaidas') =================

  const saidasLeitura1 = await fetch(`${BASE}/api/brindes/log/public-link/generate`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'debacco', mode: 'leitura' })
  }).then((r) => r.json());
  check('[Saídas] gerou link de leitura (De Bacco)', !!saidasLeitura1.publicToken && saidasLeitura1.mode === 'leitura');

  const saidasEdicao1 = await fetch(`${BASE}/api/brindes/log/public-link/generate`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'debacco', mode: 'edicao' })
  }).then((r) => r.json());
  check('[Saídas] gerou link de edição (De Bacco) DEPOIS do de leitura', !!saidasEdicao1.publicToken && saidasEdicao1.mode === 'edicao');

  const saidasLeituraAindaFunciona = await fetch(`${BASE}/api/brindes/log/public/${saidasLeitura1.publicToken}`);
  check('[BUG CORRIGIDO] link de leitura do Registro de Saídas continua funcionando depois de gerar o de edição', saidasLeituraAindaFunciona.status === 200);

  const saidasPainel = await fetch(`${BASE}/api/brindes/log/public-link?brand=debacco`, { headers: hj(adminToken) }).then((r) => r.json());
  check('[Saídas] painel admin mostra os 2 links ativos ao mesmo tempo', saidasPainel.leitura.publicToken === saidasLeitura1.publicToken && saidasPainel.edicao.publicToken === saidasEdicao1.publicToken);

  const revogaSaidasEdicao = await fetch(`${BASE}/api/brindes/log/public-link?brand=debacco&mode=edicao`, { method: 'DELETE', headers: hj(adminToken) });
  check('[Saídas] revogar só o link de edição funcionou', revogaSaidasEdicao.status === 200);
  const saidasEdicaoAgoraInvalido = await fetch(`${BASE}/api/brindes/log/public/${saidasEdicao1.publicToken}`);
  check('[Saídas] link de edição revogado agora dá 404', saidasEdicaoAgoraInvalido.status === 404);
  const saidasLeituraAindaAtiva = await fetch(`${BASE}/api/brindes/log/public/${saidasLeitura1.publicToken}`);
  check('[Saídas] link de leitura continua ativo depois de revogar só o de edição', saidasLeituraAindaAtiva.status === 200);

  // Limpeza
  await fetch(`${BASE}/api/brindes/log/public-link?brand=debacco&mode=leitura`, { method: 'DELETE', headers: hj(adminToken) });

  // ================= 3) Sanidade: recursos de 1 modo só continuam intocados =================
  // Budget nunca passa `mode` pro shareLinks -- confirma que o comportamento
  // antigo (1 link só por marca) continua exatamente igual depois da mudança
  // em utils/shareLinks.js.
  const budgetLink1 = await fetch(`${BASE}/api/budget/public-link/generate`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'ghelplus' })
  }).then((r) => r.json());
  check('[Sanidade] Budget (1 modo só) ainda gera link normalmente', !!budgetLink1.publicToken);
  const budgetLink2 = await fetch(`${BASE}/api/budget/public-link/generate`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'ghelplus' })
  }).then((r) => r.json());
  check('[Sanidade] gerar de novo pro Budget troca o token (continua 1 link só)', budgetLink2.publicToken !== budgetLink1.publicToken);
  const budgetLink1Invalido = await fetch(`${BASE}/api/budget/public/${budgetLink1.publicToken}`);
  check('[Sanidade] Budget: o token antigo foi invalidado (comportamento de sempre, não mudou)', budgetLink1Invalido.status === 404);
  await fetch(`${BASE}/api/budget/public-link?brand=ghelplus`, { method: 'DELETE', headers: hj(adminToken) }); // limpeza

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
