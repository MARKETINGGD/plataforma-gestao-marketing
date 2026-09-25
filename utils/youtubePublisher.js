// Publicador automático do YouTube (69ª rodada — "amanhã ás 8 horas vamos
// começar a fazer a integração com o you tube", depois da Meta e da
// LinkedIn já implementadas). Mesmo padrão de utils/metaPublisher.js e
// utils/linkedinPublisher.js: um `setInterval` de verdade rodando sozinho
// no servidor, checando a cada poucos minutos se algum post agendado pro
// YouTube já venceu e tem conta conectada.
//
// **Decisão da Raquel (25/09/2026, antes de começar a implementação)**:
// manter o MESMO ciclo de publicador de 2 em 2 minutos que a Meta e a
// LinkedIn já usam ("Opção A"), em vez do agendamento nativo do próprio
// YouTube (`publishAt`, "Opção B") — mantém o comportamento igual nas 3
// redes, mais simples de explicar pro time e de dar manutenção depois (ver
// PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md, seção 8.2). Por isso o vídeo
// sobe DIRETO como `public` na hora certa, sem passar por um estado
// "privado, esperando o YouTube liberar sozinho".
//
// Escopo desta 1ª versão: publica só o tipo "Vídeo YouTube"
// (`video_youtube`, 1 arquivo de vídeo + capa/thumbnail opcional) — mesmo
// campo já usado pelo Agendamento desde a 45ª rodada. `subject` (assunto do
// post) vira o título do vídeo; `caption` vira a descrição.

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { nowSaoPaulo } = require('./pontoReminders');
const { createAutoRecado } = require('../routes/recados');
const youtubeClient = require('./youtubeClient');

const CHECK_INTERVAL_MS = 2 * 60 * 1000; // mesmo ritmo da Meta/LinkedIn
// Mesmas 2 marcas com canal pronto pra conectar na Meta/LinkedIn — ajuste
// fácil se Duranox/Boutique Inox ganharem canal próprio um dia.
const YOUTUBE_BRANDS = ['debacco', 'ghelplus'];
const VIDEO_FILE_EXTENSIONS = ['.mp4', '.mov'];
const THUMBNAIL_MIME_BY_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');
// Título do vídeo (snippet.title) tem limite de 100 caracteres na própria
// API do YouTube -- corta em vez de deixar o Google rejeitar a chamada.
const TITLE_MAX_LENGTH = 100;

const BRAND_LABEL_PT = { debacco: 'De Bacco', ghelplus: 'GhelPlus' };

// Credenciais do App do Google -- lidas direto do ambiente aqui também
// (mesmo padrão de duplicação já usado pra BRANDS acima, ver comentário
// equivalente em routes/socialAccounts.js): o publicador precisa delas pra
// pedir um access token novo (refresh_token nunca expira sozinho por uso,
// só por inatividade/modo de testes -- ver utils/youtubeClient.js).
const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID || '';
const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET || '';

function scheduledDateTimeString(post) {
  return `${post.scheduledDate} ${post.scheduledTime || '00:00'}`;
}

function isDue(post) {
  const { dateStr, hhmm } = nowSaoPaulo();
  return scheduledDateTimeString(post) <= `${dateStr} ${hhmm}`;
}

// Combinação rede+marca que a publicação automática do YouTube sabe lidar —
// separado de isEligible() pelo mesmo motivo de sempre (reaproveitar tanto
// no ciclo automático quanto na hora de marcar "Publicado" na mão, ver
// routes/socialPosts.js).
function isYouTubeAutoPublishSupported({ platform, brand }) {
  if (platform !== 'youtube') return false;
  if (!YOUTUBE_BRANDS.includes(brand)) return false;
  return true;
}

function isVideoFile(file) {
  const ext = path.extname((file && (file.url || file.name)) || '').toLowerCase();
  return VIDEO_FILE_EXTENSIONS.includes(ext);
}

function isEligible(post) {
  if (post.publishStatus) return false;
  if (!isYouTubeAutoPublishSupported(post)) return false;
  // Assunto preenchido vira o TÍTULO do vídeo no YouTube — a própria API
  // exige um título não-vazio, então isso também é o critério de "pronto
  // pra publicar" (mesmo espírito da legenda obrigatória na Meta/LinkedIn).
  if (!post.subject || !post.subject.trim()) return false;
  // v1: exige exatamente 1 arquivo, e que pareça vídeo de verdade.
  const files = post.files || [];
  if (files.length !== 1 || !isVideoFile(files[0])) return false;
  if (!post.scheduledDate) return false;
  if (!isDue(post)) return false;
  return true;
}

function findConnectedAccount(brand) {
  return db.get('socialAccounts').find({ brand, platform: 'youtube' }).value();
}

