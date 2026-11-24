const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// Lembretes (158ª rodada, pedido da Raquel: "diminua um pouco a aba
// recados e ao lado dela coloque Lembretes (isso será individual para
// cada membro e os lembretes devem ser no estilo post it)") -- bem
// diferente de Recados (routes/recados.js), que é endereçado a OUTRAS
// pessoas: Lembretes é 100% pessoal -- cada pessoa só vê/cria/edita/
// exclui os PRÓPRIOS, nunca os de outra pessoa (nem o super admin, que em
// qualquer outro módulo desta Plataforma enxerga tudo -- aqui não, porque
// é exatamente a mesma ideia de um post-it físico na mesa de cada um).
// Mesma paleta de cores já usada nos Recados, pra ficar visualmente
// parecido (post-it colorido).
const DEFAULT_COLORS = ['#61bd4f', '#f2d600', '#ff9f1a', '#eb5a46', '#c377e0', '#0079bf', '#00c2e0', '#51e898', '#ff78cb', '#344563'];

function serialize(l) {
  return {
    id: l.id,
    text: l.text,
    color: l.color,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt || null
  };
}

router.get('/', requireAuth, (req, res) => {
  const mine = db.get('lembretes').value()
    .filter((l) => l.userId === req.user.id)
    .slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ lembretes: mine.map(serialize), suggestedColors: DEFAULT_COLORS });
});

router.post('/', requireAuth, (req, res) => {
  const { text, color } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Escreva o lembrete.' });
  const lembrete = {
    id: nanoid(),
    userId: req.user.id,
    text: text.trim(),
    color: color || DEFAULT_COLORS[db.get('lembretes').filter({ userId: req.user.id }).size().value() % DEFAULT_COLORS.length],
    createdAt: new Date().toISOString(),
    updatedAt: null
  };
  db.get('lembretes').push(lembrete).write();
  logAudit({ user: req.user, entityType: 'lembrete', entityId: lembrete.id, entityLabel: lembrete.text.slice(0, 40), action: 'create' });
  res.json({ lembrete: serialize(lembrete) });
});

router.put('/:id', requireAuth, (req, res) => {
  const existing = db.get('lembretes').find({ id: req.params.id }).value();
  if (!existing || existing.userId !== req.user.id) return res.status(404).json({ error: 'Lembrete não encontrado.' });
  const { text, color } = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  if (text !== undefined) {
    if (!text.trim()) return res.status(400).json({ error: 'Escreva o lembrete.' });
    updates.text = text.trim();
  }
  if (color !== undefined) updates.color = color || existing.color;
  db.get('lembretes').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'lembrete', entityId: existing.id, entityLabel: (updates.text || existing.text).slice(0, 40), action: 'update' });
  res.json({ lembrete: serialize(db.get('lembretes').find({ id: req.params.id }).value()) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const existing = db.get('lembretes').find({ id: req.params.id }).value();
  if (!existing || existing.userId !== req.user.id) return res.status(404).json({ error: 'Lembrete não encontrado.' });
  db.get('lembretes').remove({ id: req.params.id }).write();
  logAudit({ user: req.user, entityType: 'lembrete', entityId: existing.id, entityLabel: existing.text.slice(0, 40), action: 'delete' });
  res.json({ ok: true });
});

module.exports = router;
