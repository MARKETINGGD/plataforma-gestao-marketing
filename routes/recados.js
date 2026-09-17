const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { resolveUserName, resolveUserPhoto } = require('../utils/names');

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

// Privacidade (18ª rodada, pedido da Raquel: "a tela de recados enviados,
// não pode mostrar para quem recebeu, quais outras pessoas receberam o
// recado... só sabe quem recebeu a pessoa que enviou"). Antes, qualquer
// destinatário via a lista completa de quem mais recebeu o mesmo recado
// (targetUserIds inteiro, pra todo mundo). Agora: só quem criou o recado
// enxerga a lista completa de destinatários e quem já leu; quem só recebeu
// vê apenas a si mesmo em targetUserIds (e só o próprio status de leitura
// em readBy) — o suficiente pra saber "recebi isso", sem saber quem mais
// recebeu. Redação acontece aqui, na origem do dado, não só escondida na
// tela — quem chamar a API direto também não consegue ver a lista alheia.
function serialize(r, userId) {
  const isOwner = r.createdBy === userId;
  return Object.assign({}, r, {
    targetUserIds: isOwner ? (r.targetUserIds || []) : [userId],
    readBy: isOwner ? (r.readBy || []) : (r.readBy || []).filter((id) => id === userId),
    readByMe: !!(r.readBy || []).includes(userId),
    // Nome/foto de quem criou o recado, resolvidos ao vivo (20ª/22ª rodada,
    // pedido da Raquel: "em recados, deve aparecer a fotinho de quem
    // mandou o recado") — ver utils/names.js.
    createdByName: resolveUserName(r.createdBy, r.createdByName),
    createdByPhoto: resolveUserPhoto(r.createdBy)
  });
}

// Um recado só pode ser visto/gerenciado por quem escreveu ou por quem foi
// marcado — nunca por "todo mundo" (recado não é aviso público).
function canAccess(recado, userId) {
  return recado.createdBy === userId || (recado.targetUserIds || []).includes(userId);
}

// Recados em que eu apareço — enviados por mim ou endereçados a mim (lidos
// ou não). Usado no "mural completo" da tela Início, que só mostra o que
// diz respeito a quem está olhando, nunca os recados de outras pessoas.
router.get('/', requireAuth, (req, res) => {
  const mine = db.get('recados').value().filter((r) => !r.archived && canAccess(r, req.user.id));
  res.json({ recados: mine.map((r) => serialize(r, req.user.id)), suggestedColors: DEFAULT_COLORS });
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
  if (!canAccess(recado, req.user.id)) return res.status(403).json({ error: 'Esse recado não é seu.' });
  const readBy = Array.from(new Set([...(recado.readBy || []), req.user.id]));
  db.get('recados').find({ id: req.params.id }).assign({ readBy }).write();
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  const recado = db.get('recados').find({ id: req.params.id }).value();
  if (!recado) return res.status(404).json({ error: 'Recado não encontrado.' });
  if (!canAccess(recado, req.user.id)) return res.status(403).json({ error: 'Esse recado não é seu.' });
  db.get('recados').remove({ id: req.params.id }).write();
  logAudit({ user: req.user, entityType: 'recado', entityId: recado.id, entityLabel: recado.text.slice(0, 40), action: 'delete' });
  res.json({ ok: true });
});

module.exports = router;
