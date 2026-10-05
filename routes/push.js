// Notificações push de verdade (81ª rodada) -- ver utils/webPush.js pro
// porquê/como. Esta rota só cuida do "cadastro" de cada inscrição
// (navegador/aparelho que concedeu permissão) -- quem de fato manda a
// notificação é `sendPushToUsers`, chamado de dentro de
// routes/recados.js (createAutoRecado + criação manual) e
// routes/chat.js (mensagem nova), os mesmos lugares que já disparavam a
// notificação do sistema operacional desde a 80ª rodada.
const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { isConfigured, getPublicKey } = require('../utils/webPush');

const router = express.Router();

// O navegador precisa dessa chave pra assinar a inscrição
// (`PushManager.subscribe({ applicationServerKey: ... })`) -- pública de
// propósito (é a METADE pública do par VAPID, não dá acesso a nada
// sozinha), por isso não exige login pra consultar.
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: getPublicKey(), configured: isConfigured() });
});

// Salva (ou atualiza, se o mesmo endpoint já existia -- navegador pode
// reconceder a permissão sem precisar virar um registro duplicado) a
// inscrição de push deste navegador/aparelho pra esta pessoa.
router.post('/subscribe', requireAuth, (req, res) => {
  if (!isConfigured()) return res.status(503).json({ error: 'Notificação push ainda não configurada no servidor.' });
  const { subscription } = req.body || {};
  if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
    return res.status(400).json({ error: 'Inscrição de push inválida.' });
  }
  const existing = db.get('pushSubscriptions').find({ endpoint: subscription.endpoint }).value();
  if (existing) {
    db.get('pushSubscriptions').find({ endpoint: subscription.endpoint }).assign({
      userId: req.user.id,
      keys: subscription.keys,
      userAgent: (req.headers['user-agent'] || '').slice(0, 200),
      updatedAt: new Date().toISOString()
    }).write();
  } else {
    db.get('pushSubscriptions').push({
      id: nanoid(),
      userId: req.user.id,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      userAgent: (req.headers['user-agent'] || '').slice(0, 200),
      createdAt: new Date().toISOString()
    }).write();
  }
  res.json({ ok: true });
});

// Chamado quando a pessoa desativa a notificação pelo botão (ou o
// navegador invalida a inscrição sozinho) -- remove daqui pra não
// receber mais nada nesse aparelho.
router.post('/unsubscribe', requireAuth, (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Falta o endpoint da inscrição.' });
  db.get('pushSubscriptions').remove({ endpoint, userId: req.user.id }).write();
  res.json({ ok: true });
});

module.exports = router;
