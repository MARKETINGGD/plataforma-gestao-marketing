const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// Aba "Orçamento" — planejado x realizado de marketing, por marca/categoria/mês.
// v1: lançamento manual. Uma próxima rodada pode puxar o "realizado" direto
// das APIs do Tráfego Pago (investimento mensal) e da Ações Sazonais
// (orçamento aprovado x investido), em vez de digitar de novo aqui.

// Fluxos de lançamento fixos (mesma estrutura usada na planilha de orçamento
// anual) — usados como opções da "categoria" de cada lançamento.
const FLUXOS = [
  'Institucional',
  'Ações Sociais',
  'Relacionamento',
  'Immersiones',
  'Redes Sociais',
  'Cenografia',
  'Brindes',
  'PDV',
  'Feiras/Eventos',
  'Showroom',
  'Expositores Padrão',
  'Expositores Especiais',
  'Equipamentos'
];

function accessOf(req) {
  const user = db.get('users').find({ id: req.user.id }).value();
  return user ? (user.permissions || {}).budget || 'none' : 'none';
}

function requireBudgetView(req, res, next) {
  if (accessOf(req) === 'none') return res.status(403).json({ error: 'Você não tem acesso à aba de Orçamento.' });
  next();
}

function requireBudgetEdit(req, res, next) {
  const access = accessOf(req);
  if (access !== 'editor' && access !== 'admin') return res.status(403).json({ error: 'Você não tem permissão para editar o Orçamento.' });
  next();
}

router.get('/meta', requireAuth, requireBudgetView, (req, res) => {
  res.json({ fluxos: FLUXOS });
});

router.get('/', requireAuth, requireBudgetView, (req, res) => {
  const { brand, year } = req.query;
  let entries = db.get('budgetEntries').value();
  if (brand) entries = entries.filter((e) => e.brand === brand);
  if (year) entries = entries.filter((e) => String(e.year) === String(year));
  res.json({ entries });
});

router.post('/', requireAuth, requireBudgetEdit, (req, res) => {
  const { brand, category, year, month, planejado, realizado, notes } = req.body || {};
  if (!brand || !category || !year || !month) {
    return res.status(400).json({ error: 'Preencha marca, categoria, ano e mês.' });
  }
  const entry = {
    id: nanoid(),
    brand,
    category,
    year: Number(year),
    month: Number(month),
    planejado: planejado === '' || planejado === undefined ? null : Number(planejado),
    realizado: realizado === '' || realizado === undefined ? null : Number(realizado),
    notes: notes || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: req.user.username
  };
  db.get('budgetEntries').push(entry).write();
  logAudit({ user: req.user, entityType: 'budgetEntry', entityId: entry.id, entityLabel: `${brand} · ${category} · ${month}/${year}`, action: 'create' });
  res.json({ entry });
});

router.put('/:id', requireAuth, requireBudgetEdit, (req, res) => {
  const existing = db.get('budgetEntries').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  const { brand, category, year, month, planejado, realizado, notes } = req.body || {};
  const updates = {
    updatedAt: new Date().toISOString(),
    updatedBy: req.user.username
  };
  if (brand !== undefined) updates.brand = brand;
  if (category !== undefined) updates.category = category;
  if (year !== undefined) updates.year = Number(year);
  if (month !== undefined) updates.month = Number(month);
  if (planejado !== undefined) updates.planejado = planejado === '' ? null : Number(planejado);
  if (realizado !== undefined) updates.realizado = realizado === '' ? null : Number(realizado);
  if (notes !== undefined) updates.notes = notes;
  db.get('budgetEntries').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'budgetEntry', entityId: existing.id, entityLabel: `${existing.brand} · ${existing.category} · ${existing.month}/${existing.year}`, action: 'update' });
  res.json({ entry: db.get('budgetEntries').find({ id: req.params.id }).value() });
});

router.delete('/:id', requireAuth, requireBudgetEdit, (req, res) => {
  const existing = db.get('budgetEntries').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  db.get('budgetEntries').remove({ id: req.params.id }).write();
  logAudit({ user: req.user, entityType: 'budgetEntry', entityId: existing.id, entityLabel: `${existing.brand} · ${existing.category} · ${existing.month}/${existing.year}`, action: 'delete' });
  res.json({ ok: true });
});

module.exports = router;
