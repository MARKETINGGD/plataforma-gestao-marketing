const path = require('path');
const fs = require('fs');
const db = require('../db');
const { nanoid } = require('./id');
const { logAudit } = require('./audit');
const { cascadeCompleteDemandas } = require('./demandCascade');
const socialPostsRouter = require('../routes/socialPosts');

// 36ª rodada, pedido da Raquel: "toda vez que criar uma ação dentro da
// planilha de influencer, essa ação deve gerar: um card [...] lá na aba de
// demandas, e um agendamento, lá em agendamento de redes sociais. Se a
// ação é excluída ou alterada, tudo que está ligado a ela, deve ser
// alterado também, o mesmo vale se tiver alterações no agendamento ou na
// demanda, tudo se altera junto."
//
// Este arquivo é o "cérebro" dessa sincronização nos 3 sentidos, entre:
// - influencerPosts (a "ação" na planilha do influencer, routes/influencers.js)
// - socialPosts (o agendamento em Redes Sociais, routes/socialPosts.js)
// - demandas (o card no quadro, routes/demandas.js)
//
// Ligação: influencerPost.linkedSocialPostId <-> socialPost.id, e
// socialPost.id <-> socialPost.sourceInfluencerPostId (pro post "saber"
// que nasceu de uma ação de influencer). A demanda já usa o campo
// `sourceSocialPostId` que existe desde a 34ª rodada -- não precisou de
// nenhum campo novo nela.
//
// IMPORTANTE: essa sincronização (edição propagando pro post virar
// "publicado" ao concluir uma demanda, e exclusão em cascata) só vale
// pra esse trio específico, marcado por `sourceInfluencerPostId`. Um
// agendamento criado manualmente pela aba Agendamento (sem essa origem)
// continua se comportando exatamente como antes -- só ganha o
// comportamento novo quem nasceu de uma ação de influencer.

const uploadsRootSocial = path.join(__dirname, '..', 'data', 'uploads', 'social');
const uploadsRootInfluencers = path.join(__dirname, '..', 'data', 'uploads', 'influencers');

function validUserIds(ids) {
  if (!Array.isArray(ids)) return [];
  const users = db.get('users').value();
  return ids.filter((id) => users.some((u) => u.id === id));
}

// Cria o agendamento (socialPost) ligado a uma ação de influencer recém
// criada, e já dispara a criação das demandas pras pessoas envolvidas
// (reaproveitando createDemandCardsForNewInvolved, a mesma função usada
// quando o agendamento nasce pela aba Agendamento normal).
function createLinkedSocialPost(inf, infPost, req) {
  const now = new Date().toISOString();
  const socialPost = {
    id: nanoid(),
    brand: inf.brand,
    platform: infPost.rede || 'instagram',
    scheduledDate: infPost.dataPostagem || null,
    scheduledTime: '',
    caption: infPost.observacoes || '',
    subject: `${inf.name} · ${infPost.formato || 'Post de influencer'}`,
    status: infPost.status === 'publicada' ? 'publicado' : 'agendado',
    postType: 'estatico',
    carouselBriefings: [],
    involvedUserIds: infPost.involvedUserIds || [],
    changeSuggestions: '',
    link: '',
    briefingText: '',
    scriptText: '',
    scriptLink: '',
    files: [],
    layoutFiles: [],
    briefingFile: null,
    scriptFile: null,
    // Origem (36ª rodada): marca esse agendamento como nascido de uma ação
    // de influencer -- é essa marcação que liga os 3 sentidos de
    // sincronização acima, e que NÃO existe num agendamento criado normal.
    sourceInfluencerPostId: infPost.id,
    createdAt: now,
    createdBy: req.user.id,
    createdByName: req.user.name,
    updatedAt: now
  };
  db.get('socialPosts').push(socialPost).write();
  socialPostsRouter.createDemandCardsForNewInvolved(socialPost, socialPost.involvedUserIds, req);
  if (socialPost.status === 'publicado') {
    cascadeCompleteDemandas(socialPost.id, null, req);
  }
  logAudit({ user: req.user, entityType: 'socialPost', entityId: socialPost.id, entityLabel: `${socialPost.brand} · ${socialPost.platform} ${socialPost.scheduledDate || ''}`, action: 'create', details: `Criado automaticamente a partir da ação de influencer "${inf.name} · ${infPost.formato}".` });
  return socialPost;
}

// Propaga uma edição feita na ação de influencer pro agendamento ligado a
// ela (chamada pelo PUT de routes/influencers.js). `updates` é o mesmo
// objeto de updates que já foi gravado na ação. Se novas pessoas entraram
// em `involvedUserIds`, cria demanda pra elas também (só as NOVAS, mesmo
// padrão já usado no PUT de Agendamento).
function syncInfluencerActionToSocialPost(infPost, updates, req) {
  if (!infPost.linkedSocialPostId) return;
  const post = db.get('socialPosts').find({ id: infPost.linkedSocialPostId }).value();
  if (!post) return;
  const previousInvolvedIds = post.involvedUserIds || [];
  const postUpdates = { updatedAt: new Date().toISOString() };
  if (updates.rede !== undefined) postUpdates.platform = updates.rede || post.platform;
  if (updates.dataPostagem !== undefined) postUpdates.scheduledDate = updates.dataPostagem;
  if (updates.observacoes !== undefined) postUpdates.caption = updates.observacoes;
  if (updates.formato !== undefined) {
    const inf = db.get('influencers').find({ id: infPost.influencerId }).value();
    postUpdates.subject = `${inf ? inf.name : ''} · ${updates.formato || 'Post de influencer'}`;
  }
  if (updates.involvedUserIds !== undefined) postUpdates.involvedUserIds = validUserIds(updates.involvedUserIds);
  let willPublish = false;
  if (updates.status !== undefined) {
    if (updates.status === 'publicada' && post.status !== 'publicado') {
      postUpdates.status = 'publicado';
      willPublish = true;
    } else if (updates.status !== 'publicada' && post.status === 'publicado') {
      // Voltou pra "a publicar"/"cancelada" -- não desfaz publicação já
      // feita no agendamento (evita reabrir algo que já saiu no ar).
    }
  }
  db.get('socialPosts').find({ id: post.id }).assign(postUpdates).write();
  const fresh = db.get('socialPosts').find({ id: post.id }).value();
  if (postUpdates.involvedUserIds !== undefined) {
    const newIds = postUpdates.involvedUserIds.filter((id) => !previousInvolvedIds.includes(id));
    socialPostsRouter.createDemandCardsForNewInvolved(fresh, newIds, req);
  }
  if (willPublish) {
    cascadeCompleteDemandas(fresh.id, null, req);
  }
}

