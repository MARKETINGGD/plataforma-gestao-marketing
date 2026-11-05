// Teste de integração (servidor de verdade) da 144ª rodada -- pedidos da
// Raquel sobre Controle de Expositores (ver comentários em
// routes/expositores.js):
//   #88) "na aba de lançamento mensal no budget, deve ter a opção de
//        excluir o lançamento total mensal também" -- DELETE
//        /lancamentos-mensais/:id, remove o histórico E o budgetEntry
//        gerado por ele.
//   #90) "importante ter um link externo também para o total mensal" --
//        GET/POST/DELETE .../total-mensal/public-link(/generate) e GET
//        .../total-mensal/public/:token.
//   #91) "opção de adicionar novos expositores no controle" -- POST
//        /estoque (cria item novo, computeDerived sempre aplicado).
// (#89, agrupar linhas por código de saída na tabela, é só renderização
// visual no front -- sem contrato de API pra testar aqui.)
//
// Roda numa cópia ISOLADA do projeto, mesmo padrão dos demais
// test-manual/*.test.js -- backup/restauração do data/db.json real.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-controle-expositores-144';
process.env.PORT = '4347';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4347';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-controle-expositores-144-test');
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

  const BASE = 'http://localhost:4347';

  async function login(username, password) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then((r) => r.json());
    return res.token;
  }

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

  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }
  function h(token) { return { Authorization: `Bearer ${token}` }; }
  async function createUser(username, name, permissions) {
    const res = await fetch(`${BASE}/api/auth/users`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ username, password: '123456', name, cargo: 'analista' })
    }).then((r) => r.json());
    if (permissions) {
      await fetch(`${BASE}/api/auth/users/${res.user.id}`, { method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ permissions }) });
    }
    return res.user;
  }
  const editor = await createUser('controleeditor144', 'Controle Editor 144', { expositores: 'editor' });
  const semAcesso = await createUser('controlesemacesso144', 'Controle Sem Acesso 144', { expositores: 'none' });
  const editorToken = await login('controleeditor144', '123456');
  const semAcessoToken = await login('controlesemacesso144', '123456');
  check('usuários de teste criados', !!(editor && semAcesso));

  // ========== #91: adicionar novo item ao Controle de Expositores ==========
  const semMarca = await fetch(`${BASE}/api/expositores/estoque`, { method: 'POST', headers: hj(editorToken), body: JSON.stringify({ codigoEntrada: '999' }) });
  check('criar item sem marca é rejeitado (400)', semMarca.status === 400);

  const semCodigoNemDescricao = await fetch(`${BASE}/api/expositores/estoque`, { method: 'POST', headers: hj(editorToken), body: JSON.stringify({ brand: 'ghelplus' }) });
  check('criar item sem código nem descrição de entrada é rejeitado (400)', semCodigoNemDescricao.status === 400);

  const semPermissao = await fetch(`${BASE}/api/expositores/estoque`, { method: 'POST', headers: hj(semAcessoToken), body: JSON.stringify({ brand: 'ghelplus', codigoEntrada: '999' }) });
  check('quem não tem permissão de editar Expositores não consegue criar item (403)', semPermissao.status === 403);

  const novoItem = await fetch(`${BASE}/api/expositores/estoque`, {
    method: 'POST', headers: hj(editorToken),
    body: JSON.stringify({ brand: 'ghelplus', codigoEntrada: '999888', descricaoEntrada: 'Item Novo Teste 144', codigoSaida: '03999', descricaoSaida: 'Saída Teste 144', estoqueInicial: 10, consumoMensal: 2 })
  }).then((r) => r.json()).then((d) => d.item);
  check('item novo criado com os campos informados', novoItem.brand === 'ghelplus' && novoItem.codigoEntrada === '999888' && novoItem.descricaoEntrada === 'Item Novo Teste 144');
  check('campos calculados (computeDerived) vieram preenchidos mesmo num item recém-criado', novoItem.saldoTotal !== undefined && novoItem.valorTotalMensal !== undefined);

  const listaEstoque = await fetch(`${BASE}/api/expositores/estoque?brand=ghelplus`, { headers: h(editorToken) }).then((r) => r.json());
  check('item novo aparece na listagem', listaEstoque.items.some((it) => it.id === novoItem.id));

  // ========== #90: link externo pro Total Mensal ==========
  const semLinkAinda = await fetch(`${BASE}/api/expositores/lancamentos-mensais/total-mensal/public-link`, { headers: h(editorToken) }).then((r) => r.json());
  check('ainda sem link gerado, publicToken vem null', semLinkAinda.publicToken === null);

  const semPermissaoLink = await fetch(`${BASE}/api/expositores/lancamentos-mensais/total-mensal/public-link/generate`, { method: 'POST', headers: hj(semAcessoToken) });
  check('quem não tem permissão não consegue gerar o link do Total Mensal (403)', semPermissaoLink.status === 403);

  const gerado = await fetch(`${BASE}/api/expositores/lancamentos-mensais/total-mensal/public-link/generate`, { method: 'POST', headers: hj(editorToken) }).then((r) => r.json());
  check('link do Total Mensal gerado', !!gerado.publicToken);

  // lança um mês de verdade pra ter dado real aparecendo no link público
  await fetch(`${BASE}/api/expositores/lancamentos-mensais/lancar`, { method: 'POST', headers: hj(editorToken), body: JSON.stringify({ brand: 'ghelplus', year: 2027, month: 5 }) });

  const viaLinkPublico = await fetch(`${BASE}/api/expositores/lancamentos-mensais/total-mensal/public/${gerado.publicToken}`).then((r) => r.json());
  check('link público do Total Mensal funciona sem login e devolve os itens agregados', Array.isArray(viaLinkPublico.items) && viaLinkPublico.items.some((it) => it.year === 2027 && it.month === 5));

  const tokenInvalido = await fetch(`${BASE}/api/expositores/lancamentos-mensais/total-mensal/public/token-que-nao-existe`);
  check('token inválido devolve 404', tokenInvalido.status === 404);

  const revogado = await fetch(`${BASE}/api/expositores/lancamentos-mensais/total-mensal/public-link`, { method: 'DELETE', headers: h(editorToken) });
  check('revogar o link funciona (200)', revogado.status === 200);
  const depoisRevogar = await fetch(`${BASE}/api/expositores/lancamentos-mensais/total-mensal/public/${gerado.publicToken}`);
  check('depois de revogado, o token antigo para de funcionar (404)', depoisRevogar.status === 404);

  // ========== #88: excluir lançamento mensal (histórico + budgetEntry) ==========
  const lancamentoDebacco = await fetch(`${BASE}/api/expositores/lancamentos-mensais/lancar`, {
    method: 'POST', headers: hj(editorToken), body: JSON.stringify({ brand: 'debacco', year: 2027, month: 6 })
  }).then((r) => r.json());
  check('lançamento mensal criado com budgetEntry associado', !!lancamentoDebacco.launch.budgetEntryId && !!lancamentoDebacco.budgetEntry.id);
  const launchId = lancamentoDebacco.launch.id;
  const budgetEntryId = lancamentoDebacco.launch.budgetEntryId;

  // Budget tem permissão PRÓPRIA (não a de Expositores) -- usa o admin
  // (super admin, acesso a tudo) pra conferir o lançamento automático.
  const budgetAntesDeletar = await fetch(`${BASE}/api/budget?brand=debacco&year=2027`, { headers: h(adminToken) }).then((r) => r.json());
  check('o budgetEntry do lançamento existe no Budget antes de excluir', (budgetAntesDeletar.entries || []).some((e) => e.id === budgetEntryId));

  const semPermissaoExcluir = await fetch(`${BASE}/api/expositores/lancamentos-mensais/${launchId}`, { method: 'DELETE', headers: h(semAcessoToken) });
  check('quem não tem permissão não consegue excluir o lançamento (403)', semPermissaoExcluir.status === 403);

  const inexistente = await fetch(`${BASE}/api/expositores/lancamentos-mensais/id-que-nao-existe`, { method: 'DELETE', headers: h(editorToken) });
  check('excluir lançamento inexistente devolve 404', inexistente.status === 404);

  const excluido = await fetch(`${BASE}/api/expositores/lancamentos-mensais/${launchId}`, { method: 'DELETE', headers: h(editorToken) });
  check('excluir o lançamento mensal funciona (200)', excluido.status === 200);

  const historicoDepois = await fetch(`${BASE}/api/expositores/lancamentos-mensais?brand=debacco`, { headers: h(editorToken) }).then((r) => r.json());
  check('depois de excluído, o lançamento não aparece mais no histórico', !historicoDepois.items.some((l) => l.id === launchId));

  const budgetDepoisDeletar = await fetch(`${BASE}/api/budget?brand=debacco&year=2027`, { headers: h(adminToken) }).then((r) => r.json());
  check('"nunca deixar lançamento fantasma no Budget" -- o budgetEntry associado também foi removido', !(budgetDepoisDeletar.entries || []).some((e) => e.id === budgetEntryId));

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;

  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(process.exitCode);
}

run().catch((e) => {
  console.error(e);
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  process.exit(1);
});
