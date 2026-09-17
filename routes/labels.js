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

// Etiquetas pessoais (26ª rodada, pedido da Raquel: "na area pessoal: ter a
// opção de criar etiquetas personalizadas, apenas para a área pessoal").
// `ownerId` ausente/null = etiqueta global de sempre (aparece pra todo mundo,
// em qualquer quadro). `ownerId` = id de um usuário = etiqueta pessoal dele:
// só aparece pra ele mesmo, e só faz sentido usar em demandas da área
// pessoal (o quadro geral continua só com as globais, como sempre foi).
function canManageLabel(label, user) {
  return !label.ownerId || label.ownerId === user.id;
}

router.get('/', requireAuth, (req, res) => {
  const all = db.get('labels').value();
  const visible = all.filter((l) => !l.ownerId || l.ownerId === req.user.id);
  res.json({ labels: visible, suggestedColors: DEFAULT_COLORS });
});

router.post('/', requireAuth, (req, res) => {
  const { name, color, personal } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Dê um nome para a etiqueta.' });
  const label = {
    id: nanoid(),
    name: name.trim(),
    color: color || DEFAULT_COLORS[db.get('labels').size().value() % DEFAULT_COLORS.length],
    ownerId: personal ? req.user.id : null,
    createdAt: new Date().toISOString()
  };
  db.get('labels').push(label).write();
  logAudit({ user: req.user, entityType: 'label', entityId: label.id, entityLabel: label.name, action: 'create' });
  res.json({ label });
});

router.put('/:id', requireAuth, (req, res) => {
  const label = db.get('labels').find({ id: req.params.id }).value();
  if (!label) return res.status(404).json({ error: 'Etiqueta não encontrada.' });
  if (!canManageLabel(label, req.user)) return res.status(403).json({ error: 'Essa etiqueta é pessoal de outra pessoa.' });
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
  if (!canManageLabel(label, req.user)) return res.status(403).json({ error: 'Essa etiqueta é pessoal de outra pessoa.' });
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
