// Publicador automático da Meta (54ª rodada — conectar o Agendamento de
// Redes Sociais à API de verdade, pedido priorizado pela Raquel: Meta
// primeiro). Mesmo padrão de temporizador já usado em
// utils/pontoReminders.js (47ª rodada) — um `setInterval` de verdade rodando
// sozinho no servidor, já que publicar "no horário certo" não é algo que
// reage a uma ação de alguém.
//
// Escopo (deliberadamente restrito, pra sair do zero pro ar rápido): publica
// post ESTÁTICO (1 imagem) no Instagram ou Facebook, e CARROSSEL (2 a 10
// imagens) só no Instagram (8ª correção, 23/09/2026 — depois do Estático
// funcionar de verdade nas 2 marcas, a Raquel pediu Carrossel como próximo
// passo), pra marca com conta Meta conectada (De Bacco/GhelPlus, ver
// routes/socialAccounts.js). Reels e vídeo (TikTok/YouTube) NÃO são
// publicados sozinhos ainda — continuam 100% manuais, como sempre foram --
// a Graph API exige upload de arquivo de vídeo (não só apontar uma URL) e um
// processamento bem mais demorado, fica registrado como próxima etapa (ver
// PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md). Carrossel no Facebook (mecanismo
// de "múltiplas fotos" é diferente do Instagram — publica fotos avulsas
// primeiro, depois um post referenciando todas) também fica de fora por
// enquanto, mesmo motivo de escopo.

const db = require('../db');
const { nowSaoPaulo } = require('./pontoReminders');
const { createAutoRecado } = require('../routes/recados');
const metaGraph = require('./metaGraphClient');

const CHECK_INTERVAL_MS = 2 * 60 * 1000; // a cada 2 minutos
const AUTO_PUBLISH_PLATFORMS = ['instagram', 'facebook'];
const AUTO_PUBLISH_POST_TYPES = ['estatico', 'carrossel'];
// Carrossel só no Instagram por enquanto (ver comentário do topo do arquivo).
const CAROUSEL_PLATFORMS = ['instagram'];
// Limite de imagens por carrossel exigido pela própria Meta (não é uma
// escolha nossa) -- publicar com menos de 2 ou mais de 10 é rejeitado pela
// Graph API, então valida aqui ANTES de gastar uma chamada de verdade.
const CAROUSEL_MIN_ITEMS = 2;
const CAROUSEL_MAX_ITEMS = 10;
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
// de fora); (b) é Instagram ou Facebook; (c) é post Estático ou Carrossel
// (ver limitação de escopo no comentário do topo) — Carrossel só entra se
// for Instagram, Facebook fica de fora; (d) tem legenda e pelo menos 1
// arquivo (a quantidade EXATA de imagens do Carrossel — 2 a 10 — só é
// validada na hora de publicar, em attemptPublish, pra dar um erro claro
// em vez de deixar o post parado pra sempre sem nenhum aviso); (e) já
// chegou a data/hora agendada; (f) a marca do post tem conta Meta
// conectada.
function isEligible(post) {
  if (post.publishStatus) return false;
  if (!AUTO_PUBLISH_PLATFORMS.includes(post.platform)) return false;
  if (!AUTO_PUBLISH_POST_TYPES.includes(post.postType)) return false;
  if (post.postType === 'carrossel' && !CAROUSEL_PLATFORMS.includes(post.platform)) return false;
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

// Carrossel (8ª correção): cada imagem vira um container "filho", todos
// esperados ficarem prontos, depois combinados num container "pai" que é
// o que de fato se publica -- ver comentário completo em
// utils/metaGraphClient.js. Sequencial de propósito, mesmo motivo do loop
// principal em checkAndPublishScheduledPosts (evita bater rate limit da
// Graph API criando vários containers ao mesmo tempo).
async function publishInstagramCarousel(post, account) {
  const files = post.files || [];
  if (files.length < CAROUSEL_MIN_ITEMS || files.length > CAROUSEL_MAX_ITEMS) {
    throw new metaGraph.MetaGraphError(
      `Carrossel precisa de ${CAROUSEL_MIN_ITEMS} a ${CAROUSEL_MAX_ITEMS} imagens pra publicar no Instagram -- esse post tem ${files.length}. Ajuste as imagens e edite o agendamento pra tentar de novo.`
    );
  }
  const childIds = [];
  for (const file of files) {
    const imageUrl = `${APP_BASE_URL}${file.url}`;
    const child = await metaGraph.createInstagramCarouselChildContainer({
      igUserId: account.igUserId,
      pageAccessToken: account.pageAccessToken,
      imageUrl
    });
    await metaGraph.waitForMediaContainerReady({
      containerId: child.id,
      pageAccessToken: account.pageAccessToken
    });
    childIds.push(child.id);
  }
  const parent = await metaGraph.createInstagramCarouselContainer({
    igUserId: account.igUserId,
    pageAccessToken: account.pageAccessToken,
    childrenIds: childIds,
    caption: post.caption
  });
  await metaGraph.waitForMediaContainerReady({
    containerId: parent.id,
    pageAccessToken: account.pageAccessToken
  });
  const published = await metaGraph.publishInstagramMediaContainer({
    igUserId: account.igUserId,
    pageAccessToken: account.pageAccessToken,
    creationId: parent.id
  });
  return published.id;
}

async function attemptPublish(post, account) {
  const imageUrl = `${APP_BASE_URL}${post.files[0].url}`;
  let externalPostId;
  if (post.platform === 'instagram' && post.postType === 'carrossel') {
    externalPostId = await publishInstagramCarousel(post, account);
  } else if (post.platform === 'instagram') {
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
