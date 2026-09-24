const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { resolveUserName } = require('../utils/names');
const budgetRouter = require('./budget');
const { notifyAcoesSazonais } = require('../utils/acoesSazonaisSync');
const shareLinks = require('../utils/shareLinks');

const router = express.Router();

// Módulo "Feiras" (41ª rodada, pedido da Raquel): cada feira (ex.: FEICON,
// ExpoRevestir) tem uma edição por ano, marca e fluxo — reaproveitando
// exatamente os mesmos fluxos (nome + número) já usados no Budget
// (routes/budget.js) — e uma lista de itens (nome, quantidade, fornecedor,
// valor mês a mês), igual à planilha oficial de cada feira.
//
// Sincronia com o Budget (pedido explícito da Raquel: "tudo que for
// lançado, a partir de agora nas planilhas de feiras, deve automaticamente
// ser criado também em budget"): todo item criado ou editado numa feira
// gera/atualiza lançamentos em `budgetEntries` (routes/budget.js), um por
// mês com valor preenchido, na categoria = fluxo da feira. Os itens
// IMPORTADOS do histórico (2025/2026, seed — ver
// utils/seedFeirasGhelplus2025_2026.js) são a exceção: como a Raquel
// confirmou que 2025 e 2026 já estão lançados no Budget (vindos da
// importação granular da planilha oficial), eles entram com
// `origem: 'import'` e NÃO geram lançamento novo — só os itens
// cadastrados/editados pela tela, dali pra frente.
//
// Mesma permissão do Budget (uma feira só existe dentro de um fluxo do
// orçamento, então quem pode ver/editar o Budget pode ver/editar Feiras).
const { FLUXOS_BY_BRAND, hasBudgetEdit, hasBudgetView } = budgetRouter;

const BRANDS = ['debacco', 'ghelplus'];

function requireFeirasView(req, res, next) {
  if (!hasBudgetView(req)) return res.status(403).json({ error: 'Você não tem acesso a Feiras.' });
  next();
}
function requireFeirasEdit(req, res, next) {
  if (!hasBudgetEdit(req)) return res.status(403).json({ error: 'Você não tem permissão para editar Feiras.' });
  next();
}