// Propaga o status "publicado" de um socialPost pra cima -- usada tanto
// quando o PRÓPRIO agendamento é marcado como publicado (routes/socialPosts.js)
// quanto quando uma demanda ligada a ele é concluída manualmente
// (routes/demandas.js). Sempre completa as demandas-irmãs (mesmo
// comportamento de sempre, desde a 34ª rodada) e, se esse post nasceu de
// uma ação de influencer, marca a ação como "publicada" também.
function markSocialPostPublished(postId, req) {
  const post = db.get('socialPosts').find({ id: postId }).value();
  if (!post) return;
  if (post.status !== 'publicado') {
    db.get('socialPosts').find({ id: postId }).assign({ status: 'publicado', updatedAt: new Date().toISOString() }).write();
  }
  cascadeCompleteDemandas(postId, null, req);
  if (post.sourceInfluencerPostId) {
    const infPost = db.get('influencerPosts').find({ id: post.sourceInfluencerPostId }).value();
    if (infPost && infPost.status !== 'publicada') {
      db.get('influencerPosts').find({ id: infPost.id }).assign({ status: 'publicada' }).write();
    }
  }
}

function removeSocialPostFiles(postId) {
  const dir = path.join(uploadsRootSocial, postId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function removeInfluencerActionFiles(infPost) {
  if (infPost.arquivo && infPost.arquivo.url) {
    const p = path.join(uploadsRootInfluencers, infPost.influencerId, path.basename(infPost.arquivo.url));
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  if (infPost.notaFiscal && infPost.notaFiscal.url) {
    const p = path.join(uploadsRootInfluencers, infPost.influencerId, 'nota-fiscal', path.basename(infPost.notaFiscal.url));
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

// Apaga o trio inteiro (ação de influencer + agendamento + TODAS as
// demandas ligadas a ele) a partir de QUALQUER uma das pontas -- passe o
// id que você tem (`influencerPostId` OU `socialPostId`), a função acha o
// resto sozinha pela ligação entre os dois. Só entra em ação quando o
// agendamento realmente tem `sourceInfluencerPostId` (ou seja, nasceu
// desse fluxo) -- nunca mexe num agendamento/demanda criados manualmente.
function deleteInfluencerTriad({ influencerPostId, socialPostId }, req) {
  let infPost = influencerPostId ? db.get('influencerPosts').find({ id: influencerPostId }).value() : null;
  let post = socialPostId ? db.get('socialPosts').find({ id: socialPostId }).value() : null;
  if (!post && infPost && infPost.linkedSocialPostId) {
    post = db.get('socialPosts').find({ id: infPost.linkedSocialPostId }).value();
  }
  if (!infPost && post && post.sourceInfluencerPostId) {
    infPost = db.get('influencerPosts').find({ id: post.sourceInfluencerPostId }).value();
  }
  // Demandas ligadas ao agendamento (uma por pessoa envolvida) — apaga
  // todas, não só uma, já que o trio inteiro está sendo desfeito.
  if (post) {
    const linkedDemandas = db.get('demandas').value().filter((d) => d.sourceSocialPostId === post.id);
    linkedDemandas.forEach((d) => {
      db.get('demandas').remove({ id: d.id }).write();
      const dir = path.join(__dirname, '..', 'data', 'uploads', 'demandas', d.id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      if (req && req.user) {
        logAudit({ user: req.user, entityType: 'demanda', entityId: d.id, entityLabel: d.title, action: 'delete', details: 'Excluída automaticamente junto com a ação de influencer/agendamento de origem.', meta: { visibility: d.visibility } });
      }
    });
    db.get('socialPosts').remove({ id: post.id }).write();
    removeSocialPostFiles(post.id);
    if (req && req.user) {
      logAudit({ user: req.user, entityType: 'socialPost', entityId: post.id, entityLabel: `${post.platform} ${post.scheduledDate || ''}`, action: 'delete', details: 'Excluído automaticamente junto com a ação de influencer de origem.' });
    }
  }
  if (infPost) {
    db.get('influencerPosts').remove({ id: infPost.id }).write();
    removeInfluencerActionFiles(infPost);
    if (req && req.user) {
      logAudit({ user: req.user, entityType: 'influencerPost', entityId: infPost.id, entityLabel: infPost.formato, action: 'delete', details: 'Excluída automaticamente junto com o agendamento/demandas ligados a ela.' });
    }
  }
}

module.exports = {
  createLinkedSocialPost,
  syncInfluencerActionToSocialPost,
  markSocialPostPublished,
  deleteInfluencerTriad
};
