const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// Produtos (33ª rodada, pedido da Raquel: "no botão produtos deve ter um sub
// menu com: análise de concorrência, lançamentos de produtos"). Duas listas
// independentes, cada uma dividida por marca (De Bacco / GhelPlus), mesmo
// padrão de acesso já usado em Brindes/Expositores: qualquer pessoa logada
// pode VER, só quem tem permissão "produtos" = editor/admin (ou é admin da
// plataforma) pode criar/editar/excluir — permissão configurada na tela de
// Usuários (a chave 'produtos' já existia em PERMISSION_KEYS antes desta
// rodada, só não tinha nenhuma tela usando ela ainda).

const BRANDS = ['debacco', 'ghelplus'];
const LANCAMENTO_STATUSES = ['planejado', 'em_andamento', 'lancado'];

function canEdit(req) {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  const access = (user.permissions || {}).produtos || 'none';
  return access === 'editor' || access === 'admin';
}
function requireProdutosEdit(req, res, next) {
  if (!canEdit(req)) return res.status(403).json({ error: 'Você não tem permissão para editar Produtos.' });
  next();
}
function validBrand(b) {
  return BRANDS.includes(b) ? b : BRANDS[0];
}

// ---------- Análise de concorrência ----------
router.get('/concorrencia', requireAuth, (req, res) => {
  res.json({ items: db.get('concorrencia').value() });
});

router.post('/concorrencia', requireAuth, requireProdutosEdit, (req, res) => {
  const { brand, concorrente, produto, preco, link, observacoes } = req.body || {};
  const nome = (concorrente || '').trim();
  if (!nome) return res.status(400).json({ error: 'Informe o nome do concorrente.' });
  const item = {
    id: nanoid(),
    brand: validBrand(brand),
    concorrente: nome,
    produto: (produto || '').trim(),
    preco: preco === null || preco === undefined || preco === '' ? null : Number(preco),
    link: (link || '').trim() || null,
    observacoes: (observacoes || '').trim(),
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    updatedAt: new Date().toISOString()
  };
  db.get('concorrencia').push(item).write();
  logAudit({ user: req.user, entityType: 'concorrencia', entityId: item.id, entityLabel: item.concorrente, action: 'create', details: `Análise de concorrência criada: "${item.concorrente}"` });
  res.json({ item });
});

router.put('/concorrencia/:id', requireAuth, requireProdutosEdit, (req, res) => {
  const existing = db.get('concorrencia').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Registro não encontrado.' });
  const { brand, concorrente, produto, preco, link, observacoes } = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  if (brand !== undefined) updates.brand = validBrand(brand);
  if (concorrente !== undefined) updates.concorrente = String(concorrente).trim();
  if (produto !== undefined) updates.produto = String(produto).trim();
  if (preco !== undefined) updates.preco = preco === null || preco === '' ? null : Number(preco);
  if (link !== undefined) updates.link = (link || '').trim() || null;
  if (observacoes !== undefined) updates.observacoes = String(observacoes).trim();
  db.get('concorrencia').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'concorrencia', entityId: existing.id, entityLabel: updates.concorrente || existing.concorrente, action: 'update', details: 'Análise de concorrência atualizada' });
  res.json({ item: db.get('concorrencia').find({ id: req.params.id }).value() });
});

router.delete('/concorrencia/:id', requireAuth, requireProdutosEdit, (req, res) => {
  const target = db.get('concorrencia').find({ id: req.params.id }).value();
  db.get('concorrencia').remove({ id: req.params.id }).write();
  if (target) logAudit({ user: req.user, entityType: 'concorrencia', entityId: target.id, entityLabel: target.concorrente, action: 'delete', details: `Análise de concorrência excluída: "${target.concorrente}"` });
  res.json({ ok: true });
});

// ---------- Lançamentos de produtos ----------
router.get('/lancamentos', requireAuth, (req, res) => {
  res.json({ items: db.get('lancamentosProdutos').value() });
});

router.post('/lancamentos', requireAuth, requireProdutosEdit, (req, res) => {
  const { brand, nome, dataLancamento, status, descricao } = req.body || {};
  const nomeTrim = (nome || '').trim();
  if (!nomeTrim) return res.status(400).json({ error: 'Informe o nome do produto.' });
  const item = {
    id: nanoid(),
    brand: validBrand(brand),
    nome: nomeTrim,
    dataLancamento: dataLancamento || null,
    status: LANCAMENTO_STATUSES.includes(status) ? status : 'planejado',
    descricao: (descricao || '').trim(),
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    updatedAt: new Date().toISOString()
  };
  db.get('lancamentosProdutos').push(item).write();
  logAudit({ user: req.user, entityType: 'lancamentoProduto', entityId: item.id, entityLabel: item.nome, action: 'create', details: `Lançamento de produto criado: "${item.nome}"` });
  res.json({ item });
});

router.put('/lancamentos/:id', requireAuth, requireProdutosEdit, (req, res) => {
  const existing = db.get('lancamentosProdutos').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  const { brand, nome, dataLancamento, status, descricao } = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  if (brand !== undefined) updates.brand = validBrand(brand);
  if (nome !== undefined) updates.nome = String(nome).trim();
  if (dataLancamento !== undefined) updates.dataLancamento = dataLancamento || null;
  if (status !== undefined) updates.status = LANCAMENTO_STATUSES.includes(status) ? status : existing.status;
  if (descricao !== undefined) updates.descricao = String(descricao).trim();
  db.get('lancamentosProdutos').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'lancamentoProduto', entityId: existing.id, entityLabel: updates.nome || existing.nome, action: 'update', details: 'Lançamento de produto atualizado' });
  res.json({ item: db.get('lancamentosProdutos').find({ id: req.params.id }).value() });
});

router.delete('/lancamentos/:id', requireAuth, requireProdutosEdit, (req, res) => {
  const target = db.get('lancamentosProdutos').find({ id: req.params.id }).value();
  db.get('lancamentosProdutos').remove({ id: req.params.id }).write();
  if (target) logAudit({ user: req.user, entityType: 'lancamentoProduto', entityId: target.id, entityLabel: target.nome, action: 'delete', details: `Lançamento de produto excluído: "${target.nome}"` });
  res.json({ ok: true });
});

module.exports = router;