function validBrand(b) {
  return BRANDS.includes(b) ? b : BRANDS[0];
}
function str(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
// 12 posições, Janeiro (índice 0) a Dezembro (índice 11) — mesmo formato
// usado pra exibir/editar valor mês a mês em outras telas do app.
function sanitizeValores(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (let i = 0; i < 12; i++) out.push(numOrNull(arr[i]));
  return out;
}
function sanitizeItem(body, existing) {
  const it = existing ? { ...existing } : { id: nanoid(), origem: 'manual', budgetEntryIds: [] };
  if (body.nome !== undefined) it.nome = str(body.nome);
  if (body.quantidade !== undefined) it.quantidade = numOrNull(body.quantidade);
  if (body.fornecedor !== undefined) it.fornecedor = str(body.fornecedor);
  if (body.observacoes !== undefined) it.observacoes = str(body.observacoes);
  if (body.valores !== undefined) it.valores = sanitizeValores(body.valores);
  if (!it.valores) it.valores = sanitizeValores([]);
  it.total = it.valores.reduce((s, v) => s + (v || 0), 0);
  return it;
}

function fluxoValido(brand, fluxo) {
  const lista = FLUXOS_BY_BRAND[brand] || [];
  return lista.includes(fluxo) ? fluxo : (lista[0] || '');
}

// ---------- Sincronia com o Budget (budgetEntries) ----------
// Sempre substitui os lançamentos antigos do item pelos novos (mais simples
// e seguro do que tentar "diferenciar" mês a mês — o item de uma feira
// nunca deveria ter uma quantidade grande de meses, então recriar tudo tem
// custo desprezível).
function removeBudgetEntriesForItem(item) {
  (item.budgetEntryIds || []).forEach((id) => {
    db.get('budgetEntries').remove({ id }).write();
  });
}
function createBudgetEntriesForItem(feira, item, req) {
  const now = new Date().toISOString();
  const ids = [];
  (item.valores || []).forEach((valor, idx) => {
    if (valor === null || valor === undefined || valor === 0) return;
    const entry = {
      id: nanoid(),
      brand: feira.brand,
      category: feira.fluxo,
      year: feira.ano,
      month: idx + 1,
      planejado: valor,
      realizado: null,
      notes: `Lançado automaticamente pela feira "${feira.nome} ${feira.ano}".`,
      fornecedor: item.fornecedor || '',
      tituloCompra: item.nome || '',
      quantidade: item.quantidade,
      sourceFeiraId: feira.id,
      sourceFeiraItemId: item.id,
      createdAt: now,
      updatedAt: now,
      updatedBy: req.user.name,
      updatedById: req.user.id
    };
    db.get('budgetEntries').push(entry).write();
    ids.push(entry.id);
  });
  return ids;
}
function syncItemToBudget(feira, item, req) {
  removeBudgetEntriesForItem(item);
  item.budgetEntryIds = createBudgetEntriesForItem(feira, item, req);
}

function serializeFeira(f) {
  return Object.assign({}, f, { updatedBy: resolveUserName(f.updatedById, f.updatedBy) });
}

router.get('/meta', requireAuth, requireFeirasView, (req, res) => {
  const { brand } = req.query;
  res.json({ fluxos: (brand && FLUXOS_BY_BRAND[brand]) || [] });
});

router.get('/', requireAuth, requireFeirasView, (req, res) => {
  const { brand, ano } = req.query;
  let list = db.get('feiras').value();
  if (brand) list = list.filter((f) => f.brand === brand);
  if (ano) list = list.filter((f) => String(f.ano) === String(ano));
  res.json({ feiras: list.map(serializeFeira) });
});

// ---------- link externo (66ª rodada, "Rodada H" da Pendência 51) ----------
// Um link por marca -- só "leitura" por enquanto (ver utils/shareLinks.js).
// Mesmas 3 chaves já usadas na tela ('todos'/'debacco'/'ghelplus').
// **Precisa ficar ANTES de "GET /:id" abaixo** -- senão "/public-link"
// seria capturado por "/:id" (com id="public-link") primeiro, já que o
// Express tenta as rotas na ordem em que foram registradas (mesmo bug
// real encontrado e corrigido em routes/budget.js nesta mesma rodada).
function validFeirasShareKey(k) {
  return ['todos', 'debacco', 'ghelplus'].includes(k) ? k : 'todos';
}
router.get('/public/:token', (req, res) => {
  const link = shareLinks.findByToken(req.params.token);
  if (!link || link.resource !== 'feiras') return res.status(404).json({ error: 'Link inválido ou desativado.' });
  let list = db.get('feiras').value();
  if (link.scopeKey !== 'todos') list = list.filter((f) => f.brand === link.scopeKey);
  res.json({ scope: link.scopeKey, feiras: list.map(serializeFeira) });
});
router.get('/public-link', requireAuth, requireFeirasEdit, (req, res) => {
  const key = validFeirasShareKey(req.query.key);
  const link = shareLinks.getLink('feiras', key);
  res.json({ publicToken: link ? link.token : null });
});
router.post('/public-link/generate', requireAuth, requireFeirasEdit, (req, res) => {
  const key = validFeirasShareKey((req.body || {}).key);
  const token = shareLinks.generateLink('feiras', key, req);
  logAudit({ user: req.user, entityType: 'shareLink', entityId: 'feiras:' + key, entityLabel: 'Feiras · ' + key, action: 'generate_public_link' });
  res.json({ publicToken: token });
});
router.delete('/public-link', requireAuth, requireFeirasEdit, (req, res) => {
  const key = validFeirasShareKey(req.query.key);
  shareLinks.revokeLink('feiras', key);
  logAudit({ user: req.user, entityType: 'shareLink', entityId: 'feiras:' + key, entityLabel: 'Feiras · ' + key, action: 'revoke_public_link' });
  res.json({ ok: true });
});

router.get('/:id', requireAuth, requireFeirasView, (req, res) => {
  const feira = db.get('feiras').find({ id: req.params.id }).value();
  if (!feira) return res.status(404).json({ error: 'Feira não encontrada.' });
  res.json({ feira: serializeFeira(feira) });
});

router.post('/', requireAuth, requireFeirasEdit, (req, res) => {
  const { brand, nome, ano, fluxo } = req.body || {};
  const nomeTrim = str(nome);
  if (!nomeTrim) return res.status(400).json({ error: 'Informe o nome da feira.' });
  const anoNum = parseInt(ano, 10);
  if (!anoNum) return res.status(400).json({ error: 'Informe o ano da feira.' });
  const brandValid = validBrand(brand);
  const now = new Date().toISOString();
  const feira = {
    id: nanoid(),
    brand: brandValid,
    nome: nomeTrim,
    ano: anoNum,
    fluxo: fluxoValido(brandValid, fluxo),
    itens: [],
    importBatch: null,
    createdAt: now,
    updatedAt: now,
    updatedBy: req.user.name,
    updatedById: req.user.id
  };
  db.get('feiras').push(feira).write();
  logAudit({ user: req.user, entityType: 'feira', entityId: feira.id, entityLabel: `${feira.nome} ${feira.ano}`, action: 'create', details: `Feira criada: "${feira.nome} ${feira.ano}" (${feira.fluxo})` });
  // 41ª rodada: se a feira ainda não existir como Ação ("Nova Feira") no
  // dashboard de Ações Sazonais, cria lá também — dedup por
  // sourcePlataformaFeiraId (ver routes/integrations.js de lá). Best-effort
  // (nunca falha a criação da feira aqui se o outro serviço não responder).
  notifyAcoesSazonais('sync-feira', { brand: feira.brand, nome: feira.nome, ano: feira.ano, sourceFeiraId: feira.id });
  res.json({ feira: serializeFeira(feira) });
});

router.put('/:id', requireAuth, requireFeirasEdit, (req, res) => {
  const existing = db.get('feiras').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Feira não encontrada.' });
  const { brand, nome, ano, fluxo } = req.body || {};
  const updates = { updatedAt: new Date().toISOString(), updatedBy: req.user.name, updatedById: req.user.id };
  if (brand !== undefined) updates.brand = validBrand(brand);
  if (nome !== undefined) updates.nome = str(nome);
  if (ano !== undefined) { const n = parseInt(ano, 10); if (n) updates.ano = n; }
  const brandFinal = updates.brand || existing.brand;
  if (fluxo !== undefined) updates.fluxo = fluxoValido(brandFinal, fluxo);
  db.get('feiras').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'feira', entityId: existing.id, entityLabel: `${updates.nome || existing.nome} ${updates.ano || existing.ano}`, action: 'update', details: 'Feira atualizada' });
  res.json({ feira: serializeFeira(db.get('feiras').find({ id: req.params.id }).value()) });
});

