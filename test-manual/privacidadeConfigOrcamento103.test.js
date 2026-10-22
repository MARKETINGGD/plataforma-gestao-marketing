// Teste de integração (servidor de verdade, mesmo padrão dos demais
// test-manual/*.test.js) da 103ª rodada -- pedido da Raquel: "esses
// modulos novos, tbm devem ser privados e o admim decide se vai liberar p
// alguém editar ou somente visualizar", esclarecido depois pra 2 telas
// específicas: "o unico modulo que só o admim vê (a n ser que ele de
// autorização) é: configurações, budget" (demais módulos continuam como
// estavam: visualização aberta a todo mundo, só edição restrita).
//
// Cobre:
//   1. Configurações (Usuários + Integrações) fica privada por padrão --
//      usuário novo (sem nenhuma permissão) recebe 403 em GET /api/auth/
//      users e GET /api/social-accounts; super admin sempre vê (sem
//      precisar de permissão nenhuma).
//   2. Conceder "configuracoes: visualizar" libera os 2 GETs acima, sem
//      liberar nenhuma ação de edição (POST/PUT/DELETE de usuário e
//      connect/disconnect de integração continuam 403 -- só
//      requireSuperAdmin de verdade).
//   3. Orçamento (budget) ganha o novo nível "visualizar": alguém com
//      budget:'visualizar' consegue ver (GET) mas não criar/editar/
//      excluir lançamento (POST/PUT/DELETE continuam 403) -- sem quebrar
//      o comportamento já existente (budget:'none' continua bloqueando a
//      visualização por completo, igual sempre foi).
//   4. sanitizePermissions aceita 'visualizar' como valor válido (persiste
//      de verdade via PUT /users/:id) e continua rejeitando valor
//      inválido (cai no padrão 'none').
//   5. Bug corrigido nesta rodada: a permissão "fornecedores" (reservada
//      desde a 100ª rodada, em uso desde a 102ª) não tinha uma linha na
//      tela de Usuários pra ser concedida -- confirma que agora dá pra
//      conceder 'editor' em fornecedores via PUT /users/:id e que isso
//      realmente libera criar um fornecedor (sem essa concessão, 403).
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-privacidade-config-orcamento-103';
process.env.PORT = '4368';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4368';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-privacidade-config-orcamento-103-test');
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

  const BASE = 'http://localhost:4368';
  const db = require('../db');

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
      body: JSON.stringify({ name: 'Admin Teste', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
  } else {
    adminToken = await login('admin', '123456');
  }
  check('login/setup do admin devolveu token', !!adminToken);

  // ---------- 1. Configurações privada por padrão ----------
  await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'semConfig103', password: '123456', name: 'Sem Config 103' })
  });
  const tokenSemConfig = await login('semConfig103', '123456');

  const usersBloqueado = await fetch(`${BASE}/api/auth/users`, { headers: hj(tokenSemConfig) });
  check('[103ª rodada] usuário sem permissão NÃO vê a lista de Usuários (403)', usersBloqueado.status === 403);

  const integBloqueado = await fetch(`${BASE}/api/social-accounts`, { headers: hj(tokenSemConfig) });
  check('[103ª rodada] usuário sem permissão NÃO vê Integrações (403)', integBloqueado.status === 403);

  const usersComoAdmin = await fetch(`${BASE}/api/auth/users`, { headers: hj(adminToken) });
  check('[103ª rodada] super admin sempre vê Usuários, sem precisar de permissão (200)', usersComoAdmin.status === 200);
  const integComoAdmin = await fetch(`${BASE}/api/social-accounts`, { headers: hj(adminToken) });
  check('[103ª rodada] super admin sempre vê Integrações, sem precisar de permissão (200)', integComoAdmin.status === 200);

  // ---------- 2. Conceder "configuracoes: visualizar" libera só a visualização ----------
  const semConfigUser = db.get('users').find({ username: 'semConfig103' }).value();
  await fetch(`${BASE}/api/auth/users/${semConfigUser.id}`, {
    method: 'PUT', headers: hj(adminToken),
    body: JSON.stringify({ permissions: Object.assign({}, semConfigUser.permissions, { configuracoes: 'visualizar' }) })
  });
  const tokenComConfig = await login('semConfig103', '123456');

  const usersLiberado = await fetch(`${BASE}/api/auth/users`, { headers: hj(tokenComConfig) });
  check('[103ª rodada] com "configuracoes: visualizar", consegue ver Usuários (200)', usersLiberado.status === 200);
  const integLiberado = await fetch(`${BASE}/api/social-accounts`, { headers: hj(tokenComConfig) });
  check('[103ª rodada] com "configuracoes: visualizar", consegue ver Integrações (200)', integLiberado.status === 200);

  const criarUsuarioBloqueado = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(tokenComConfig), body: JSON.stringify({ username: 'naoDeviaCriar', password: '123456' })
  });
  check('[103ª rodada] "visualizar" NÃO libera criar usuário (continua 403, só super admin)', criarUsuarioBloqueado.status === 403);
  const conectarMetaBloqueado = await fetch(`${BASE}/api/social-accounts/meta/connect?brand=ghelplus`, { headers: hj(tokenComConfig) });
  check('[103ª rodada] "visualizar" NÃO libera conectar integração (continua 403, só super admin)', conectarMetaBloqueado.status === 403);

  // ---------- 3. Orçamento ganha o nível "visualizar" ----------
  await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'budgetVisualizar103', password: '123456', name: 'Budget Visualizar 103', permissions: { budget: 'visualizar' } })
  });
  const tokenBudgetView = await login('budgetVisualizar103', '123456');
  const budgetVerOk = await fetch(`${BASE}/api/budget?brand=ghelplus`, { headers: hj(tokenBudgetView) });
  check('[103ª rodada] budget:"visualizar" consegue VER o orçamento (200)', budgetVerOk.status === 200);
  const budgetCriarBloqueado = await fetch(`${BASE}/api/budget`, {
    method: 'POST', headers: hj(tokenBudgetView), body: JSON.stringify({ brand: 'ghelplus', year: 2026, month: 1, category: 'Institucional - 2.5.2.3' })
  });
  check('[103ª rodada] budget:"visualizar" NÃO consegue criar lançamento (continua 403)', budgetCriarBloqueado.status === 403);

  // Regressão: budget:'none' continua bloqueando a visualização por
  // completo, exatamente como já era antes desta rodada.
  await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'semBudget103', password: '123456', name: 'Sem Budget 103' })
  });
  const tokenSemBudget = await login('semBudget103', '123456');
  const budgetVerBloqueado = await fetch(`${BASE}/api/budget?brand=ghelplus`, { headers: hj(tokenSemBudget) });
  check('[103ª rodada regressão] budget:"none" continua bloqueando a visualização (403)', budgetVerBloqueado.status === 403);

  // ---------- 4. sanitizePermissions aceita 'visualizar' e rejeita inválido ----------
  const budgetUser = db.get('users').find({ username: 'budgetVisualizar103' }).value();
  check('[103ª rodada] "visualizar" persistiu de verdade no banco pra budget', budgetUser.permissions.budget === 'visualizar');
  await fetch(`${BASE}/api/auth/users/${budgetUser.id}`, {
    method: 'PUT', headers: hj(adminToken),
    body: JSON.stringify({ permissions: Object.assign({}, budgetUser.permissions, { budget: 'valor-invalido-qualquer' }) })
  });
  const budgetUserDepois = db.get('users').find({ id: budgetUser.id }).value();
  check('[103ª rodada] valor inválido de permissão cai pro padrão "none" (nunca salva lixo)', budgetUserDepois.permissions.budget === 'none');

  // ---------- 5. Bug corrigido: permissão "fornecedores" agora é concedível ----------
  await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'semFornecedores103', password: '123456', name: 'Sem Fornecedores 103' })
  });
  const tokenSemFornecedores = await login('semFornecedores103', '123456');
  const criarFornecedorBloqueado = await fetch(`${BASE}/api/fornecedores`, {
    method: 'POST', headers: hj(tokenSemFornecedores), body: JSON.stringify({ nome: 'Fornecedor 103 Bloqueado' })
  });
  check('[103ª rodada] sem a permissão, continua 403 ao criar fornecedor', criarFornecedorBloqueado.status === 403);

  const semFornecedoresUser = db.get('users').find({ username: 'semFornecedores103' }).value();
  await fetch(`${BASE}/api/auth/users/${semFornecedoresUser.id}`, {
    method: 'PUT', headers: hj(adminToken),
    body: JSON.stringify({ permissions: Object.assign({}, semFornecedoresUser.permissions, { fornecedores: 'editor' }) })
  });
  const tokenComFornecedores = await login('semFornecedores103', '123456');
  const criarFornecedorLiberado = await fetch(`${BASE}/api/fornecedores`, {
    method: 'POST', headers: hj(tokenComFornecedores), body: JSON.stringify({ nome: 'Fornecedor 103 Liberado' })
  });
  check('[103ª rodada] concedendo "fornecedores: editor" via PUT /users/:id, consegue criar (200)', criarFornecedorLiberado.status === 200);

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(() => {
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(process.exitCode);
});
