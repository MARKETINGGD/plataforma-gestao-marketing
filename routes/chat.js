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
//
// 40ª rodada, pedido da Raquel: "deve ter a opção de criar grupos, nos
// grupos pode por nomes e escolher as pessoas que vão participar, deve ter
// a opção de marcar pessoa no grupo, e de chamar atenção (vibrar a tela no
// chat, com barulho de algo vibrando), deve ter a opção tbm de criar
// conversas pessoais com apenas uma pessoa (privada, ngm alem de quem esta
// na conversa deve ver) e grupo privadas (ngm alem de quem esta no grupo
// pode ver)". Confirmado com a Raquel antes de implementar: o mural
// "Geral" de sempre continua existindo do jeito que é, junto com uma lista
// nova de conversas (grupos e privadas).
//
// Arquitetura: uma coleção nova, `chatConversations` (grupo ou DM — ver
// db.js), e o `chatMessages` de sempre ganhou um campo opcional
// `conversationId`. Mensagem SEM esse campo (todo o histórico já existente)
// ou com `conversationId: 'geral'` é do mural Geral — os dois casos contam
// como "Geral" (ver isGeral() abaixo), então não precisou migrar nenhum
// dado antigo. As rotas antigas (`/messages`, sem `/conversations/`) foram
// mantidas EXATAMENTE como eram, só que agora filtram implicitamente pro
// mural Geral — a janelinha de chat flutuante (widget, no canto da tela)
// continua usando elas sem nenhuma mudança de código, e continua mostrando
// só o Geral (as conversas/grupos novos só aparecem na tela cheia "Chat da
// Equipe", com a lista de conversas ao lado — limite consciente de escopo,
// registrado no handoff).
//
// Acesso a grupo/DM: só quem está em `participantIds` consegue ler ou
// mandar mensagem ali — verificado em toda rota de `/conversations/:id/*`
// (ver isParticipant). "Chamar atenção" (nudge) é por CONVERSA inteira
// (não por pessoa específica dentro do grupo) — outro limite consciente de
// escopo, mais simples de entregar e já cobre o pedido ("vibrar a tela no
// chat, com barulho de algo vibrando").

const MAX_MESSAGE_LENGTH = 2000;

function isGeral(m) {
  return !m.conversationId || m.conversationId === 'geral';
}

function serialize(m) {
  return {
    id: m.id,
    conversationId: m.conversationId || 'geral',
    kind: m.kind || 'text',
    text: m.text,
    mentionedUserIds: m.mentionedUserIds || [],
    createdBy: m.createdBy,
    // Nome e foto resolvidos ao vivo (20ª rodada) — ver utils/names.js.
    createdByName: resolveUserName(m.createdBy, m.createdByName),
    createdByPhotoUrl: resolveUserPhoto(m.createdBy),
    createdAt: m.createdAt
  };
}

function getConversation(id) {
  if (id === 'geral') return { id: 'geral', type: 'geral', participantIds: null };
  return db.get('chatConversations').find({ id }).value();
}

function isParticipant(conv, userId) {
  if (!conv) return false;
  if (conv.type === 'geral') return true;
  return (conv.participantIds || []).includes(userId);
}

function serializeConversation(conv, userId) {
  if (conv.type === 'geral') {
    return { id: 'geral', type: 'geral', name: 'Geral', participants: [], isGeral: true };
  }
  const participants = (conv.participantIds || []).map((id) => {
    const u = db.get('users').find({ id }).value();
    return u ? { id: u.id, name: u.name || u.username, photoUrl: u.photoUrl || null } : { id, name: '(conta removida)', photoUrl: null };
  });
  let name = conv.name;
  if (conv.type === 'dm') {
    const other = participants.find((p) => p.id !== userId);
    name = other ? other.name : ((participants[0] && participants[0].name) || 'Conversa');
  }
  return {
    id: conv.id,
    type: conv.type,
    name,
    participants,
    createdBy: conv.createdBy,
    createdAt: conv.createdAt
  };
}

