// Publicador automático da TikTok (76ª rodada — "Vamos para o tik tok,
// usamos ele na Ghel e na De Bacco, então precisaremos de 2 acessos",
// depois da Meta/LinkedIn/YouTube/Pinterest já implementadas). Mesmo
// padrão de sempre: um `setInterval` de verdade rodando sozinho no
// servidor, checando a cada poucos minutos se algum post agendado pra
// TikTok já venceu e tem conta conectada.
//
// Escopo desta 1ª versão: publica só o tipo "Vídeo TikTok"
// (`video_tiktok`, 1 arquivo de vídeo) — mesmo campo já usado pelo
// Agendamento (POST_TYPES em routes/socialPosts.js já tinha esse tipo
// reservado, igual aconteceu com `video_youtube` antes do YouTube ser
// implementado). `caption` (legenda) vira o `title` do post na TikTok —
// mesmo campo que a própria TikTok usa pra texto + hashtags + @menções,
// não um "título" curto como no YouTube.
//
// **Confirmado com a Raquel antes de implementar**: GhelPlus e De Bacco
// usam contas SEPARADAS na TikTok (login diferente cada uma) — evita de
// vez a novela de 6 rodadas do YouTube (conta compartilhada). Cada marca
// autoriza com o login certo, sem escolha nenhuma de "qual conta é qual"
// (ver utils/tiktokClient.js e routes/socialAccounts.js).
//
// **Sem nenhum teste real ainda** (mesmo aviso da LinkedIn antes da
// aprovação) — a TikTok só deixa publicar conteúdo PÚBLICO de verdade
// depois de uma auditoria própria do App; até lá, todo post sai em modo
// privado (SELF_ONLY) só pra quem está logado como a própria criadora.
// Escrito estritamente contra a documentação oficial; ver aviso maior em
// utils/tiktokClient.js.

const path = require('path');
const db = require('../db');
const { nowSaoPaulo } = require('./pontoReminders');
const { createAutoRecado } = require('../routes/recados');
const tiktokClient = require('./tiktokClient');

const CHECK_INTERVAL_MS = 2 * 60 * 1000; // mesmo ritmo da Meta/LinkedIn/YouTube/Pinterest
// 76ª rodada, pedido explícito da Raquel: "usamos ele na Ghel e na De
// Bacco" -- diferente do Pinterest/LinkedIn (só 1 marca cada), a TikTok
// entra pras 2, mesmo padrão de sempre da Meta/YouTube.
const TIKTOK_BRANDS = ['debacco', 'ghelplus'];
const VIDEO_FILE_EXTENSIONS = ['.mp4', '.mov', '.webm'];

const BRAND_LABEL_PT = { debacco: 'De Bacco', ghelplus: 'GhelPlus' };

// Credenciais do App da TikTok -- lidas direto do ambiente aqui também
// (mesmo padrão de duplicação já usado pras outras redes, ver comentário
// equivalente em routes/socialAccounts.js): o publicador precisa delas
// pra pedir um access token novo a cada publicação (ver aviso sobre o
// access token de 24h em utils/tiktokClient.js).
const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || '';
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || '';

