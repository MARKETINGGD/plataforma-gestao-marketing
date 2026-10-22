// Teste de integração (servidor de verdade, mesmo padrão dos demais
// test-manual/*.test.js) da 101ª rodada -- Brindes ganha o submenu
// Compras (item comprado, quantidade, valor unitário, valor total, quem
// pediu, quem autorizou, fornecedor, data da compra, forma de pagamento,
// data de entrega, conferência) + a aba Orçamentos, com aprovar um
// orçamento criando a Compra automaticamente e atualizando o cadastro do
// fornecedor (coleção `fornecedores`, campo "última compra").
//
// Cobre:
//   1. Orçamento nasce "pendente", sem gerar Compra nenhuma.
//   2. Aprovar um orçamento cria a Compra automaticamente (campos certos,
//      quem autorizou = quem aprovou, valorTotal = quantidade x unitário)
//      e atualiza/cria o cadastro do fornecedor com a última compra.
//   3. Aprovar de novo (ou reaprovar) o MESMO orçamento nunca duplica a
//      Compra.
//   4. Reprovar um orçamento nunca gera Compra.
//   5. Criar uma Compra direto (sem passar por Orçamento) também
//      atualiza o fornecedor.
//   6. Editar uma Compra trocando o fornecedor atualiza o fornecedor NOVO
//      sem contaminar o cadastro do fornecedor antigo.
//   7. Excluir uma Compra que nasceu de um Orçamento desvincula o
//      `compraId` do orçamento de origem (sem reabrir como "pendente").
//   8. Upload/remoção de arquivo em Orçamentos e em Compras.
//   9. Permissão: quem não tem "brindes" editor/admin visualiza mas não
//      cria (403).
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-brindes-compras-101';
process.env.PORT = '4364';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4364';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-brindes-compras-101-test');
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

  const BASE = 'http://localhost:4364';
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

  // ---------- 1. Orçamento nasce pendente, sem Compra ----------
  const comprasAntesDeNada = db.get('brindesCompras').value().length;
  const orcamento = await fetch(`${BASE}/api/brindes/orcamentos`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ item: 'Caneta Metálica Personalizada', fornecedor: 'Gráfica Teste 101', quemPediu: 'Raquel', quantidade: 10, valorUnitario: 6.5 })
  }).then((r) => r.json()).then((d) => d.item);
  check('[101ª rodada] orçamento criado nasce "pendente"', orcamento.status === 'pendente');
  check('[101ª rodada] orçamento nasce sem compraId', orcamento.compraId === null);
  check('[101ª rodada] criar um orçamento não gera nenhuma Compra', db.get('brindesCompras').value().length === comprasAntesDeNada);
  check('[101ª rodada] fornecedor "Gráfica Teste 101" ainda não existe antes da aprovação', !db.get('fornecedores').find({ nome: 'Gráfica Teste 101' }).value());

  // ---------- 2. Aprovar cria a Compra + atualiza o fornecedor ----------
  const aprovacaoResp = await fetch(`${BASE}/api/brindes/orcamentos/${orcamento.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ status: 'aprovado' })
  }).then((r) => r.json());
  check('[101ª rodada] aprovar devolve a compra criada na resposta', !!aprovacaoResp.compraCriada);
  const compraGerada = aprovacaoResp.compraCriada;
  check('[101ª rodada] compra gerada tem o item/fornecedor/quantidade do orçamento', compraGerada.item === 'Caneta Metálica Personalizada' && compraGerada.fornecedor === 'Gráfica Teste 101' && compraGerada.quantidade === 10);
  check('[101ª rodada] valorTotal calculado = quantidade x valor unitário (10 x 6,5 = 65)', compraGerada.valorTotal === 65);
  check('[101ª rodada] quemAutorizou = quem aprovou (admin)', compraGerada.quemAutorizou === 'Admin Teste');
  check('[101ª rodada] compra guarda origemOrcamentoId', compraGerada.origemOrcamentoId === orcamento.id);
  check('[101ª rodada] Compras ganhou exatamente +1 registro', db.get('brindesCompras').value().length === comprasAntesDeNada + 1);

  const orcamentoAprovado = db.get('brindesOrcamentos').find({ id: orcamento.id }).value();
  check('[101ª rodada] orçamento fica com status "aprovado" e compraId preenchido', orcamentoAprovado.status === 'aprovado' && orcamentoAprovado.compraId === compraGerada.id);

  const fornecedorGrafica = db.get('fornecedores').find({ nome: 'Gráfica Teste 101' }).value();
  check('[101ª rodada] fornecedor "Gráfica Teste 101" foi criado automaticamente', !!fornecedorGrafica);
  check('[101ª rodada] fornecedor nasce autoCreated:true (ainda sem tela própria)', fornecedorGrafica.autoCreated === true);
  check('[101ª rodada] fornecedor ganhou o campo "última compra" com valor/item certos', fornecedorGrafica.ultimaCompra.valor === 65 && fornecedorGrafica.ultimaCompra.item === 'Caneta Metálica Personalizada');

  // ---------- 3. Reaprovar o MESMO orçamento não duplica a Compra ----------
  await fetch(`${BASE}/api/brindes/orcamentos/${orcamento.id}`, { method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ status: 'reprovado' }) });
  await fetch(`${BASE}/api/brindes/orcamentos/${orcamento.id}`, { method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ status: 'aprovado' }) });
  check('[101ª rodada] aprovar de novo (depois de reprovar) não cria uma 2ª Compra', db.get('brindesCompras').value().length === comprasAntesDeNada + 1);

  // ---------- 4. Reprovar nunca gera Compra ----------
  const orcamento2 = await fetch(`${BASE}/api/brindes/orcamentos`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ item: 'Sacola Kraft Grande', fornecedor: 'Gráfica Teste 101', quemPediu: 'Raquel', quantidade: 500, valorUnitario: 1.2 })
  }).then((r) => r.json()).then((d) => d.item);
  const comprasAntesDoReprovado = db.get('brindesCompras').value().length;
  await fetch(`${BASE}/api/brindes/orcamentos/${orcamento2.id}`, { method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ status: 'reprovado' }) });
  const orcamento2Reprovado = db.get('brindesOrcamentos').find({ id: orcamento2.id }).value();
  check('[101ª rodada] reprovar um orçamento nunca cria Compra', db.get('brindesCompras').value().length === comprasAntesDoReprovado);
  check('[101ª rodada] orçamento reprovado continua sem compraId', orcamento2Reprovado.compraId === null);

  // ---------- 5. Criar Compra direto (sem orçamento) também atualiza o fornecedor ----------
  const compraDireta = await fetch(`${BASE}/api/brindes/compras`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ item: 'Boné GhelPlus', fornecedor: 'Bonés & Cia Teste', quantidade: 100, valorUnitario: 14.09, quemPediu: 'Raquel', formaPagamento: 'Boleto', dataCompra: '2026-10-22' })
  }).then((r) => r.json()).then((d) => d.item);
  check('[101ª rodada] compra criada direto (sem orçamento) não tem origemOrcamentoId', compraDireta.origemOrcamentoId === null);
  const fornecedorBones = db.get('fornecedores').find({ nome: 'Bonés & Cia Teste' }).value();
  check('[101ª rodada] compra direta também cria/atualiza o fornecedor', !!fornecedorBones && fornecedorBones.ultimaCompra.item === 'Boné GhelPlus');

  // ---------- 6. Editar Compra trocando o fornecedor não contamina o antigo ----------
  await fetch(`${BASE}/api/brindes/compras/${compraDireta.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ fornecedor: 'Bonés Novo Fornecedor Teste' })
  });
  const fornecedorBonesAntigo = db.get('fornecedores').find({ nome: 'Bonés & Cia Teste' }).value();
  const fornecedorBonesNovo = db.get('fornecedores').find({ nome: 'Bonés Novo Fornecedor Teste' }).value();
  check('[101ª rodada] trocar o fornecedor da compra cria o cadastro do fornecedor novo', !!fornecedorBonesNovo && fornecedorBonesNovo.ultimaCompra.item === 'Boné GhelPlus');
  check('[101ª rodada] o fornecedor antigo continua existindo, sem ser apagado', !!fornecedorBonesAntigo);

  // ---------- 7. Excluir Compra vinda de Orçamento desvincula (sem reabrir) ----------
  await fetch(`${BASE}/api/brindes/compras/${compraGerada.id}`, { method: 'DELETE', headers: hj(adminToken) });
  const orcamentoDepoisDeExcluirCompra = db.get('brindesOrcamentos').find({ id: orcamento.id }).value();
  check('[101ª rodada] excluir a compra desvincula o compraId do orçamento de origem', orcamentoDepoisDeExcluirCompra.compraId === null);
  check('[101ª rodada] excluir a compra NÃO reabre o orçamento como pendente', orcamentoDepoisDeExcluirCompra.status === 'aprovado');

  // ---------- 8. Upload/remoção de arquivo (Orçamentos e Compras) ----------
  const FormData = globalThis.FormData;
  const formOrc = new FormData();
  formOrc.append('files', new Blob(['cotacao pdf'], { type: 'text/plain' }), 'cotacao.txt');
  const orcamentoComArquivo = await fetch(`${BASE}/api/brindes/orcamentos/${orcamento2.id}/arquivos`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: formOrc
  }).then((r) => r.json()).then((d) => d.item);
  check('[101ª rodada] anexar arquivo no orçamento', orcamentoComArquivo.arquivos.length === 1 && orcamentoComArquivo.arquivos[0].name === 'cotacao.txt');
  await fetch(`${BASE}/api/brindes/orcamentos/${orcamento2.id}/arquivos/${orcamentoComArquivo.arquivos[0].id}`, { method: 'DELETE', headers: hj(adminToken) });
  const orcamentoSemArquivo = db.get('brindesOrcamentos').find({ id: orcamento2.id }).value();
  check('[101ª rodada] remover arquivo do orçamento', orcamentoSemArquivo.arquivos.length === 0);

  const formCompra = new FormData();
  formCompra.append('files', new Blob(['nota fiscal'], { type: 'text/plain' }), 'nota-fiscal.txt');
  const compraComArquivo = await fetch(`${BASE}/api/brindes/compras/${compraDireta.id}/arquivos`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: formCompra
  }).then((r) => r.json()).then((d) => d.item);
  check('[101ª rodada] anexar arquivo na compra', compraComArquivo.arquivos.length === 1 && compraComArquivo.arquivos[0].name === 'nota-fiscal.txt');
  await fetch(`${BASE}/api/brindes/compras/${compraDireta.id}/arquivos/${compraComArquivo.arquivos[0].id}`, { method: 'DELETE', headers: hj(adminToken) });
  const compraSemArquivo = db.get('brindesCompras').find({ id: compraDireta.id }).value();
  check('[101ª rodada] remover arquivo da compra', compraSemArquivo.arquivos.length === 0);

  // ---------- 9. Permissão ----------
  await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'semBrindes101', password: '123456', name: 'Sem Permissão Brindes' })
  });
  const tokenSemPermissao = await login('semBrindes101', '123456');
  const verOrcamentosOk = await fetch(`${BASE}/api/brindes/orcamentos`, { headers: hj(tokenSemPermissao) });
  check('[101ª rodada] quem não tem permissão de Brindes ainda consegue VER orçamentos', verOrcamentosOk.status === 200);
  const criarOrcamentoBloqueado = await fetch(`${BASE}/api/brindes/orcamentos`, {
    method: 'POST', headers: hj(tokenSemPermissao), body: JSON.stringify({ item: 'Não devia criar' })
  });
  check('[101ª rodada] quem não tem permissão de Brindes NÃO consegue criar orçamento (403)', criarOrcamentoBloqueado.status === 403);
  const criarCompraBloqueada = await fetch(`${BASE}/api/brindes/compras`, {
    method: 'POST', headers: hj(tokenSemPermissao), body: JSON.stringify({ item: 'Não devia criar' })
  });
  check('[101ª rodada] quem não tem permissão de Brindes NÃO consegue criar compra (403)', criarCompraBloqueada.status === 403);

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
