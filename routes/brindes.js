const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// Brindes — catálogo/estoque (por marca) e registro de saídas por
// representante. Catálogo inicial semeado a partir da planilha de controle
// de brindes 2026; a partir daqui os dados vivem só no banco da Plataforma.
//
// Acesso: qualquer pessoa logada pode VER (catálogo e registro de saídas);
// só quem tem permissão "brindes" = editor/admin (ou é admin da
// plataforma) pode criar/editar/excluir — permissão configurada na tela
// de Usuários.
function canEdit(req) {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  const access = (user.permissions || {}).brindes || 'none';
  return access === 'editor' || access === 'admin';
}
function requireBrindesEdit(req, res, next) {
  if (!canEdit(req)) return res.status(403).json({ error: 'Você não tem permissão para editar Brindes.' });
  next();
}

function sumStock(pr, sp, pe) {
  return (Number(pr) || 0) + (Number(sp) || 0) + (Number(pe) || 0);
}

function catalogItem(brand, group, code, item, multiplo, valor, pr, sp, pe, status, obs) {
  return {
    id: nanoid(),
    brand,
    group,
    code,
    item,
    multiplo: multiplo || '',
    valor: valor === null || valor === undefined ? null : Number(valor),
    estoquePR: Number(pr) || 0,
    estoqueSP: Number(sp) || 0,
    estoquePE: Number(pe) || 0,
    estoqueTotal: sumStock(pr, sp, pe),
    status: status || '',
    obs: obs || '',
    updatedAt: new Date().toISOString()
  };
}