// URL pública da própria Papoi -- mesmo padrão da Meta/Pinterest (a
// TikTok também baixa o arquivo sozinha a partir de uma URL, PULL_FROM_URL,
// diferente da LinkedIn/YouTube que exigem o binário de verdade).
const APP_BASE_URL = (process.env.PAPOI_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

function scheduledDateTimeString(post) {
  return `${post.scheduledDate} ${post.scheduledTime || '00:00'}`;
}

function isDue(post) {
  const { dateStr, hhmm } = nowSaoPaulo();
  return scheduledDateTimeString(post) <= `${dateStr} ${hhmm}`;
}

// Combinação rede+marca que a publicação automática da TikTok sabe lidar
// -- separado de isEligible() pelo mesmo motivo de sempre (reaproveitar
// tanto no ciclo automático quanto na hora de marcar "Publicado" na mão,
// ver routes/socialPosts.js).
function isTikTokAutoPublishSupported({ platform, brand }) {
  if (platform !== 'tiktok') return false;
  if (!TIKTOK_BRANDS.includes(brand)) return false;
  return true;
}

function isVideoFile(file) {
  const ext = path.extname((file && (file.url || file.name)) || '').toLowerCase();
  return VIDEO_FILE_EXTENSIONS.includes(ext);
}

function isEligible(post) {
  if (post.publishStatus) return false;
  if (!isTikTokAutoPublishSupported(post)) return false;
  // Legenda preenchida como confirmação de que o post está pronto --
  // mesmo critério já usado pela Meta/LinkedIn/Pinterest (o texto vira o
  // `title` do post na TikTok, com hashtags/menções inclusas).
  if (!post.caption || !post.caption.trim()) return false;
  // v1: exige exatamente 1 arquivo, e que pareça vídeo de verdade --
  // TikTok também aceita foto/carrossel numa API separada (Content
  // Posting API pra fotos), fora do escopo desta 1ª versão.
  const files = post.files || [];
  if (files.length !== 1 || !isVideoFile(files[0])) return false;
  if (!post.scheduledDate) return false;
  if (!isDue(post)) return false;
  return true;
}

function findConnectedAccount(brand) {
  return db.get('socialAccounts').find({ brand, platform: 'tiktok' }).value();
}

// Escolhe o nível de privacidade a pedir: `PUBLIC_TO_EVERYONE` se a
// consulta à criadora disser que já é permitido (App auditado), senão
// cai pro 1º nível que a própria TikTok liberar agora (pré-auditoria,
// deve vir só `SELF_ONLY`) -- nunca insiste em público se a API não
// oferecer essa opção, pra não tomar um erro de validação evitável. Ver
// aviso grande sobre isso em utils/tiktokClient.js.
function choosePrivacyLevel(privacyLevelOptions) {
  const options = privacyLevelOptions || [];
  if (options.includes('PUBLIC_TO_EVERYONE')) return 'PUBLIC_TO_EVERYONE';
  return options[0] || 'SELF_ONLY';
}

async function attemptPublish(post, account) {
  const refreshed = await tiktokClient.refreshAccessToken({
    clientKey: TIKTOK_CLIENT_KEY,
    clientSecret: TIKTOK_CLIENT_SECRET,
    refreshToken: account.refreshToken
  });
  const accessToken = refreshed.access_token;
  // Guarda o refresh_token mais novo (a TikTok pode rotacionar ele a cada
  // renovação) -- sem isso, uma renovação futura pode falhar com o
  // refresh_token antigo já invalidado.
  if (refreshed.refresh_token && refreshed.refresh_token !== account.refreshToken) {
    db.get('socialAccounts').find({ id: account.id }).assign({ refreshToken: refreshed.refresh_token }).write();
  }

  const file = (post.files || [])[0];
  const videoUrl = `${APP_BASE_URL}${file.url}`;

  const creatorInfo = await tiktokClient.queryCreatorInfo({ accessToken });
  const privacyLevel = choosePrivacyLevel(creatorInfo.privacyLevelOptions);

  const publishId = await tiktokClient.initDirectPostFromUrl({
    accessToken,
    videoUrl,
    title: post.caption,
    privacyLevel
  });
  await tiktokClient.waitForPublishComplete({ accessToken, publishId });

  // A TikTok não devolve um link direto pro post recém-criado (diferente
  // da Meta/LinkedIn/YouTube/Pinterest) -- só o perfil da criadora, que a
  // pessoa já sabe abrir sozinha pra conferir o vídeo mais recente.
  const externalPermalink = creatorInfo.creatorUsername ? `https://www.tiktok.com/@${creatorInfo.creatorUsername}` : null;
  return { externalPostId: publishId, externalPermalink, privacyLevel };
}

// "Quem avisar" de FALHA/SUCESSO -- duplicado (não importado) de
// routes/socialPosts.js de propósito, mesmo motivo de sempre: aquele
// arquivo EXIGE este aqui, então importar de lá pra cá criaria um
// require circular.
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
  const label = `TikTok · ${BRAND_LABEL_PT[post.brand] || post.brand}`;
  createAutoRecado({
    recipientIds: notifyRecipientIds(post),
    text: `Aviso Papoi: não consegui publicar sozinho seu vídeo de ${label} (${post.scheduledDate}). Motivo: ${message}. Corrija e edite o agendamento para tentar de novo.`,
    postTitle: post.subject || label,
    postBrand: post.brand,
    postNetwork: post.platform,
    sourceSocialPostId: post.id
  });
}

function notifyPublishSuccess(post, externalUrl, privacyLevel) {
  const label = `TikTok · ${BRAND_LABEL_PT[post.brand] || post.brand}`;
  // Enquanto o App não passar pela auditoria da TikTok, todo post sai
  // privado (SELF_ONLY) -- avisa isso no próprio recado, pra não parecer
  // que "sumiu" ou que deu errado quando na verdade só não está público
  // ainda (ver aviso grande em utils/tiktokClient.js).
  const privacyNote = privacyLevel && privacyLevel !== 'PUBLIC_TO_EVERYONE'
    ? ' (saiu em modo PRIVADO -- a TikTok só libera público depois de auditar o App, ver Integrações.)'
    : '';
  const linkPart = externalUrl ? ` Clique aqui pra ver o perfil.${privacyNote}` : ` (não consegui montar o link direto dessa vez, mas publicou certinho.)${privacyNote}`;
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
    const { externalPostId, externalPermalink, privacyLevel } = await attemptPublish(post, account);
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
    notifyPublishSuccess(post, externalPermalink, privacyLevel);
  } catch (e) {
    const message = e instanceof tiktokClient.TikTokApiError ? e.message : (e.message || 'Erro inesperado ao publicar.');
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
function startTikTokPublisherScheduler() {
  if (started) return;
  started = true;
  setInterval(checkAndPublishScheduledPosts, CHECK_INTERVAL_MS);
}

module.exports = {
  TIKTOK_BRANDS,
  startTikTokPublisherScheduler,
  checkAndPublishScheduledPosts,
  isEligible,
  isDue,
  isTikTokAutoPublishSupported,
  publishOne,
  findConnectedAccount,
  choosePrivacyLevel
};
