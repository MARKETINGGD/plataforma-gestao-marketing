// Teste de integração (servidor de verdade, mesmo padrão dos demais
// test-manual/*.test.js) da 102ª rodada -- novo menu Fornecedores: campo
// Tipo em lista aberta, cadastro completo, filtros de busca (nome, tipo)
// e seção "últimos pedidos feitos" agregando automaticamente de qualquer
// módulo com fluxo orçamento->pedido (hoje, só Brindes → Compras, ver
// 101ª rodada).
//
// Cobre:
//   1. GET lista fornecedores já criados automaticamente por Brindes
//      Compras (101ª rodada), com tiposUsados e canEdit corretos.
//   2. Filtro por nome (parcial, case-insensitive) e por tipo (exato).
//   3. POST cria um fornecedor manual (autoCreated:false); rejeita nome
//      duplicado (mesmo nome de um já existente, inclusive um que nasceu
//      automático de uma compra).
//   4. PUT edita um fornecedor; "confirma" o cadastro (autoCreated passa
//      a false mesmo quando nasceu automático); rejeita renomear pra um
//      nome que já existe em OUTRO fornecedor.
//   5. GET /:id/pedidos devolve o histórico agregado de Brindes Compras
//      pra esse fornecedor (reaproveitando o fluxo já testado na 101ª).
//   6. DELETE remove o cadastro.
//   7. Permissão: quem não tem "fornecedores" editor/admin visualiza
//      (200) mas não cria/edita/exclui (403); quem tem "fornecedores:
//      editor" consegue.
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-fornecedores-102';
process.env.PORT = '4366';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4366';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-fornecedores-102-test');
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

  const BASE = 'http://localhost:4366';
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

  // ---------- 0. Gera uma compra em Brindes (fluxo da 101ª) pra ter um
  //              fornecedor auto-criado pra testar nesta rodada ----------
  const compra = await fetch(`${BASE}/api/brindes/compras`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ item: 'Squeeze Personalizado', fornecedor: 'Gráfica Fornecedores 102', quantidade: 50, valorUnitario: 9.9, quemPediu: 'Raquel', formaPagamento: 'Pix', dataCompra: '2026-10-22' })
  }).then((r) => r.json()).then((d) => d.item);
  check('setup: compra em Brindes criou o fornecedor automaticamente', !!db.get('fornecedores').find({ nome: 'Gráfica Fornecedores 102' }).value());

  // ---------- 1. GET lista, com tiposUsados e canEdit ----------
  const listaInicial = await fetch(`${BASE}/api/fornecedores`, { headers: hj(adminToken) }).then((r) => r.json());
  check('[102ª rodada] GET /api/fornecedores devolve canEdit:true pro admin', listaInicial.canEdit === true);
  check('[102ª rodada] GET /api/fornecedores lista o fornecedor auto-criado por Brindes Compras', listaInicial.items.some((f) => f.nome === 'Gráfica Fornecedores 102'));
  const fornecedorAuto = listaInicial.items.find((f) => f.nome === 'Gráfica Fornecedores 102');
  check('[102ª rodada] fornecedor auto-criado chega com autoCreated:true', fornecedorAuto.autoCreated === true);
  check('[102ª rodada] fornecedor auto-criado já traz a "última compra" certa', fornecedorAuto.ultimaCompra && fornecedorAuto.ultimaCompra.item === 'Squeeze Personalizado' && fornecedorAuto.ultimaCompra.valor === 495);

  // ---------- 2. POST cria fornecedor manual; rejeita nome duplicado ----------
  const novoFornecedor = await fetch(`${BASE}/api/fornecedores`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ nome: 'Expositores ABC Teste', tipo: 'expositores', contato: 'João', telefone: '11999990000', email: 'joao@abc.com', cnpj: '00.000.000/0001-00', endereco: 'Rua Teste, 123', observacoes: 'fornecedor confiável' })
  }).then((r) => r.json()).then((d) => d.item);
  check('[102ª rodada] POST cria fornecedor manual com autoCreated:false', novoFornecedor.autoCreated === false);
  check('[102ª rodada] fornecedor manual guarda tipo/contato/cnpj/endereco certos', novoFornecedor.tipo === 'expositores' && novoFornecedor.contato === 'João' && novoFornecedor.cnpj === '00.000.000/0001-00' && novoFornecedor.endereco === 'Rua Teste, 123');
  const duplicado = await fetch(`${BASE}/api/fornecedores`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ nome: 'expositores abc teste' })
  });
  check('[102ª rodada] POST rejeita nome duplicado (case-insensitive) com 400', duplicado.status === 400);
  const duplicadoDoAuto = await fetch(`${BASE}/api/fornecedores`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ nome: '  Gráfica Fornecedores 102  ' })
  });
  check('[102ª rodada] POST rejeita nome duplicado mesmo de um fornecedor auto-criado', duplicadoDoAuto.status === 400);
  const semNome = await fetch(`${BASE}/api/fornecedores`, { method: 'POST', headers: hj(adminToken), body: JSON.stringify({ nome: '   ' }) });
  check('[102ª rodada] POST rejeita nome vazio com 400', semNome.status === 400);

  // ---------- 3. Filtros por nome e tipo ----------
  const filtroNome = await fetch(`${BASE}/api/fornecedores?nome=expositores`, { headers: hj(adminToken) }).then((r) => r.json());
  check('[102ª rodada] filtro por nome (parcial, case-insensitive) encontra "Expositores ABC Teste"', filtroNome.items.length === 1 && filtroNome.items[0].nome === 'Expositores ABC Teste');
  const filtroTipo = await fetch(`${BASE}/api/fornecedores?tipo=expositores`, { headers: hj(adminToken) }).then((r) => r.json());
  check('[102ª rodada] filtro por tipo encontra só quem tem esse tipo', filtroTipo.items.length === 1 && filtroTipo.items[0].nome === 'Expositores ABC Teste');
  check('[102ª rodada] tiposUsados inclui "expositores"', listaInicial.items && filtroTipo.tiposUsados.includes('expositores'));

  // ---------- 4. PUT edita e "confirma" o cadastro auto-criado ----------
  const putAuto = await fetch(`${BASE}/api/fornecedores/${fornecedorAuto.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ tipo: 'brindes', contato: 'Marcos', telefone: '41988887777' })
  }).then((r) => r.json()).then((d) => d.item);
  check('[102ª rodada] editar manualmente um fornecedor auto-criado "confirma" o cadastro (autoCreated:false)', putAuto.autoCreated === false);
  check('[102ª rodada] edição aplicou os campos novos (tipo/contato/telefone)', putAuto.tipo === 'brindes' && putAuto.contato === 'Marcos' && putAuto.telefone === '41988887777');
  check('[102ª rodada] edição não perdeu a "última compra" já registrada', putAuto.ultimaCompra && putAuto.ultimaCompra.item === 'Squeeze Personalizado');

  const renomeiaOk = await fetch(`${BASE}/api/fornecedores/${novoFornecedor.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ nome: 'Expositores ABC Teste Renomeado' })
  });
  check('[102ª rodada] renomear pra um nome livre funciona', renomeiaOk.status === 200);
  const renomeiaColisao = await fetch(`${BASE}/api/fornecedores/${novoFornecedor.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ nome: 'Gráfica Fornecedores 102' })
  });
  check('[102ª rodada] renomear pro nome de OUTRO fornecedor já existente é rejeitado (400)', renomeiaColisao.status === 400);
  const putInexistente = await fetch(`${BASE}/api/fornecedores/id-que-nao-existe`, { method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ nome: 'x' }) });
  check('[102ª rodada] PUT em fornecedor inexistente devolve 404', putInexistente.status === 404);

  // ---------- 5. GET /:id/pedidos agrega o histórico de Brindes Compras ----------
  const pedidos = await fetch(`${BASE}/api/fornecedores/${fornecedorAuto.id}/pedidos`, { headers: hj(adminToken) }).then((r) => r.json());
  check('[102ª rodada] "últimos pedidos feitos" lista a compra do Squeeze', pedidos.pedidos.length === 1 && pedidos.pedidos[0].item === 'Squeeze Personalizado' && pedidos.pedidos[0].origem === 'Brindes · Compras');
  const pedidosSemHistorico = await fetch(`${BASE}/api/fornecedores/${novoFornecedor.id}/pedidos`, { headers: hj(adminToken) }).then((r) => r.json());
  check('[102ª rodada] fornecedor sem nenhuma compra tem "pedidos" vazio', Array.isArray(pedidosSemHistorico.pedidos) && pedidosSemHistorico.pedidos.length === 0);
  const pedidosInexistente = await fetch(`${BASE}/api/fornecedores/id-que-nao-existe/pedidos`, { headers: hj(adminToken) });
  check('[102ª rodada] GET /:id/pedidos de fornecedor inexistente devolve 404', pedidosInexistente.status === 404);

  // ---------- 6. DELETE remove o cadastro ----------
  const delResp = await fetch(`${BASE}/api/fornecedores/${novoFornecedor.id}`, { method: 'DELETE', headers: hj(adminToken) });
  check('[102ª rodada] DELETE remove o fornecedor', delResp.status === 200 && !db.get('fornecedores').find({ id: novoFornecedor.id }).value());
  const delInexistente = await fetch(`${BASE}/api/fornecedores/id-que-nao-existe`, { method: 'DELETE', headers: hj(adminToken) });
  check('[102ª rodada] DELETE em fornecedor inexistente devolve 404', delInexistente.status === 404);

  // ---------- 7. Permissão ----------
  await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'semFornecedores102', password: '123456', name: 'Sem Permissão Fornecedores' })
  });
  const tokenSemPermissao = await login('semFornecedores102', '123456');
  const verOk = await fetch(`${BASE}/api/fornecedores`, { headers: hj(tokenSemPermissao) });
  const verOkJson = await verOk.json();
  check('[102ª rodada] quem não tem permissão de Fornecedores ainda consegue VER a lista (200)', verOk.status === 200);
  check('[102ª rodada] canEdit vem false pra quem não tem permissão', verOkJson.canEdit === false);
  const criarBloqueado = await fetch(`${BASE}/api/fornecedores`, { method: 'POST', headers: hj(tokenSemPermissao), body: JSON.stringify({ nome: 'Não devia criar' }) });
  check('[102ª rodada] quem não tem permissão NÃO consegue criar (403)', criarBloqueado.status === 403);
  const editarBloqueado = await fetch(`${BASE}/api/fornecedores/${fornecedorAuto.id}`, { method: 'PUT', headers: hj(tokenSemPermissao), body: JSON.stringify({ contato: 'x' }) });
  check('[102ª rodada] quem não tem permissão NÃO consegue editar (403)', editarBloqueado.status === 403);
  const excluirBloqueado = await fetch(`${BASE}/api/fornecedores/${fornecedorAuto.id}`, { method: 'DELETE', headers: hj(tokenSemPermissao) });
  check('[102ª rodada] quem não tem permissão NÃO consegue excluir (403)', excluirBloqueado.status === 403);

  await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'comFornecedores102', password: '123456', name: 'Com Permissão Fornecedores', permissions: { fornecedores: 'editor' } })
  });
  const tokenComPermissao = await login('comFornecedores102', '123456');
  const criarPermitido = await fetch(`${BASE}/api/fornecedores`, { method: 'POST', headers: hj(tokenComPermissao), body: JSON.stringify({ nome: 'Fornecedor Criado Por Editor 102' }) });
  check('[102ª rodada] quem tem "fornecedores: editor" consegue criar (200)', criarPermitido.status === 200);

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
