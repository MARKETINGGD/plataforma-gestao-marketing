const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const fornecedoresHelper = require('../utils/fornecedoresHelper');

const router = express.Router();

// Fornecedores (102ª rodada) -- pedido da Raquel: "Criar menu
// Fornecedores com: campo Tipo (lista aberta, pode cadastrar novos
// tipos -- ex. brindes, expositores), campos completos de cadastro,
// filtros de busca (nome, tipo), e seção 'últimos pedidos feitos' que
// agrega automaticamente de QUALQUER lugar do sistema que tenha fluxo
// de orçamento->pedido (Brindes Compras é o primeiro; deixar
// extensível para outros módulos que vierem a ter esse fluxo)."
//
// A coleção `fornecedores` já existia desde a 100ª rodada (reservada
// pra esse menu) e já vinha sendo alimentada automaticamente desde a
// 101ª rodada por `utils/fornecedoresHelper.js`, toda vez que uma
// Compra de Brindes nasce (direto ou por um Orçamento aprovado) -- essa
// tela é a 1ª a LER e EDITAR de verdade esses mesmos registros, sem
// precisar de nenhuma migração.
//
// Acesso: qualquer pessoa logada pode VER; só quem tem permissão
// "fornecedores" = editor/admin (ou é admin da plataforma) pode criar/
// editar/excluir -- permissão já reservada desde a 100ª rodada em
// routes/auth.js, configurável em Usuários → Permissões.
function canEdit(req) {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  const access = (user.permissions || {}).fornecedores || 'none';
  return access === 'editor' || access === 'admin';
}
function requireFornecedoresEdit(req, res, next) {
  if (!canEdit(req)) return res.status(403).json({ error: 'Você não tem permissão para editar Fornecedores.' });
  next();
}

function str(v) { return (v || '').toString().trim(); }

function serializeFornecedor(f) {
  return Object.assign({}, f, { ultimaCompra: f.ultimaCompra || null });
}

router.get('/', requireAuth, (req, res) => {
  const { nome, tipo } = req.query;
  let rows = db.get('fornecedores').value();
  if (nome) {
    const alvo = nome.toLowerCase();
    rows = rows.filter((f) => (f.nome || '').toLowerCase().includes(alvo));
  }
  if (tipo) {
    const alvo = tipo.toLowerCase();
    rows = rows.filter((f) => (f.tipo || '').toLowerCase() === alvo);
  }
  rows = rows.slice().sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  // Lista de tipos já usados em algum cadastro -- alimenta o campo
  // "Tipo" (lista aberta: sugere os já usados, mas aceita digitar um
  // novo) e o filtro por tipo na tela.
  const tiposUsados = Array.from(new Set(db.get('fornecedores').value().map((f) => f.tipo).filter(Boolean))).sort();
  res.json({ canEdit: canEdit(req), items: rows.map(serializeFornecedor), tiposUsados });
});

router.get('/:id/pedidos', requireAuth, (req, res) => {
  const fornecedor = db.get('fornecedores').find({ id: req.params.id }).value();
  if (!fornecedor) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
  res.json({ pedidos: fornecedoresHelper.pedidosDoFornecedor(fornecedor.nome) });
});

router.post('/', requireAuth, requireFornecedoresEdit, (req, res) => {
  const b = req.body || {};
  const nome = str(b.nome);
  if (!nome) return res.status(400).json({ error: 'Informe o nome do fornecedor.' });
  const jaExiste = fornecedoresHelper.findFornecedorByNome(nome);
  if (jaExiste) {
    return res.status(400).json({ error: `Já existe um fornecedor cadastrado com o nome "${jaExiste.nome}" -- edite o cadastro existente em vez de criar um novo.` });
  }
  const now = new Date().toISOString();
  const fornecedor = {
    id: nanoid(),
    nome,
    tipo: str(b.tipo) || null,
    contato: str(b.contato),
    telefone: str(b.telefone),
    email: str(b.email),
    endereco: str(b.endereco),
    cnpj: str(b.cnpj),
    observacoes: str(b.observacoes),
    ultimaCompra: null,
    autoCreated: false,
    createdAt: now,
    createdBy: req.user.id,
    createdByName: req.user.name,
    updatedAt: now
  };
  db.get('fornecedores').push(fornecedor).write();
  logAudit({ user: req.user, entityType: 'fornecedor', entityId: fornecedor.id, entityLabel: fornecedor.nome, action: 'create' });
  res.json({ item: serializeFornecedor(fornecedor) });
});

router.put('/:id', requireAuth, requireFornecedoresEdit, (req, res) => {
  const existing = db.get('fornecedores').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
  const b = req.body || {};
  const updates = { updatedAt: new Date().toISOString(), updatedBy: req.user.id, updatedByName: req.user.name };
  if (b.nome !== undefined) {
    const novoNome = str(b.nome);
    if (!novoNome) return res.status(400).json({ error: 'Informe o nome do fornecedor.' });
    const outro = fornecedoresHelper.findFornecedorByNome(novoNome);
    if (outro && outro.id !== existing.id) {
      return res.status(400).json({ error: `Já existe outro fornecedor cadastrado com o nome "${outro.nome}".` });
    }
    updates.nome = novoNome;
  }
  ['tipo', 'contato', 'telefone', 'email', 'endereco', 'cnpj', 'observacoes'].forEach((k) => {
    if (b[k] !== undefined) updates[k] = str(b[k]) || (k === 'tipo' ? null : '');
  });
  // Nascer de uma compra automática ("autoCreated") é só pra identificar
  // que esse cadastro ainda não passou por aqui -- a primeira edição
  // manual feita nesta tela "confirma" o cadastro (deixa de ser
  // autoCreated), pra não ficar marcado como provisório pra sempre.
  updates.autoCreated = false;
  db.get('fornecedores').find({ id: req.params.id }).assign(updates).write();
  // Correção (auditoria): fornecedor é referenciado por NOME em texto livre
  // (brindesCompras.fornecedor/brindesOrcamentos.fornecedor), não por id --
  // renomear sem atualizar esses registros antigos fazia `pedidosDoFornecedor`
  // parar de achar o histórico anterior ao rename. Cascata simples: todo
  // registro que ainda tinha o nome ANTIGO passa a ter o nome NOVO.
  if (updates.nome && updates.nome.toLowerCase() !== (existing.nome || '').toLowerCase()) {
    fornecedoresHelper.renameFornecedorInRegistros(existing.nome, updates.nome);
  }
  logAudit({ user: req.user, entityType: 'fornecedor', entityId: existing.id, entityLabel: updates.nome || existing.nome, action: 'update' });
  res.json({ item: serializeFornecedor(db.get('fornecedores').find({ id: req.params.id }).value()) });
});

router.delete('/:id', requireAuth, requireFornecedoresEdit, (req, res) => {
  const existing = db.get('fornecedores').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
  db.get('fornecedores').remove({ id: req.params.id }).write();
  logAudit({ user: req.user, entityType: 'fornecedor', entityId: existing.id, entityLabel: existing.nome, action: 'delete' });
  res.json({ ok: true });
});

module.exports = router;
