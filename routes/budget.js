const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { resolveUserName } = require('../utils/names');
const { notifyAcoesSazonais } = require('../utils/acoesSazonaisSync');

const router = express.Router();

// Aba "Orçamento" — planejado x realizado de marketing, por marca/categoria/mês.
// v1: lançamento manual. Uma próxima rodada pode puxar o "realizado" direto
// das APIs do Tráfego Pago (investimento mensal) e da Ações Sazonais
// (orçamento aprovado x investido), em vez de digitar de novo aqui.

// Fluxos de lançamento fixos (mesma estrutura usada na planilha de orçamento
// anual) — usados como opções da "categoria" de cada lançamento.
// Lista genérica (usada por De Bacco e qualquer marca sem lista própria).
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

// Lista da GhelPlus (23ª rodada) — nome + número do fluxo, exatamente como na
// planilha oficial de orçamento ("2026- BUDGET GHELPLUS.xlsx", abas
// PLANEJADO 2026/REALIZADO 2026). "Immersiones" não existe nessa planilha
// (não é usado pela GhelPlus); "Promoções" é novo (existe na planilha, mas
// sem nenhum lançamento em 2026 ainda).
const FLUXOS_GHELPLUS = [
  'Institucional - 2.5.2.3',
  'Ações Sociais - 2.5.2.4',
  'Relacionamento - 2.5.2.21',
  'Redes Sociais - 2.5.2.5',
  'Cenografia - 2.5.2.6',
  'Brindes - 2.5.2.8',
  'PDV - 2.5.2.12',
  'Feiras e Eventos - 2.5.2.22',
  'Showroom - 2.5.2.13',
  'Expositores Padrão - 2.5.2.14',
  'Expositores Especiais - 2.5.2.20',
  'Equipamentos - 1.2.5.1',
  'Promoções - 2.5.23'
];

// Lista da De Bacco (24ª rodada, +"Showroom" na 25ª) — mesmo esquema nome +
// número do fluxo, vindo da planilha oficial ("2026 - BUDGET DE BACCO",
// abas PLANEJADO 2026/REALIZADO 2026). Diferente da GhelPlus, a De Bacco
// usa "Immersiones" (é a marca que originou esse fluxo) e não tem
// "Promoções". "Showroom" (2.5.3.13) foi adicionado na 25ª rodada — ao
// reimportar a planilha linha a linha, apareceu um fluxo Showroom que a
// importação da 24ª rodada (que só somava totais) não tinha capturado.
const FLUXOS_DEBACCO = [
  'Institucional - 2.5.3.3',
  'Ações Sociais - 2.5.3.4',
  'Relacionamento - 2.5.3.22',
  'Immersiones - 2.5.3.2',
  'Redes Sociais - 2.5.3.5',
  'Cenografia - 2.5.3.6',
  'Brindes - 2.5.3.8',
  'PDV - 2.5.3.12',
  'Feiras/Eventos - 2.5.3.1',
  'Showroom - 2.5.3.13',
  'Expositores Padrão - 2.5.3.14',
  'Expositores Especiais - 2.5.3.21',
  'Equipamentos - 1.2.6.1'
];

const FLUXOS_BY_BRAND = { ghelplus: FLUXOS_GHELPLUS, debacco: FLUXOS_DEBACCO };

function accessOf(req) {
  const user = db.get('users').find({ id: req.user.id }).value();
  return user ? (user.permissions || {}).budget || 'none' : 'none';
}

// Usado por routes/feiras.js (41ª rodada) — só permite acesso a quem já tem
// permissão de "budget", já que uma feira é sempre lançada dentro de um
// fluxo do orçamento. Fica aqui pra não duplicar a checagem de permissão.
function hasBudgetEdit(req) {
  const access = accessOf(req);
  return access === 'editor' || access === 'admin';
}
function hasBudgetView(req) {
  return accessOf(req) !== 'none';
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
  const { brand } = req.query;
  res.json({ fluxos: (brand && FLUXOS_BY_BRAND[brand]) || FLUXOS });
});

router.get('/', requireAuth, requireBudgetView, (req, res) => {
  const { brand, year } = req.query;
  let entries = db.get('budgetEntries').value();
  if (brand) entries = entries.filter((e) => e.brand === brand);
  if (year) entries = entries.filter((e) => String(e.year) === String(year));
  // Nome resolvido ao vivo (20ª rodada) — ver utils/names.js.
  entries = entries.map((e) => Object.assign({}, e, { updatedBy: resolveUserName(e.updatedById, e.updatedBy) }));
  res.json({ entries });
});

router.post('/', requireAuth, requireBudgetEdit, (req, res) => {
  const { brand, category, year, month, planejado, realizado, notes, fornecedor, tituloCompra, quantidade } = req.body || {};
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
    fornecedor: fornecedor || '',
    tituloCompra: tituloCompra || '',
    quantidade: quantidade === '' || quantidade === undefined ? null : Number(quantidade),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: req.user.name,
    updatedById: req.user.id
  };
  db.get('budgetEntries').push(entry).write();
  logAudit({ user: req.user, entityType: 'budgetEntry', entityId: entry.id, entityLabel: `${brand} · ${category} · ${month}/${year}`, action: 'create' });
  // 41ª rodada, pedido da Raquel: "ao criar uma feira, showroom especial
  // dentro do budget, se ele ainda não existir no dash, ele deve ser
  // criado" — só dispara pra lançamento no fluxo de Showroom, com título
  // da compra preenchido (usado como nome do lojista lá). Dedup por
  // sourcePlataformaBudgetEntryId (ver routes/integrations.js do dashboard
  // de Ações Sazonais). Best-effort, nunca falha o lançamento aqui.
  if (entry.category.toLowerCase().startsWith('showroom') && entry.tituloCompra) {
    notifyAcoesSazonais('sync-showroom', { brand: entry.brand, lojista: entry.tituloCompra, sourceBudgetEntryId: entry.id });
  }
  res.json({ entry });
});

router.put('/:id', requireAuth, requireBudgetEdit, (req, res) => {
  const existing = db.get('budgetEntries').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  const { brand, category, year, month, planejado, realizado, notes, fornecedor, tituloCompra, quantidade } = req.body || {};
  const updates = {
    updatedAt: new Date().toISOString(),
    updatedBy: req.user.name,
    updatedById: req.user.id
  };
  if (brand !== undefined) updates.brand = brand;
  if (category !== undefined) updates.category = category;
  if (year !== undefined) updates.year = Number(year);
  if (month !== undefined) updates.month = Number(month);
  if (planejado !== undefined) updates.planejado = planejado === '' ? null : Number(planejado);
  if (realizado !== undefined) updates.realizado = realizado === '' ? null : Number(realizado);
  if (notes !== undefined) updates.notes = notes;
  if (fornecedor !== undefined) updates.fornecedor = fornecedor;
  if (tituloCompra !== undefined) updates.tituloCompra = tituloCompra;
  if (quantidade !== undefined) updates.quantidade = quantidade === '' ? null : Number(quantidade);
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

// Exportado como propriedade do router (41ª rodada) pra routes/feiras.js
// reaproveitar exatamente os mesmos fluxos e a mesma checagem de permissão
// "budget" sem duplicar a lista (evita as duas listas ficarem
// desatualizadas uma em relação à outra).
router.FLUXOS_BY_BRAND = FLUXOS_BY_BRAND;
router.hasBudgetEdit = hasBudgetEdit;
router.hasBudgetView = hasBudgetView;

module.exports = router;
