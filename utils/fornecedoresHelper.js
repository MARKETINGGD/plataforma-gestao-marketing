// utils/fornecedoresHelper.js
//
// Helper leve pro cadastro de Fornecedores (coleção `fornecedores`,
// reservada no db.js desde a 100ª rodada) -- usado a partir da 101ª
// rodada por qualquer fluxo "orçamento -> pedido/compra" do sistema (o
// primeiro é Brindes -> Compras, ver routes/brindes.js) pra manter o
// fornecedor em dia com a última compra feita dele, mesmo ANTES de
// existir uma tela própria de Fornecedores (Pendência seguinte, Task
// #84 do plano) -- quando essa tela existir, ela só vai ler/editar os
// mesmos registros que este helper já vem criando/atualizando, sem
// precisar de nenhuma migração.
const db = require('../db');
const { nanoid } = require('./id');

function normalizeNome(nome) {
  return (nome || '').trim();
}

function findFornecedorByNome(nome) {
  const alvo = normalizeNome(nome).toLowerCase();
  if (!alvo) return null;
  return db.get('fornecedores').find((f) => normalizeNome(f.nome).toLowerCase() === alvo).value();
}

// Acha (ou cria, se não existir ainda) o fornecedor pelo NOME -- sem
// diferenciar maiúscula/minúscula nem espaço nas pontas, pra o mesmo
// fornecedor digitado de formas levemente diferentes em 2 compras não
// virar 2 cadastros -- e atualiza o campo "última compra". Quando
// precisa criar o cadastro na hora (porque ainda não existe nenhuma
// tela de Fornecedores pra alguém ter cadastrado antes), nasce com
// `autoCreated: true`, pra a tela de Fornecedores (quando existir)
// identificar que esse registro nasceu de uma compra, não de um
// cadastro manual, e completar os demais campos depois se quiser.
function upsertUltimaCompra(nomeFornecedor, info, extra) {
  const nome = normalizeNome(nomeFornecedor);
  if (!nome) return null;
  const now = new Date().toISOString();
  let forn = findFornecedorByNome(nome);
  if (!forn) {
    forn = {
      id: nanoid(),
      nome,
      tipo: (extra && extra.tipo) || null,
      contato: '',
      telefone: '',
      email: '',
      observacoes: '',
      ultimaCompra: null,
      autoCreated: true,
      createdAt: now,
      updatedAt: now
    };
    db.get('fornecedores').push(forn).write();
  }
  const ultimaCompra = {
    data: (info && info.data) || now.slice(0, 10),
    valor: info && info.valor != null ? Number(info.valor) : null,
    item: (info && info.item) || '',
    origem: (info && info.origem) || null,
    origemId: (info && info.origemId) || null
  };
  db.get('fornecedores').find({ id: forn.id }).assign({ ultimaCompra, updatedAt: now }).write();
  return db.get('fornecedores').find({ id: forn.id }).value();
}

// Pra uso futuro da tela de Fornecedores (Task #84): lista todos os
// "pedidos" feitos a um fornecedor, agregando de qualquer módulo que
// tenha um fluxo orçamento->pedido. Hoje só existe Brindes Compras --
// extensível: cada módulo novo com esse fluxo só precisa somar sua
// própria consulta aqui dentro, sem mudar quem chama esta função.
function pedidosDoFornecedor(nomeFornecedor) {
  const nome = normalizeNome(nomeFornecedor).toLowerCase();
  if (!nome) return [];
  const brindes = db.get('brindesCompras').value()
    .filter((c) => normalizeNome(c.fornecedor).toLowerCase() === nome)
    .map((c) => ({
      origem: 'Brindes · Compras',
      origemId: c.id,
      item: c.item,
      quantidade: c.quantidade,
      valorTotal: c.valorTotal,
      data: c.dataCompra
    }));
  return brindes.slice().sort((a, b) => (b.data || '').localeCompare(a.data || ''));
}

module.exports = { upsertUltimaCompra, findFornecedorByNome, pedidosDoFornecedor };
