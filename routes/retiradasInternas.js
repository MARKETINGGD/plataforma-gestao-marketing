const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { resolveUserName } = require('../utils/names');

const router = express.Router();

// Retiradas Internas (38ª rodada, pedido da Raquel: "em brindes, adicione
// um sub menu: Controle Geral / Retiradas Internas") — registro de retirada
// INTERNA de brinde ou vinho (alguém da equipe pegou um item pra uso
// próprio/interno). Diferente do "Registro de Saídas" que já existe em
// routes/brindes.js (`/log`), que é pra saída pra representante/cliente —
// aqui não tem representante nem cliente, é só data + produto + quem
// retirou + motivo, como pedido.
//
// Reaproveita o catálogo de Brindes (`brindesCatalog`) como a "lista
// pré-cadastrada" de produtos de cada marca — inclusive pra vinho, que
// vira só mais um item do catálogo com `group: 'Vinhos'` (o campo `group`
// já existe no catálogo desde sempre, só não tinha nenhum grupo assim
// cadastrado ainda). Igual ao Registro de Saídas, isso é só um
// log/histórico — NÃO desconta do estoque do catálogo (mesmo
// comportamento já usado lá, decisão consistente com o que já existe).
//
// Acesso: qualquer pessoa logada pode ver; só quem tem permissão "brindes"
// (editor/admin, ou é admin da plataforma) pode criar/editar/excluir —
// mesma permissão já usada em todo o resto do módulo de Brindes.
function canEdit(req) {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  const access = (user.permissions || {}).brindes || 'none';
  return access === 'editor' || access === 'admin';
}
function requireEdit(req, res, next) {
  if (!canEdit(req)) return res.status(403).json({ error: 'Você não tem permissão para editar Retiradas Internas.' });
  next();
}

const BRANDS = ['debacco', 'ghelplus'];
function validBrand(brand) {
  return BRANDS.includes(brand) ? brand : null;
}

router.get('/', requireAuth, (req, res) => {
  const { brand } = req.query;
  let rows = db.get('retiradasInternas').value();
  if (brand) rows = rows.filter((r) => r.brand === brand);
  rows = rows.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  // Nome de quem retirou resolvido ao vivo (mesmo padrão já usado em todo
  // o resto da Plataforma — ver utils/names.js).
  rows = rows.map((r) => Object.assign({}, r, { withdrawnByName: resolveUserName(r.withdrawnBy, r.withdrawnByName) }));
  res.json({ items: rows });
});

router.post('/', requireAuth, requireEdit, (req, res) => {
  const { brand, date, item, group, catalogItemId, withdrawnBy, motivo } = req.body || {};
  const finalBrand = validBrand(brand);
  if (!finalBrand) return res.status(400).json({ error: 'Escolha a marca.' });
  if (!item || !item.trim()) return res.status(400).json({ error: 'Escolha ou cadastre o produto retirado.' });
  const withdrawnUser = db.get('users').find({ id: withdrawnBy }).value();
  if (!withdrawnUser) return res.status(400).json({ error: 'Escolha quem retirou.' });

  // Produto novo (não estava na lista pré-cadastrada) — cadastra também no
  // catálogo geral de Brindes, pra já aparecer em "Controle Geral" e nas
  // próximas retiradas dessa marca (pedido da Raquel: "além da opção de
  // cadastrar novos"). Vinho entra por aqui também, com group: 'Vinhos'.
  let finalCatalogItemId = catalogItemId || null;
  if (finalCatalogItemId) {
    const existing = db.get('brindesCatalog').find({ id: finalCatalogItemId }).value();
    if (!existing) finalCatalogItemId = null;
  }
  if (!finalCatalogItemId) {
    const newItem = {
      id: nanoid(),
      brand: finalBrand,
      group: (group && group.trim()) || 'Outros',
      code: '',
      item: item.trim(),
      multiplo: '',
      valor: null,
      estoquePR: 0,
      estoqueSP: 0,
      estoquePE: 0,
      estoqueTotal: 0,
      status: '',
      obs: '',
      updatedAt: new Date().toISOString()
    };
    db.get('brindesCatalog').push(newItem).write();
    finalCatalogItemId = newItem.id;
  }

  const row = {
    id: nanoid(),
    brand: finalBrand,
    date: date || new Date().toISOString().slice(0, 10),
    catalogItemId: finalCatalogItemId,
    item: item.trim(),
    withdrawnBy,
    withdrawnByName: withdrawnUser.name || withdrawnUser.username,
    motivo: motivo || '',
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    createdByName: req.user.name
  };
  db.get('retiradasInternas').push(row).write();
  logAudit({ user: req.user, entityType: 'retiradaInterna', entityId: row.id, entityLabel: `${row.item} · ${row.withdrawnByName}`, action: 'create' });
  res.json({ item: row });
});

router.put('/:id', requireAuth, requireEdit, (req, res) => {
  const existing = db.get('retiradasInternas').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Registro não encontrado.' });
  const b = req.body || {};
  const updates = {};
  if (b.date !== undefined) updates.date = b.date || existing.date;
  if (b.item !== undefined && b.item.trim()) updates.item = b.item.trim();
  if (b.motivo !== undefined) updates.motivo = b.motivo;
  if (b.withdrawnBy !== undefined) {
    const u = db.get('users').find({ id: b.withdrawnBy }).value();
    if (!u) return res.status(400).json({ error: 'Escolha quem retirou.' });
    updates.withdrawnBy = b.withdrawnBy;
    updates.withdrawnByName = u.name || u.username;
  }
  db.get('retiradasInternas').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'retiradaInterna', entityId: existing.id, entityLabel: updates.item || existing.item, action: 'update' });
  res.json({ item: db.get('retiradasInternas').find({ id: req.params.id }).value() });
});

router.delete('/:id', requireAuth, requireEdit, (req, res) => {
  const existing = db.get('retiradasInternas').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Registro não encontrado.' });
  db.get('retiradasInternas').remove({ id: req.params.id }).write();
  logAudit({ user: req.user, entityType: 'retiradaInterna', entityId: existing.id, entityLabel: existing.item, action: 'delete' });
  res.json({ ok: true });
});

module.exports = router;
