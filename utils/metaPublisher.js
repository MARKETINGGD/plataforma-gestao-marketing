// Publicador automático da Meta (54ª rodada — conectar o Agendamento de
// Redes Sociais à API de verdade, pedido priorizado pela Raquel: Meta
// primeiro). Mesmo padrão de temporizador já usado em
// utils/pontoReminders.js (47ª rodada) — um `setInterval` de verdade rodando
// sozinho no servidor, já que publicar "no horário certo" não é algo que
// reage a uma ação de alguém.
//
// Escopo desta 1ª versão (deliberadamente restrito, pra sair do zero pro
// ar rápido): só publica post ESTÁTICO (1 imagem) no Instagram ou Facebook,
// pra marca com conta Meta conectada (De Bacco/GhelPlus, ver
// routes/socialAccounts.js). Carrossel, Reels e vídeo (TikTok/YouTube) NÃO
// são publicados sozinhos ainda — continuam 100% manuais, como sempre foram
// -- a Graph API exige um fluxo de container assíncrono bem mais complexo
// pra vídeo/carrossel, fica registrado como próxima etapa (ver
// PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md).

const db = require('../db');
const { nowSaoPaulo } = require('./pontoReminders');
const { createAutoRecado } = require('../routes/recados');
const metaGraph = require('./metaGraphClient');

