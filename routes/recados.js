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

// Exclusão (44ª rodada — corrige pendência conhecida desde a 18ª: "hoje
// qualquer destinatário consegue excluir um recado pra todo mundo"). Regra
// correta: quem apaga sendo o DONO do recado (quem escreveu) apaga pra todo
// mundo; quem apaga sendo um DESTINATÁRIO (não o dono) apaga só pra si —
// o recado continua existindo pros outros destinatários e pro dono. Um
// recado automático do sistema (ver createAutoRecado abaixo, `createdBy:
// null`) não tem dono humano nenhum — nesse caso NINGUÉM que o recebe tem
// o "poder" de apagar pra todo mundo, então qualquer exclusão por um
// destinatário sempre cai no caso "só pra si" (trata o sistema/a aprovação
// como se fosse o dono, exatamente como pedido).
router.delete('/:id', requireAuth, (req, res) => {
  const recado = db.get('recados').find({ id: req.params.id }).value();
  if (!recado) return res.status(404).json({ error: 'Recado não encontrado.' });
  if (!canAccess(recado, req.user.id)) return res.status(403).json({ error: 'Esse recado não é seu.' });
  const isOwner = !!recado.createdBy && recado.createdBy === req.user.id;
  if (isOwner) {
    db.get('recados').remove({ id: req.params.id }).write();
    logAudit({ user: req.user, entityType: 'recado', entityId: recado.id, entityLabel: recado.text.slice(0, 40), action: 'delete' });
    return res.json({ ok: true });
  }
  const remainingTargets = (recado.targetUserIds || []).filter((id) => id !== req.user.id);
  const remainingReadBy = (recado.readBy || []).filter((id) => id !== req.user.id);
  if (remainingTargets.length === 0 && !recado.createdBy) {
    // Recado sem dono humano (gerado pelo sistema) que ficou sem nenhum
    // destinatário — não faz sentido manter órfão no banco.
    db.get('recados').remove({ id: req.params.id }).write();
  } else {
    db.get('recados').find({ id: req.params.id }).assign({ targetUserIds: remainingTargets, readBy: remainingReadBy }).write();
  }
  logAudit({ user: req.user, entityType: 'recado', entityId: recado.id, entityLabel: recado.text.slice(0, 40), action: 'delete', details: 'Removido só para o destinatário que apagou' });
  res.json({ ok: true });
});

// ---------- Recados automáticos do sistema ----------
// Usado por outras rotas (ex.: routes/socialPosts.js, ao aprovar um post na
// Prévia do Feed — 44ª rodada) pra gerar um recado sem um dono humano,
// endereçado só a pessoas específicas. `createdBy: null` é o que faz esse
// recado seguir a regra "sistema/aprovação = dono" na exclusão acima —
// nenhum destinatário consegue apagar pra todo mundo, só pra si mesmo.
// `externalUrl` (11ª melhoria, 24/09/2026, pedido da Raquel: "isso seria
// importante ter. Um link na aba recado, avisando que o post foi
// publicado e ao clicar no link ser levado até a rede social com o post
// publicado") -- diferente de `sourceSocialPostId` (que leva a pessoa até
// o post DENTRO da Papoi, no Agendamento), `externalUrl` é o link de
// verdade da Meta (`externalPermalink`, já calculado por
// utils/metaPublisher.js) pro post publicado no Instagram/Facebook. Só
// vem preenchido quando a Meta conseguiu devolver um permalink (nem
// sempre acontece -- ver comentário em metaPublisher.js).
// `kind` (63ª rodada, "Rodada E" da Pendência 51) -- identifica
// o TIPO de recado automático (`'post_ready_for_approval'`,
// `'post_approved'`, `'post_published'`, etc.), sem mudar nada de como ele
// aparece pra quem recebe (continua um recado normal). Serve só pra outra
// rota conseguir achar de volta um recado automático específico já
// existente (ver `updateAutoRecadosForPost` abaixo) -- por exemplo, achar
// o aviso de "pronto pra aprovar" de um post pra atualizá-lo em vez de
// criar um aviso solto novo quando o post é aprovado.
function createAutoRecado({ recipientIds, text, postTitle, postBrand, postNetwork, sourceSocialPostId, externalUrl, kind }) {
  const ids = validUserIds(recipientIds);
  if (ids.length === 0) return null;
  const recado = {
    id: nanoid(),
    text,
    color: '#6D63E0',
    targetUserIds: ids,
    readBy: [],
    archived: false,
    createdAt: new Date().toISOString(),
    createdBy: null,
    createdByName: 'Papoi',
    system: true,
    postTitle: postTitle || null,
    postBrand: postBrand || null,
    postNetwork: postNetwork || null,
    sourceSocialPostId: sourceSocialPostId || null,
    externalUrl: externalUrl || null,
    kind: kind || null
  };
  db.get('recados').push(recado).write();
  return recado;
}

// Atualiza EM CIMA de um recado automático já existente, em vez de criar
// um novo (Rodada E, pedido da Raquel: "quando aprovado, o recado de
// solicitação deve atualizar para 'aprovado por (cargo)'" -- em vez de a
// coordenadora/gerente ficarem com 2 recados soltos do mesmo post, o aviso
// de "aguardando aprovação" vira, no lugar, o aviso de "aprovado por...").
// Acha todos os recados não-arquivados desse post com esse `kind` (pode
// ter mais de um, já que o aviso de aprovação dispara de novo a cada
// edição enquanto está pendente) e troca o texto de todos -- volta a
// aparecer como não-lido (`readBy: []`) pra quem já tinha lido o aviso
// antigo, já que o conteúdo mudou de verdade e vale a pena reaparecer.
function updateAutoRecadosForPost({ sourceSocialPostId, kind, text }) {
  const matches = db.get('recados').value().filter((r) =>
    !r.archived && r.sourceSocialPostId === sourceSocialPostId && r.kind === kind
  );
  matches.forEach((r) => {
    db.get('recados').find({ id: r.id }).assign({ text, readBy: [] }).write();
  });
  return matches.length;
}

module.exports = router;
module.exports.createAutoRecado = createAutoRecado;
module.exports.updateAutoRecadosForPost = updateAutoRecadosForPost;