function seedCatalogIfEmpty() {
  if (db.get('brindesCatalog').size().value() > 0) return;
  const rows = [
    // De Bacco — catálogo/estoque
    catalogItem('debacco', 'Brindes', '99.99.00066', 'Caneta Metálica', 1, 6.0, 0, 160, 50, 'OK', ''),
    catalogItem('debacco', 'Brindes', '99.99.00108', 'Prancheta', 1, 15.98, 1608, 685, 90, '', ''),
    catalogItem('debacco', 'Brindes', '99.99.00149', 'Avental', 5, 24.96, 220, 154, 45, 'comprado', ''),
    catalogItem('debacco', 'Brindes', '99.99.00153', 'Luva de Cozinha', 1, 10.8, 125, 160, 75, 'OK', ''),
    catalogItem('debacco', 'Brindes', '99.99.00174', 'Saca Rolha de Vinho Elétrico - SWA-WG08', 1, 34.77, 0, 0, 7, 'CANCELAR', ''),
    catalogItem('debacco', 'Brindes', '99.99.00189', 'Copo Stanley - AZ2024', 1, 17.0, 50, 160, 15, '', ''),
    catalogItem('debacco', 'Brindes', '99.99.00249', 'Catálogo Completo 2026', 10, 6.7, 1650, 160, 200, '', ''),
    catalogItem('debacco', 'Brindes', '99.99.00272', 'Saca Rolha de Vinho Manual', 1, 8.48, 107, 265, 10, 'comprado', 'Ver para fazer novo pedido'),
    catalogItem('debacco', 'Brindes', '99.99.00370', 'Sacola Kraft', 10, 1.83, 1180, 1105, 690, 'OK', 'Pesquisar novo modelo'),
    catalogItem('debacco', 'Brindes', '99.99.00371', 'Copo Inox Café 150ml - S-SC05-150-T2', 2, 21.59, 355, 68, 57, 'OK', 'Comprar 1.000 unitário'),
    catalogItem('debacco', 'Brindes', '99.99.00447', 'Lápis Preto 2B Normal', 1, 2.0, 680, 60, 360, '', ''),
    catalogItem('debacco', 'Brindes', '99.99.00448', 'Lápis Preto 2B Swarovski', 1, 4.5, 275, 100, 54, '', ''),
    catalogItem('debacco', 'Brindes', '99.99.00199', 'Folder lançamentos', 20, 1.64, 0, 300, 120, '', 'usar cod acesso 30.06.00082'),
    // GhelPlus — brindes e catálogos
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00064', 'Catálogo', 10, 1.95, 200, 1870, 120, 'ok', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00239', 'Folder', 25, 2.21, 0, 0, 0, 'Zerar estoque', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00060', 'Caneta Plástica', 10, 2.15, 25, 86, 100, 'ok', 'comprado — 6 mil'),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00074', 'Abridor Chaveiro', 5, 2.7, 0, 25, 30, 'ok', 'comprado — 2700'),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00091', 'Calendário', 20, 2.9, 0, 0, 0, 'ok', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00094', 'Sacola Papel Kraft', 10, 2.03, 2159, 400, 440, 'ok', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00096', 'Bloquinho Pequeno', 10, 3.0, 500, 600, 260, 'ok', 'Mudar layout / orçar'),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00098', 'Boné', 20, 14.09, 72, 20, 67, 'ok', 'Comprar — menos de 15 mil'),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00126', 'Kit Churrasco', 99, 40.0, 49, 10, 10, 'ok', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00138', 'Caneta Metálica', 5, 6.5, 152, 0, 40, 'ok', 'comprado — 2875'),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00166', 'Régua Grande', 5, 8.5, 110, 10, 35, 'ok', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00197', 'Balas', 100, 22.0, 0, 0, 0, 'ok', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00262', 'Sal Parrilla Cebola/Alecrim/Alho', 6, 6.5, 396, 33, 4, 'Compra efetuada', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00263', 'Sal Parrilla Chimichurri', 6, 6.5, 423, 18, 4, 'Compra efetuada', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00267', 'Luva Térmica', 5, 9.8, 0, 0, 0, 'Não faremos mais', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00271', 'Avental', 5, 17.0, 0, 5, 0, 'Não faremos mais', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00188', 'Copo Stanley - AZ2024', 1, 17.0, 849, 188, 10, '', 'Comprar 500 — falta orçar'),
    // GhelPlus — materiais de PDV
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00082', 'Adesivo de Válvula 3.1/2', 6, 0.45, 36, 300, 40, '', 'Em análise se vai ser feito'),
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00084', 'Tag de Preço', 40, 0.55, 1000, 1035, 1200, 'ok', ''),
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00111', 'Balões', 50, 0.28, 450, 1000, 1950, 'ok', ''),
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00121', 'Bobina de Foração', 1, 243.0, 2, 7, 2, 'ok', ''),
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00134', 'Clip Strip Gôndula', 25, 2.99, 0, 300, 80, '', ''),
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00151', 'Adesivo P/ Válvula 4 1/2', 4, 0.54, 0, 0, 0, '', 'Em análise se vai ser feito'),
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00161', 'Bandeirinhas', 54, 0.9, 2898, 1200, 3156, 'ok', ''),
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00162', 'Tarja de Gôndolas', 20, 0.8, 3140, 1150, 2300, 'ok', ''),
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00163', 'Mobile de Teto', 10, 1.98, 1250, 1850, 490, 'ok', ''),
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00164', 'Cubos 20 x 20 cm', 10, 3.09, 595, 1200, 200, 'ok', '')
  ];
  db.get('brindesCatalog').push(...rows).write();
}
seedCatalogIfEmpty();

// ---------- catálogo/estoque ----------
router.get('/catalog', requireAuth, (req, res) => {
  const { brand } = req.query;
  let rows = db.get('brindesCatalog').value();
  if (brand) rows = rows.filter((r) => r.brand === brand);
  res.json({ items: rows });
});

router.post('/catalog', requireAuth, requireBrindesEdit, (req, res) => {
  const { brand, group, code, item, multiplo, valor, estoquePR, estoqueSP, estoquePE, status, obs } = req.body || {};
  if (!brand || !item) return res.status(400).json({ error: 'Preencha marca e nome do item.' });
  const row = catalogItem(brand, group || '', code || '', item, multiplo, valor, estoquePR, estoqueSP, estoquePE, status, obs);
  db.get('brindesCatalog').push(row).write();
  logAudit({ user: req.user, entityType: 'brindeCatalogo', entityId: row.id, entityLabel: row.item, action: 'create' });
  res.json({ item: row });
});