const CHECK_INTERVAL_MS = 2 * 60 * 1000; // a cada 2 minutos
const AUTO_PUBLISH_PLATFORMS = ['instagram', 'facebook'];
const AUTO_PUBLISH_POST_TYPE = 'estatico';
const META_BRANDS = ['debacco', 'ghelplus'];
const APP_BASE_URL = (process.env.PAPOI_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

const PLATFORM_LABEL_PT = { instagram: 'Instagram', facebook: 'Facebook' };
const BRAND_LABEL_PT = { debacco: 'De Bacco', ghelplus: 'GhelPlus' };

function scheduledDateTimeString(post) {
  return `${post.scheduledDate} ${post.scheduledTime || '00:00'}`;
}

function isDue(post) {
  const { dateStr, hhmm } = nowSaoPaulo();
  return scheduledDateTimeString(post) <= `${dateStr} ${hhmm}`;
}

// Só entra na fila de publicação automática quem: (a) ainda não teve
// nenhuma tentativa (publishStatus null — 'failed' fica de fora até alguém
// editar algo, ver clearFailedPublishIfContentChanged em
// routes/socialPosts.js; 'published'/'publishing' obviamente também ficam
// de fora); (b) é Instagram ou Facebook; (c) é post estático (1 imagem —
// ver limitação de escopo no comentário do topo); (d) tem legenda e pelo
// menos 1 arquivo (a imagem em si); (e) já chegou a data/hora agendada;
// (f) a marca do post tem conta Meta conectada.
function isEligible(post) {
  if (post.publishStatus) return false;
  if (!AUTO_PUBLISH_PLATFORMS.includes(post.platform)) return false;
  if (post.postType !== AUTO_PUBLISH_POST_TYPE) return false;
  if (!META_BRANDS.includes(post.brand)) return false;
  if (!post.caption || !post.caption.trim()) return false;
  if (!(post.files || []).length) return false;
  if (!post.scheduledDate) return false;
  if (!isDue(post)) return false;
  return true;
}

function findConnectedAccount(brand) {
  return db.get('socialAccounts').find({ brand, platform: 'meta' }).value();
}

async function attemptPublish(post, account) {
  const imageUrl = `${APP_BASE_URL}${post.files[0].url}`;
  let externalPostId;
  if (post.platform === 'instagram') {
    const container = await metaGraph.createInstagramMediaContainer({
      igUserId: account.igUserId,
      pageAccessToken: account.pageAccessToken,
      imageUrl,
      caption: post.caption
    });
    // 7ª correção: espera a Meta terminar de baixar/processar a imagem
    // antes de publicar -- publicar cedo demais é o que causava o erro
    // "Media ID is not available" (achado ao vivo pela Raquel, só na De
    // Bacco -- provavelmente por causa do tamanho/tempo de download da
    // imagem daquele post específico). Ver comentário completo em
    // utils/metaGraphClient.js.
    await metaGraph.waitForMediaContainerReady({
      containerId: container.id,
      pageAccessToken: account.pageAccessToken
    });
    const published = await metaGraph.publishInstagramMediaContainer({
      igUserId: account.igUserId,
      pageAccessToken: account.pageAccessToken,
      creationId: container.id
    });
    externalPostId = published.id;
  } else {
    const published = await metaGraph.publishFacebookPagePost({
      pageId: account.pageId,
      pageAccessToken: account.pageAccessToken,
      message: post.caption,
      imageUrl
    });
    externalPostId = published.post_id || published.id;
  }
  let externalPermalink = null;
  try {
    externalPermalink = await metaGraph.getPermalink({ objectId: externalPostId, pageAccessToken: account.pageAccessToken });
  } catch (e) {
    // Link clicável é só um extra pra tela -- publicação já valeu mesmo
    // sem conseguir o permalink (não derruba o sucesso por causa disso).
  }
  return { externalPostId, externalPermalink };
}

function notifyPublishFailure(post, message) {
  const recipientIds = post.responsibleId
    ? [post.responsibleId]
    : Array.from(new Set([post.createdBy, ...(post.involvedUserIds || [])].filter(Boolean)));
  const label = `${PLATFORM_LABEL_PT[post.platform] || post.platform} · ${BRAND_LABEL_PT[post.brand] || post.brand}`;
  createAutoRecado({
    recipientIds,
    text: `Aviso Papoi: não consegui publicar sozinho seu post de ${label} (${post.scheduledDate}). Motivo: ${message}. Corrija e edite o agendamento para tentar de novo.`,
    postTitle: post.subject || label,
    postBrand: post.brand,
    postNetwork: post.platform,
    sourceSocialPostId: post.id
  });
}

async function publishOne(post) {
  const account = findConnectedAccount(post.brand);
  // Conta pode ter sido desconectada entre a checagem da lista e aqui --
  // nesse caso simplesmente não faz nada (post continua null, tenta nas
  // próximas rodadas caso a conta seja reconectada).
  if (!account) return;

  db.get('socialPosts').find({ id: post.id }).assign({ publishStatus: 'publishing' }).write();
  try {
    const { externalPostId, externalPermalink } = await attemptPublish(post, account);
    const updates = {
      publishStatus: 'published',
      externalPostId,
      externalPermalink,
      publishError: null,
      updatedAt: new Date().toISOString()
    };
    // Publicado de verdade = publicado, ponto -- mesma cascata de conclusão
    // automática de Demandas que já existe pra quando alguém marca "Publicado"
    // manualmente (ver PUT /:id em routes/socialPosts.js), sem duplicar a
    // lógica aqui (require preguiçoso evita ciclo de require no topo do
    // arquivo).
    if (post.status !== 'publicado') updates.status = 'publicado';
    db.get('socialPosts').find({ id: post.id }).assign(updates).write();
    if (updates.status === 'publicado') {
      const { cascadeCompleteDemandas } = require('./demandCascade');
      // Sem `req` (terceiro argumento null) -- ação automática do sistema,
      // sem usuário logado; cascadeCompleteDemandas já lida com isso (só
      // pula o registro de Histórico, completa as demandas do mesmo jeito).
      cascadeCompleteDemandas(post.id, null, null);
    }
  } catch (e) {
    const message = e instanceof metaGraph.MetaGraphError ? e.message : (e.message || 'Erro inesperado ao publicar.');
    db.get('socialPosts').find({ id: post.id }).assign({
      publishStatus: 'failed',
      publishError: message,
      updatedAt: new Date().toISOString()
    }).write();
    notifyPublishFailure(post, message);
  }
}

let running = false;
async function checkAndPublishScheduledPosts() {
  if (running) return; // evita 2 rodadas simultâneas se uma publicação demorar mais que o intervalo
  running = true;
  try {
    const eligible = db.get('socialPosts').value().filter(isEligible);
    // Sequencial de propósito (não Promise.all) -- evita bater rate limit da
    // Graph API publicando vários posts ao mesmo tempo, e mantém os logs de
    // erro fáceis de ler um de cada vez.
    for (const post of eligible) {
      await publishOne(post);
    }
  } finally {
    running = false;
  }
}

let started = false;
function startMetaPublisherScheduler() {
  if (started) return; // idempotente, mesmo padrão do pontoReminders.js
  started = true;
  setInterval(checkAndPublishScheduledPosts, CHECK_INTERVAL_MS);
}

module.exports = {
  startMetaPublisherScheduler,
  // Exportados só pra teste automatizado poder chamar sob demanda / inspecionar,
  // sem esperar o setInterval de verdade rodar (mesmo padrão de
  // utils/pontoReminders.js).
  checkAndPublishScheduledPosts,
  isEligible,
  isDue
};