// Menções (40ª rodada, "deve ter a opção de marcar pessoa no grupo") —
// procura "@Nome Completo" no texto contra quem participa da conversa
// (ou, no Geral, contra toda a equipe). Nomes mais longos primeiro, pra
// "@Ana Paula" não parar em "@Ana" por engano quando as duas existem.
function parseMentions(text, candidates) {
  const lower = text.toLowerCase();
  const found = new Set();
  candidates
    .slice()
    .filter((c) => c.name)
    .sort((a, b) => b.name.length - a.name.length)
    .forEach((c) => {
      const needle = '@' + c.name.toLowerCase();
      if (lower.includes(needle)) found.add(c.id);
    });
  return Array.from(found);
}

// Sem paginação por página — só um corte de segurança pra não mandar o
// histórico inteiro se o chat crescer muito ao longo do tempo.
const HISTORY_LIMIT = 200;

function sliceAfter(all, afterId) {
  if (afterId) {
    const idx = all.findIndex((m) => m.id === afterId);
    // Se o id não existir mais (mensagem apagada nesse meio-tempo), manda o
    // histórico recente inteiro em vez de nada, pra não travar o cliente.
    return idx === -1 ? all.slice(-HISTORY_LIMIT) : all.slice(idx + 1);
  }
  return all.slice(-HISTORY_LIMIT);
}

// ---------- Mural Geral (rotas antigas, sem mudança de comportamento) ----------

// `?afterId=<id>` retorna só as mensagens mais novas que aquele id (usado
// pelo polling, pra não reenviar o histórico inteiro a cada checagem). Sem
// esse parâmetro, retorna as últimas mensagens (carga inicial da tela).
router.get('/messages', requireAuth, (req, res) => {
  const all = db.get('chatMessages').value().filter(isGeral);
  res.json({ messages: sliceAfter(all, req.query.afterId).map(serialize) });
});