router.delete('/:id', requireAuth, requireFeirasEdit, (req, res) => {
  const existing = db.get('feiras').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Feira não encontrada.' });
  (existing.itens || []).forEach((it) => removeBudgetEntriesForItem(it));
  db.get('feiras').remove({ id: req.params.id }).write();
  logAudit({ user: req.user, entityType: 'feira', entityId: existing.id, entityLabel: `${existing.nome} ${existing.ano}`, action: 'delete', details: `Feira excluída: "${existing.nome} ${existing.ano}"` });
  res.json({ ok: true });
});

// ---------- Itens da feira ----------
router.post('/:id/itens', requireAuth, requireFeirasEdit, (req, res) => {
  const feira = db.get('feiras').find({ id: req.params.id }).value();
  if (!feira) return res.status(404).json({ error: 'Feira não encontrada.' });
  const nome = str((req.body || {}).nome);
  if (!nome) return res.status(400).json({ error: 'Informe o nome do item.' });
  const item = sanitizeItem(req.body, null);
  syncItemToBudget(feira, item, req);
  const itens = [...(feira.itens || []), item];
  db.get('feiras').find({ id: req.params.id }).assign({ itens, updatedAt: new Date().toISOString(), updatedBy: req.user.name, updatedById: req.user.id }).write();
  logAudit({ user: req.user, entityType: 'feiraItem', entityId: item.id, entityLabel: item.nome, action: 'create', details: `Item lançado em "${feira.nome} ${feira.ano}": "${item.nome}" — criado também no Budget.` });
  res.json({ feira: serializeFeira(db.get('feiras').find({ id: req.params.id }).value()) });
});

router.put('/:id/itens/:itemId', requireAuth, requireFeirasEdit, (req, res) => {
  const feira = db.get('feiras').find({ id: req.params.id }).value();
  if (!feira) return res.status(404).json({ error: 'Feira não encontrada.' });
  const existingItem = (feira.itens || []).find((it) => it.id === req.params.itemId);
  if (!existingItem) return res.status(404).json({ error: 'Item não encontrado.' });
  const item = sanitizeItem(req.body, existingItem);
  // Item importado do histórico continua marcado como "import" (não passa a
  // duplicar em budgetEntries só por ter sido editado) — a menos que ele
  // nunca tenha tido lançamento nenhum (segurança extra, não deveria
  // acontecer no fluxo normal).
  if (item.origem !== 'import' || !item.budgetEntryIds || item.budgetEntryIds.length === 0) {
    syncItemToBudget(feira, item, req);
  } else {
    // Mantém os lançamentos existentes intactos; só atualiza os campos do
    // item (nome/fornecedor/valores) sem recriar o lançamento do Budget.
  }
  const itens = (feira.itens || []).map((it) => (it.id === item.id ? item : it));
  db.get('feiras').find({ id: req.params.id }).assign({ itens, updatedAt: new Date().toISOString(), updatedBy: req.user.name, updatedById: req.user.id }).write();
  logAudit({ user: req.user, entityType: 'feiraItem', entityId: item.id, entityLabel: item.nome, action: 'update', details: `Item de "${feira.nome} ${feira.ano}" atualizado.` });
  res.json({ feira: serializeFeira(db.get('feiras').find({ id: req.params.id }).value()) });
});

router.delete('/:id/itens/:itemId', requireAuth, requireFeirasEdit, (req, res) => {
  const feira = db.get('feiras').find({ id: req.params.id }).value();
  if (!feira) return res.status(404).json({ error: 'Feira não encontrada.' });
  const existingItem = (feira.itens || []).find((it) => it.id === req.params.itemId);
  if (!existingItem) return res.status(404).json({ error: 'Item não encontrado.' });
  removeBudgetEntriesForItem(existingItem);
  const itens = (feira.itens || []).filter((it) => it.id !== req.params.itemId);
  db.get('feiras').find({ id: req.params.id }).assign({ itens, updatedAt: new Date().toISOString(), updatedBy: req.user.name, updatedById: req.user.id }).write();
  logAudit({ user: req.user, entityType: 'feiraItem', entityId: existingItem.id, entityLabel: existingItem.nome, action: 'delete', details: `Item excluído de "${feira.nome} ${feira.ano}": "${existingItem.nome}"` });
  res.json({ feira: serializeFeira(db.get('feiras').find({ id: req.params.id }).value()) });
});

module.exports = router;
