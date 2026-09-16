const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// Mural de recados da tela Início — mensagens coloridas (como as etiquetas
// de Demandas) endereçadas a pessoas específicas, que aparecem pra elas
// assim que entram na Plataforma até marcarem como lido.

const DEFAULT_COLORS = ['#61bd4f', '#f2d600', '#ff9f1a', '#eb5a46', '#c377e0', '#0079bf', '#00c2e0', '#51e898', '#ff78cb', '#344563'];

function validUserIds(ids) {
  if (!Array.isArray(ids)) return [];
  const users = db.get('users').value();
  return ids.filter((id) => users.some((u) => u.id === id));
}

function serialize(r, userId) {
  return Object.assign({}, r, {
    targetUserIds: r.targetUserIds || [],
    readBy: r.readBy || [],
    readByMe: !!(r.readBy || []).includes(userId)
  });
}

// Todos os recados ativos (não arquivados) — usado no mural completo.
router.get('/', requireAuth, (req, res) => {
  const all = db.get('recados').value().filter((r) => !r.archived);
  res.json({ recados: all.map((r) => serialize(r, req.user.id)), suggestedColors: DEFAULT_COLORS });
});

// Recados endereçados a mim e ainda não lidos — usado na tela Início.
router.get('/for-me', requireAuth, (req, res) => {
  const mine = db.get('recados').value().filter((r) =>
    !r.archived &&
    (r.targetUserIds || []).includes(req.user.id) &&
    !(r.readBy || []).includes(req.user.id)
  );
  res.json({ recados: mine.map((r) => serialize(r, req.user.id)) });
});

router.post('/', requireAuth, (req, res) => {
  const { text, color, targetUserIds } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Escreva o recado.' });
  const ids = validUserIds(targetUserIds);
  if (ids.length === 0) return res.status(400).json({ error: 'Marque pelo menos uma pessoa pra ver o recado.' });
  const recado = {
    id: nanoid(),
    text: text.trim(),
    color: color || DEFAULT_COLORS[db.get('recados').size().value() % DEFAULT_COLORS.length],
    targetUserIds: ids,
    readBy: [],
    archived: false,
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    createdByName: req.user.name || req.user.username
  };
  db.get('recados').push(recado).write();
  logAudit({ user: req.user, entityType: 'recado', entityId: recado.id, entityLabel: recado.text.slice(0, 40), action: 'create' });
  res.json({ recado: serialize(recado, req.user.id) });
});

router.put('/:id/read', requireAuth, (req, res) => {
  const recado = db.get('recados').find({ id: req.params.id }).value();
  if (!recado) return res.status(404).json({ error: 'Recado não encontrado.' });
  const readBy = Array.from(new Set([...(recado.readBy || []), req.user.id]));
  db.get('recados').find({ id: req.params.id }).assign({ readBy }).write();
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  const recado = db.get('recados').find({ id: req.params.id }).value();
  if (!recado) return res.status(404).json({ error: 'Recado não encontrado.' });
  db.get('recados').remove({ id: req.params.id }).write();
  logAudit({ user: req.user, entityType: 'recado', entityId: recado.id, entityLabel: recado.text.slice(0, 40), action: 'delete' });
  res.json({ ok: true });
});

module.exports = router;