router.put('/catalog/:id', requireAuth, requireBrindesEdit, (req, res) => {
  const existing = db.get('brindesCatalog').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Item não encontrado.' });
  const b = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  ['brand', 'group', 'code', 'item', 'multiplo', 'status', 'obs'].forEach((k) => {
    if (b[k] !== undefined) updates[k] = b[k];
  });
  if (b.valor !== undefined) updates.valor = b.valor === '' ? null : Number(b.valor);
  ['estoquePR', 'estoqueSP', 'estoquePE'].forEach((k) => {
    if (b[k] !== undefined) updates[k] = Number(b[k]) || 0;
  });
  const pr = updates.estoquePR !== undefined ? updates.estoquePR : existing.estoquePR;
  const sp = updates.estoqueSP !== undefined ? updates.estoqueSP : existing.estoqueSP;
  const pe = updates.estoquePE !== undefined ? updates.estoquePE : existing.estoquePE;
  updates.estoqueTotal = sumStock(pr, sp, pe);
  db.get('brindesCatalog').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'brindeCatalogo', entityId: existing.id, entityLabel: existing.item, action: 'update' });
  res.json({ item: db.get('brindesCatalog').find({ id: req.params.id }).value() });
});

router.delete('/catalog/:id', requireAuth, requireBrindesEdit, (req, res) => {
  const existing = db.get('brindesCatalog').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Item não encontrado.' });
  db.get('brindesCatalog').remove({ id: req.params.id }).write();
  logAudit({ user: req.user, entityType: 'brindeCatalogo', entityId: existing.id, entityLabel: existing.item, action: 'delete' });
  res.json({ ok: true });
});

// ---------- registro de saídas (controle por representante) ----------
router.get('/log', requireAuth, (req, res) => {
  const { brand } = req.query;
  let rows = db.get('brindesLog').value();
  if (brand) rows = rows.filter((r) => r.brand === brand);
  rows = rows.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  res.json({ items: rows });
});

router.post('/log', requireAuth, requireBrindesEdit, (req, res) => {
  const { brand, date, gerente, representante, estado, cliente, quantidade, item, motivo, obs } = req.body || {};
  if (!brand || !item) return res.status(400).json({ error: 'Preencha marca e item.' });
  const row = {
    id: nanoid(),
    brand,
    date: date || new Date().toISOString().slice(0, 10),
    gerente: gerente || '',
    representante: representante || '',
    estado: estado || '',
    cliente: cliente || '',
    quantidade: Number(quantidade) || 0,
    item,
    motivo: motivo || '',
    obs: obs || '',
    createdAt: new Date().toISOString(),
    createdByName: req.user.username
  };
  db.get('brindesLog').push(row).write();
  logAudit({ user: req.user, entityType: 'brindeSaida', entityId: row.id, entityLabel: `${row.item} · ${row.quantidade}`, action: 'create' });
  res.json({ item: row });
});

router.put('/log/:id', requireAuth, requireBrindesEdit, (req, res) => {
  const existing = db.get('brindesLog').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Registro não encontrado.' });
  const b = req.body || {};
  const updates = {};
  ['brand', 'date', 'gerente', 'representante', 'estado', 'cliente', 'item', 'motivo', 'obs'].forEach((k) => {
    if (b[k] !== undefined) updates[k] = b[k];
  });
  if (b.quantidade !== undefined) updates.quantidade = Number(b.quantidade) || 0;
  db.get('brindesLog').find({ id: req.params.id }).assign(updates).write();
  res.json({ item: db.get('brindesLog').find({ id: req.params.id }).value() });
});

router.delete('/log/:id', requireAuth, requireBrindesEdit, (req, res) => {
  const existing = db.get('brindesLog').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Registro não encontrado.' });
  db.get('brindesLog').remove({ id: req.params.id }).write();
  res.json({ ok: true });
});

module.exports = router;
