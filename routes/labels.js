const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// Etiquetas coloridas do quadro de Demandas — qualquer pessoa logada pode
// criar/editar/excluir (mesmo padrão de acesso livre já usado em Demandas).
// Paleta sugerida no estilo Trello; o usuário pode digitar outra cor (hex).
const DEFAULT_COLORS = ['#61bd4f', '#f2d600', '#ff9f1a', '#eb5a46', '#c377e0', '#0079bf', '#00c2e0', '#51e898', '#ff78cb', '#344563'];

router.get('/', requireAuth, (req, res) => {
  res.json({ labels: db.get('labels').value(), suggestedColors: DEFAULT_COLORS });
});

router.post('/', requireAuth, (req, res) => {
  const { name, color } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Dê um nome para a etiqueta.' });
  const label = {
    id: nanoid(),
    name: name.trim(),
    color: color || DEFAULT_COLORS[db.get('labels').size().value() % DEFAULT_COLORS.length],
    createdAt: new Date().toISOString()
  };
  db.get('labels').push(label).write();
  logAudit({ user: req.user, entityType: 'label', entityId: label.id, entityLabel: label.name, action: 'create' });
  res.json({ label });
});

router.put('/:id', requireAuth, (req, res) => {
  const label = db.get('labels').find({ id: req.params.id }).value();
  if (!label) return res.status(404).json({ error: 'Etiqueta não encontrada.' });
  const { name, color } = req.body || {};
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'Dê um nome para a etiqueta.' });
  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (color !== undefined) updates.color = color;
  db.get('labels').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'label', entityId: label.id, entityLabel: label.name, action: 'update' });
  res.json({ label: db.get('labels').find({ id: req.params.id }).value() });
});

router.delete('/:id', requireAuth, (req, res) => {
  const label = db.get('labels').find({ id: req.params.id }).value();
  if (!label) return res.status(404).json({ error: 'Etiqueta não encontrada.' });
  db.get('labels').remove({ id: req.params.id }).write();
  // Remove a etiqueta de qualquer card que a esteja usando.
  db.get('demandas').value().forEach((d) => {
    if ((d.labelIds || []).includes(req.params.id)) {
      db.get('demandas').find({ id: d.id }).assign({
        labelIds: d.labelIds.filter((id) => id !== req.params.id),
        updatedAt: new Date().toISOString()
      }).write();
    }
  });
  logAudit({ user: req.user, entityType: 'label', entityId: label.id, entityLabel: label.name, action: 'delete' });
  res.json({ ok: true });
});

module.exports = router;
