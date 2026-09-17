const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { resolveUserName, resolveUserPhoto } = require('../utils/names');

const router = express.Router();

// Chat da Equipe (18ª rodada, pedido da Raquel: "Crie um chat dentro de
// plataforma, onde a equipe pode conversar"). Implementado como um mural
// único de conversa — todo mundo logado na Plataforma vê as mesmas
// mensagens (não são conversas privadas entre duas pessoas). Sem
// WebSocket: o frontend consulta em intervalos curtos (polling), mesmo
// padrão já usado no aviso sonoro de recados/demandas (16ª/17ª rodada).

const MAX_MESSAGE_LENGTH = 2000;

function serialize(m) {
  return {
    id: m.id,
    text: m.text,
    createdBy: m.createdBy,
    // Nome e foto resolvidos ao vivo (20ª rodada) — ver utils/names.js.
    createdByName: resolveUserName(m.createdBy, m.createdByName),
    createdByPhotoUrl: resolveUserPhoto(m.createdBy),
    createdAt: m.createdAt
  };
}

// Sem paginação por página — só um corte de segurança pra não mandar o
// histórico inteiro se o chat crescer muito ao longo do tempo.
const HISTORY_LIMIT = 200;

// `?afterId=<id>` retorna só as mensagens mais novas que aquele id (usado
// pelo polling, pra não reenviar o histórico inteiro a cada checagem). Sem
// esse parâmetro, retorna as últimas mensagens (carga inicial da tela).
router.get('/messages', requireAuth, (req, res) => {
  const all = db.get('chatMessages').value();
  const afterId = req.query.afterId;
  if (afterId) {
    const idx = all.findIndex((m) => m.id === afterId);
    // Se o id não existir mais (mensagem apagada nesse meio-tempo), manda o
    // histórico recente inteiro em vez de nada, pra não travar o cliente.
    const rest = idx === -1 ? all.slice(-HISTORY_LIMIT) : all.slice(idx + 1);
    return res.json({ messages: rest.map(serialize) });
  }
  res.json({ messages: all.slice(-HISTORY_LIMIT).map(serialize) });
});

router.post('/messages', requireAuth, (req, res) => {
  const text = ((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: 'Escreva uma mensagem.' });
  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Mensagem muito longa (máximo ${MAX_MESSAGE_LENGTH} caracteres).` });
  }
  const message = {
    id: nanoid(),
    text,
    createdBy: req.user.id,
    createdByName: req.user.name || req.user.username,
    createdAt: new Date().toISOString()
  };
  db.get('chatMessages').push(message).write();
  res.json({ message: serialize(message) });
});

// Só quem escreveu a mensagem (ou um admin da plataforma, pra moderar
// algo fora de lugar) pode apagar — mesmo padrão de "é seu, você decide"
// já usado em Demandas/Recados.
router.delete('/messages/:id', requireAuth, (req, res) => {
  const message = db.get('chatMessages').find({ id: req.params.id }).value();
  if (!message) return res.status(404).json({ error: 'Mensagem não encontrada.' });
  if (message.createdBy !== req.user.id && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Você só pode apagar as suas próprias mensagens.' });
  }
  db.get('chatMessages').remove({ id: req.params.id }).write();
  res.json({ ok: true });
});

module.exports = router;
