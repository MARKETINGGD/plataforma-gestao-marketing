// Teste de integração (servidor de verdade) da 78ª rodada -- pedido
// detalhado da Raquel: nova feature de Orçamentos de Expositores.
// "Orçamento deve ter: Nome do expositor, ano de lançamento, imagens,
// desenho técnico, a imagem dele deve aparecer ao lado do nome...
// empresas orçadas (deve ser semelhante a uma planilha, para poder
// comparar qual o melhor orçamento para esse expositor (deve ter
// Fornecedor, valor, material, prazo de entrega, pedido minimo). Deve ter
// a opção de cadastrar quantos fornecedores forem necessários para esse
// expositor. Quando selecionar um, deve ter qual foi o fornecedor
// escolhido."
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-expositores-orcamentos-78';
process.env.PORT = '4345';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4345';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-expositores-orcamentos-78-test');
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

  const BASE = 'http://localhost:4345';

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
  const editor = await createUser('orceditor78', 'Orc Editor 78', { expositores: 'editor' });
  const semAcesso = await createUser('orcsemacesso78', 'Orc Sem Acesso 78', { expositores: 'none' });
  const editorToken = await login('orceditor78', '123456');
  const semAcessoToken = await login('orcsemacesso78', '123456');
  check('usuários de teste criados', !!(editor && semAcesso));

  // ---------- CRUD básico ----------
  const semNome = await fetch(`${BASE}/api/expositores/orcamentos`, { method: 'POST', headers: hj(editorToken), body: JSON.stringify({ brand: 'ghelplus' }) });
  check('criar sem nome é rejeitado (400)', semNome.status === 400);

  const semPermissao = await fetch(`${BASE}/api/expositores/orcamentos`, { method: 'POST', headers: hj(semAcessoToken), body: JSON.stringify({ brand: 'ghelplus', nome: 'X' }) });
  check('quem não tem permissão de editar Expositores não consegue criar (403)', semPermissao.status === 403);

  const orc = await fetch(`${BASE}/api/expositores/orcamentos`, {
    method: 'POST', headers: hj(editorToken),
    body: JSON.stringify({ brand: 'ghelplus', nome: 'Expositor Teste 78', anoLancamento: 2026 })
  }).then((r) => r.json()).then((d) => d.item);
  check('expositor orçado criado com nome e ano', orc.nome === 'Expositor Teste 78' && orc.anoLancamento === 2026);
  check('nasce sem imagens/desenho técnico/fornecedores', orc.imagens.length === 0 && orc.desenhoTecnico.length === 0 && orc.fornecedores.length === 0);

  const listaGhelplus = await fetch(`${BASE}/api/expositores/orcamentos?brand=ghelplus`, { headers: h(semAcessoToken) }).then((r) => r.json());
  check('quem não pode editar AINDA CONSEGUE VER a lista (mesmo padrão do resto de Expositores)', listaGhelplus.items.some((it) => it.id === orc.id));
  check('GET devolve canEdit certo por pessoa (false pra quem não tem permissão)', listaGhelplus.canEdit === false);

  const rename = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}`, { method: 'PUT', headers: hj(editorToken), body: JSON.stringify({ nome: 'Expositor Teste 78 Renomeado' }) }).then((r) => r.json()).then((d) => d.item);
  check('editar nome/ano funciona', rename.nome === 'Expositor Teste 78 Renomeado');

  // ---------- Imagens ----------
  const fdImg = new FormData();
  fdImg.append('files', new Blob(['fake-jpg'], { type: 'image/jpeg' }), 'foto1.jpg');
  fdImg.append('files', new Blob(['fake-jpg-2'], { type: 'image/jpeg' }), 'foto2.jpg');
  const comImagens = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/imagens`, { method: 'POST', headers: h(editorToken), body: fdImg }).then((r) => r.json()).then((d) => d.item);
  check('upload de 2 imagens de uma vez funciona', comImagens.imagens.length === 2);

  const semImagemNenhuma = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/imagens`, { method: 'POST', headers: h(editorToken), body: new FormData() });
  check('upload sem nenhum arquivo é rejeitado (400)', semImagemNenhuma.status === 400);

  const imagemParaApagar = comImagens.imagens[0].id;
  const semUmaImagem = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/imagens/${imagemParaApagar}`, { method: 'DELETE', headers: h(editorToken) }).then((r) => r.json()).then((d) => d.item);
  check('remover 1 imagem funciona (sobra 1)', semUmaImagem.imagens.length === 1);

  // ---------- Desenho técnico ----------
  const fdDesenho = new FormData();
  fdDesenho.append('files', new Blob(['fake-pdf'], { type: 'application/pdf' }), 'desenho.pdf');
  const comDesenho = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/desenho-tecnico`, { method: 'POST', headers: h(editorToken), body: fdDesenho }).then((r) => r.json()).then((d) => d.item);
  check('upload de desenho técnico funciona (coleção separada de imagens)', comDesenho.desenhoTecnico.length === 1 && comDesenho.imagens.length === 1);

  // ---------- Fornecedores (empresas orçadas) ----------
  const f1 = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/fornecedores`, {
    method: 'POST', headers: hj(editorToken),
    body: JSON.stringify({ fornecedor: 'Fornecedor A', valor: 1000, material: 'Aço inox', prazoEntrega: '15 dias', pedidoMinimo: '10 unidades' })
  }).then((r) => r.json()).then((d) => d.item);
  check('1º fornecedor adicionado', f1.fornecedores.length === 1 && f1.fornecedores[0].fornecedor === 'Fornecedor A');

  const semNomeFornecedor = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/fornecedores`, { method: 'POST', headers: hj(editorToken), body: JSON.stringify({ valor: 500 }) });
  check('fornecedor sem nome é rejeitado (400)', semNomeFornecedor.status === 400);

  const f2Res = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/fornecedores`, {
    method: 'POST', headers: hj(editorToken),
    body: JSON.stringify({ fornecedor: 'Fornecedor B', valor: 800, material: 'Alumínio', prazoEntrega: '20 dias', pedidoMinimo: '5 unidades' })
  }).then((r) => r.json()).then((d) => d.item);
  check('"quantos fornecedores forem necessários" -- 2º fornecedor também é aceito, sem limite', f2Res.fornecedores.length === 2);
  const f2Id = f2Res.fornecedores.find((f) => f.fornecedor === 'Fornecedor B').id;
  const f1Id = f2Res.fornecedores.find((f) => f.fornecedor === 'Fornecedor A').id;

  check('nenhum fornecedor está marcado como escolhido ainda', f2Res.fornecedores.every((f) => f.escolhido === false));

  const escolheu = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/fornecedores/${f2Id}`, {
    method: 'PUT', headers: hj(editorToken), body: JSON.stringify({ escolhido: true })
  }).then((r) => r.json()).then((d) => d.item);
  check('marcar o Fornecedor B como escolhido funciona', escolheu.fornecedores.find((f) => f.id === f2Id).escolhido === true);
  check('Fornecedor A continua NÃO escolhido', escolheu.fornecedores.find((f) => f.id === f1Id).escolhido === false);

  const trocouEscolha = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/fornecedores/${f1Id}`, {
    method: 'PUT', headers: hj(editorToken), body: JSON.stringify({ escolhido: true })
  }).then((r) => r.json()).then((d) => d.item);
  check('"quando selecionar um" -- escolher o Fornecedor A agora desmarca o B automaticamente (só 1 escolhido por vez)', trocouEscolha.fornecedores.find((f) => f.id === f1Id).escolhido === true && trocouEscolha.fornecedores.find((f) => f.id === f2Id).escolhido === false);

  const editouValor = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/fornecedores/${f1Id}`, {
    method: 'PUT', headers: hj(editorToken), body: JSON.stringify({ valor: 950 })
  }).then((r) => r.json()).then((d) => d.item);
  check('editar só o valor de um fornecedor não mexe na escolha dele', editouValor.fornecedores.find((f) => f.id === f1Id).valor === 950 && editouValor.fornecedores.find((f) => f.id === f1Id).escolhido === true);

  const semAcessoEscolher = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/fornecedores/${f2Id}`, { method: 'PUT', headers: hj(semAcessoToken), body: JSON.stringify({ escolhido: true }) });
  check('quem não tem permissão não consegue mudar a escolha (403)', semAcessoEscolher.status === 403);

  const apagouFornecedor = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/fornecedores/${f2Id}`, { method: 'DELETE', headers: h(editorToken) }).then((r) => r.json()).then((d) => d.item);
  check('excluir um fornecedor funciona (sobra 1)', apagouFornecedor.fornecedores.length === 1);

  // ---------- Excluir o expositor inteiro ----------
  const delRes = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}`, { method: 'DELETE', headers: h(editorToken) });
  check('excluir o expositor orçado funciona (200)', delRes.status === 200);
  const listaDepois = await fetch(`${BASE}/api/expositores/orcamentos?brand=ghelplus`, { headers: h(adminToken) }).then((r) => r.json());
  check('depois de excluído, não aparece mais na lista', !listaDepois.items.some((it) => it.id === orc.id));

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