// `file.url` é sempre "/uploads/..." (ver makeUpload em
// routes/socialPosts.js) -- igual à LinkedIn, o YouTube exige o envio do
// BINÁRIO de verdade, por isso precisa ler o arquivo do disco aqui.
function diskPathForFile(file) {
  return path.join(UPLOADS_DIR, String(file.url || '').replace(/^\/uploads\//, ''));
}

function mimeTypeForVideo(file) {
  const ext = path.extname((file && (file.url || file.name)) || '').toLowerCase();
  return ext === '.mov' ? 'video/quicktime' : 'video/mp4';
}

async function attemptPublish(post, account) {
  const accessToken = await youtubeClient.refreshAccessToken({
    clientId: YOUTUBE_CLIENT_ID,
    clientSecret: YOUTUBE_CLIENT_SECRET,
    refreshToken: account.refreshToken
  });

  const file = (post.files || [])[0];
  const diskPath = diskPathForFile(file);
  if (!fs.existsSync(diskPath)) {
    throw new youtubeClient.YouTubeApiError(`Não encontrei o arquivo desse post no servidor (${file.name || file.url || 'sem nome'}) -- confirme se o upload terminou e edite o agendamento para tentar de novo.`);
  }
  const buffer = fs.readFileSync(diskPath);
  const title = post.subject.trim().slice(0, TITLE_MAX_LENGTH);
  const videoId = await youtubeClient.uploadVideo({
    accessToken,
    buffer,
    mimeType: mimeTypeForVideo(file),
    title,
    description: post.caption || '',
    privacyStatus: 'public'
  });

  // Capa/thumbnail (mesmo campo já usado desde a 45ª rodada) -- opcional:
  // uma falha aqui não desfaz o vídeo já publicado, só fica sem capa
  // customizada (o YouTube usa um frame automático do próprio vídeo nesse
  // caso).
  if (post.thumbnailFile && post.thumbnailFile.url) {
    try {
      const thumbPath = diskPathForFile(post.thumbnailFile);
      if (fs.existsSync(thumbPath)) {
        const thumbBuffer = fs.readFileSync(thumbPath);
        const ext = path.extname(post.thumbnailFile.url).toLowerCase();
        const mimeType = THUMBNAIL_MIME_BY_EXT[ext] || 'image/jpeg';
        await youtubeClient.setThumbnail({ accessToken, videoId, buffer: thumbBuffer, mimeType });
      }
    } catch (e) {
      // Não interrompe a publicação por causa da capa -- só o vídeo em si
      // é obrigatório.
    }
  }

  const externalPermalink = youtubeClient.buildPermalink(videoId);
  return { externalPostId: videoId, externalPermalink };
}

// "Quem avisar" de FALHA/SUCESSO -- duplicado (não importado) de
// routes/socialPosts.js de propósito, mesmo motivo já documentado em
// metaPublisher.js/linkedinPublisher.js: aquele arquivo EXIGE este aqui,
// então importar de lá pra cá criaria um require circular.
function notifyRecipientIds(post) {
  return post.responsibleId
    ? [post.responsibleId]
    : Array.from(new Set([post.createdBy, ...(post.involvedUserIds || [])].filter(Boolean)));
}

function publishSuccessRecipientIds(post) {
  const gerenciaIds = db.get('users').value()
    .filter((u) => u.cargo === 'gerente' || u.cargo === 'coordenador')
    .map((u) => u.id);
  return Array.from(new Set([...notifyRecipientIds(post), ...gerenciaIds]));
}

function notifyPublishFailure(post, message) {
  const label = `YouTube · ${BRAND_LABEL_PT[post.brand] || post.brand}`;
  createAutoRecado({
    recipientIds: notifyRecipientIds(post),
    text: `Aviso Papoi: não consegui publicar sozinho seu vídeo de ${label} (${post.scheduledDate}). Motivo: ${message}. Corrija e edite o agendamento para tentar de novo.`,
    postTitle: post.subject || label,
    postBrand: post.brand,
    postNetwork: post.platform,
    sourceSocialPostId: post.id
  });
}

function notifyPublishSuccess(post, externalUrl) {
  const label = `YouTube · ${BRAND_LABEL_PT[post.brand] || post.brand}`;
  const linkPart = externalUrl ? ' Clique aqui pra ver o vídeo no ar.' : ' (não consegui montar o link direto dessa vez, mas publicou certinho.)';
  createAutoRecado({
    recipientIds: publishSuccessRecipientIds(post),
    text: `Papoi: o vídeo de ${label} (${post.scheduledDate}) foi publicado com sucesso!${linkPart}`,
    postTitle: post.subject || label,
    postBrand: post.brand,
    postNetwork: post.platform,
    sourceSocialPostId: post.id,
    externalUrl,
    kind: 'post_published'
  });
}

async function publishOne(post) {
  const account = findConnectedAccount(post.brand);
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
    if (post.status !== 'publicado') updates.status = 'publicado';
    db.get('socialPosts').find({ id: post.id }).assign(updates).write();
    if (updates.status === 'publicado') {
      const { cascadeCompleteDemandas } = require('./demandCascade');
      cascadeCompleteDemandas(post.id, null, null);
    }
    notifyPublishSuccess(post, externalPermalink);
  } catch (e) {
    const message = e instanceof youtubeClient.YouTubeApiError ? e.message : (e.message || 'Erro inesperado ao publicar.');
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
  if (running) return;
  running = true;
  try {
    const eligible = db.get('socialPosts').value().filter(isEligible);
    for (const post of eligible) {
      await publishOne(post);
    }
  } finally {
    running = false;
  }
}

let started = false;
function startYouTubePublisherScheduler() {
  if (started) return;
  started = true;
  setInterval(checkAndPublishScheduledPosts, CHECK_INTERVAL_MS);
}

module.exports = {
  YOUTUBE_BRANDS,
  startYouTubePublisherScheduler,
  checkAndPublishScheduledPosts,
  isEligible,
  isDue,
  isYouTubeAutoPublishSupported,
  publishOne,
  findConnectedAccount
};