router.post('/messages', requireAuth, (req, res) => {
  const text = ((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: 'Escreva uma mensagem.' });
  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Mensagem muito longa (máximo ${MAX_MESSAGE_LENGTH} caracteres).` });
  }
  const candidates = db.get('users').value().map((u) => ({ id: u.id, name: u.name || u.username }));
  const message = {
    id: nanoid(),
    conversationId: 'geral',
    text,
    mentionedUserIds: parseMentions(text, candidates),
    createdBy: req.user.id,
    createdByName: req.user.name || req.user.username,
    createdAt: new Date().toISOString()
  };
  db.get('chatMessages').push(message).write();
  res.json({ message: serialize(message) });
});

// Só quem escreveu a mensagem (ou um admin da plataforma, pra moderar
// algo fora de lugar) pode apagar — mesmo padrão de "é seu, você decide"
// já usado em Demandas/Recados. Vale pra mensagem de qualquer conversa
// (Geral, grupo ou DM), não só Geral.
router.delete('/messages/:id', requireAuth, (req, res) => {
  const message = db.get('chatMessages').find({ id: req.params.id }).value();
  if (!message) return res.status(404).json({ error: 'Mensagem não encontrada.' });
  if (message.createdBy !== req.user.id && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Você só pode apagar as suas próprias mensagens.' });
  }
  db.get('chatMessages').remove({ id: req.params.id }).write();
  res.json({ ok: true });
});

// ---------- Conversas (40ª rodada): grupos e privadas ----------

// Lista sempre com "Geral" primeiro (fixo, todo mundo participa) e depois
// os grupos/DMs de que a pessoa faz parte — ninguém vê conversa/grupo que
// não é dela (pedido da Raquel: "ngm alem de quem esta na conversa deve
// ver" / "ngm alem de quem esta no grupo pode ver").
router.get('/conversations', requireAuth, (req, res) => {
  const mine = db.get('chatConversations').value().filter((c) => (c.participantIds || []).includes(req.user.id));
  const sorted = mine.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const list = [serializeConversation({ type: 'geral' }, req.user.id)].concat(sorted.map((c) => serializeConversation(c, req.user.id)));
  res.json({ conversations: list });
});

router.post('/conversations', requireAuth, (req, res) => {
  const { type, name, participantIds } = req.body || {};
  const validIds = (Array.isArray(participantIds) ? participantIds : []).filter((id) => db.get('users').find({ id }).value());

  if (type === 'group') {
    const groupName = (name || '').trim();
    if (!groupName) return res.status(400).json({ error: 'Dê um nome para o grupo.' });
    const ids = Array.from(new Set(validIds));
    if (!ids.includes(req.user.id)) ids.push(req.user.id);
    if (ids.length < 2) return res.status(400).json({ error: 'Escolha pelo menos mais uma pessoa para o grupo.' });
    const conv = { id: nanoid(), type: 'group', name: groupName, participantIds: ids, createdBy: req.user.id, createdAt: new Date().toISOString() };
    db.get('chatConversations').push(conv).write();
    return res.json({ conversation: serializeConversation(conv, req.user.id) });
  }

  if (type === 'dm') {
    const otherId = validIds.find((id) => id !== req.user.id);
    if (!otherId) return res.status(400).json({ error: 'Escolha uma pessoa para conversar.' });
    // Não duplica DM já existente entre as mesmas duas pessoas — reabre a
    // mesma conversa em vez de criar outra igual.
    const existing = db.get('chatConversations').value().find((c) =>
      c.type === 'dm' &&
      (c.participantIds || []).length === 2 &&
      (c.participantIds || []).includes(req.user.id) &&
      (c.participantIds || []).includes(otherId)
    );
    if (existing) return res.json({ conversation: serializeConversation(existing, req.user.id) });
    const conv = { id: nanoid(), type: 'dm', name: null, participantIds: [req.user.id, otherId], createdBy: req.user.id, createdAt: new Date().toISOString() };
    db.get('chatConversations').push(conv).write();
    return res.json({ conversation: serializeConversation(conv, req.user.id) });
  }

  res.status(400).json({ error: 'Tipo de conversa inválido.' });
});

router.get('/conversations/:id/messages', requireAuth, (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
  if (!isParticipant(conv, req.user.id)) return res.status(403).json({ error: 'Você não participa dessa conversa.' });
  const all = conv.type === 'geral'
    ? db.get('chatMessages').value().filter(isGeral)
    : db.get('chatMessages').value().filter((m) => m.conversationId === conv.id);
  res.json({
    messages: sliceAfter(all, req.query.afterId).map(serialize),
    conversation: serializeConversation(conv, req.user.id)
  });
});

router.post('/conversations/:id/messages', requireAuth, (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
  if (!isParticipant(conv, req.user.id)) return res.status(403).json({ error: 'Você não participa dessa conversa.' });
  const text = ((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: 'Escreva uma mensagem.' });
  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Mensagem muito longa (máximo ${MAX_MESSAGE_LENGTH} caracteres).` });
  }
  const candidateIds = conv.type === 'geral' ? db.get('users').value().map((u) => u.id) : (conv.participantIds || []);
  const candidates = candidateIds
    .map((id) => db.get('users').find({ id }).value())
    .filter(Boolean)
    .map((u) => ({ id: u.id, name: u.name || u.username }));
  const message = {
    id: nanoid(),
    conversationId: conv.type === 'geral' ? 'geral' : conv.id,
    text,
    mentionedUserIds: parseMentions(text, candidates),
    createdBy: req.user.id,
    createdByName: req.user.name || req.user.username,
    createdAt: new Date().toISOString()
  };
  db.get('chatMessages').push(message).write();
  res.json({ message: serialize(message) });
});

// "Chamar atenção" (40ª rodada, pedido da Raquel: "de chamar atenção
// (vibrar a tela no chat, com barulho de algo vibrando)") — só em grupo ou
// DM (não faz sentido vibrar a tela de todo mundo no mural Geral). É pra
// CONVERSA inteira, não uma pessoa específica dentro do grupo (limite de
// escopo, ver comentário no topo do arquivo). Vira só mais uma mensagem,
// com `kind: 'nudge'` — o polling de quem está com a conversa aberta pega
// ela como qualquer outra mensagem nova, e o frontend reconhece esse
// `kind` pra vibrar a tela + tocar o som (em vez de mostrar texto normal).
router.post('/conversations/:id/nudge', requireAuth, (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
  if (conv.type === 'geral') return res.status(400).json({ error: 'Não dá pra chamar atenção no mural Geral.' });
  if (!isParticipant(conv, req.user.id)) return res.status(403).json({ error: 'Você não participa dessa conversa.' });
  const message = {
    id: nanoid(),
    conversationId: conv.id,
    kind: 'nudge',
    text: `${req.user.name || req.user.username} chamou a atenção`,
    createdBy: req.user.id,
    createdByName: req.user.name || req.user.username,
    createdAt: new Date().toISOString()
  };
  db.get('chatMessages').push(message).write();
  res.json({ message: serialize(message) });
});

module.exports = router;
