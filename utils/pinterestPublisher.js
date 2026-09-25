// Publicador automático do Pinterest (75ª rodada — "vamos começar com
// pinterest, é apenas de bacco", depois da Meta, LinkedIn e YouTube já
// implementadas). Mesmo padrão de utils/metaPublisher.js/
// utils/youtubePublisher.js: um `setInterval` de verdade rodando sozinho no
// servidor, checando a cada 2 minutos (mesmo ritmo das outras 3 redes) se
// algum post agendado pro Pinterest já venceu e tem conta conectada.
//
// **Só a De Bacco usa Pinterest** (pedido explícito da Raquel) -- por isso
// `PINTEREST_BRANDS` tem 1 item só, ao contrário da Meta/LinkedIn/YouTube.
//
// Escopo desta 1ª versão: publica só o tipo "Pin" (`pin`, 1 imagem --
// mesmo formato 1000×1500 já usado na Prévia do Feed desde a 45ª rodada,
// ver public/app.js). Vídeo em Pin fica de fora por enquanto -- a API do
// Pinterest exige um protocolo de upload em 3 passos pra vídeo (registrar
// intenção, subir pro S3 da própria Pinterest, confirmar), bem mais
// trabalhoso que o `media_source.url` usado aqui pra imagem; candidato
// natural pra depois do 1º teste real funcionando. `subject` (assunto do
// post) vira o título do Pin; `caption` vira a descrição; `link` (campo já
// existente no Agendamento) vira o link de destino do Pin.

const db = require('../db');
const { nowSaoPaulo } = require('./pontoReminders');
const { createAutoRecado } = require('../routes/recados');
const pinterestClient = require('./pinterestClient');

const CHECK_INTERVAL_MS = 2 * 60 * 1000; // mesmo ritmo da Meta/LinkedIn/YouTube
// Só a De Bacco por enquanto (pedido explícito da Raquel, 75ª rodada) --
// ajuste fácil se a GhelPlus também ganhar Pinterest um dia.
const PINTEREST_BRANDS = ['debacco'];
const IMAGE_FILE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

const BRAND_LABEL_PT = { debacco: 'De Bacco', ghelplus: 'GhelPlus' };

// Credenciais do App do Pinterest -- lidas direto do ambiente aqui também
// (mesmo padrão de duplicação já usado pra BRANDS acima, ver comentário
// equivalente em routes/socialAccounts.js): o publicador precisa delas pra
// pedir um access token novo a cada ciclo (refresh_token dura ~1 ano, mas o
// access token em si só ~30 dias -- ver utils/pinterestClient.js).
const PINTEREST_CLIENT_ID = process.env.PINTEREST_CLIENT_ID || '';
const PINTEREST_CLIENT_SECRET = process.env.PINTEREST_CLIENT_SECRET || '';
const APP_BASE_URL = (process.env.PAPOI_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

function scheduledDateTimeString(post) {
  return `${post.scheduledDate} ${post.scheduledTime || '00:00'}`;
}

function isDue(post) {
  const { dateStr, hhmm } = nowSaoPaulo();
  return scheduledDateTimeString(post) <= `${dateStr} ${hhmm}`;
}

// Combinação rede+marca que a publicação automática do Pinterest sabe
// lidar -- separado de isEligible() pelo mesmo motivo de sempre
// (reaproveitar tanto no ciclo automático quanto na hora de marcar
// "Publicado" na mão, ver routes/socialPosts.js).
function isPinterestAutoPublishSupported({ platform, brand }) {
  if (platform !== 'pinterest') return false;
  if (!PINTEREST_BRANDS.includes(brand)) return false;
  return true;
}

function isImageFile(file) {
  const ext = require('path').extname((file && (file.url || file.name)) || '').toLowerCase();
  return IMAGE_FILE_EXTENSIONS.includes(ext);
}

function isEligible(post) {
  if (post.publishStatus) return false;
  if (!isPinterestAutoPublishSupported(post)) return false;
  // Assunto preenchido vira o TÍTULO do Pin -- mesmo espírito da legenda
  // obrigatória na Meta/YouTube, usado como critério de "pronto pra
  // publicar".
  if (!post.subject || !post.subject.trim()) return false;
  // v1: exige exatamente 1 arquivo, e que pareça imagem de verdade (vídeo
  // em Pin fica pra depois, ver comentário no topo do arquivo).
  const files = post.files || [];
  if (files.length !== 1 || !isImageFile(files[0])) return false;
  if (!post.scheduledDate) return false;
  if (!isDue(post)) return false;
  return true;
}

function findConnectedAccount(brand) {
  return db.get('socialAccounts').find({ brand, platform: 'pinterest' }).value();
}

async function attemptPublish(post, account) {
  const accessToken = await pinterestClient.refreshAccessToken({
    clientId: PINTEREST_CLIENT_ID,
    clientSecret: PINTEREST_CLIENT_SECRET,
    refreshToken: account.refreshToken
  });

  const file = (post.files || [])[0];
  // `file.url` já é público (servido em /uploads, ver server.js) -- o
  // Pinterest baixa a imagem sozinho a partir dessa URL, igual a Meta faz
  // (diferente do YouTube/LinkedIn, que exigem o binário de verdade).
  const imageUrl = `${APP_BASE_URL}${file.url}`;

  const pin = await pinterestClient.createPin({
    accessToken,
    boardId: account.boardId,
    imageUrl,
    title: post.subject.trim(),
    description: post.caption || '',
    link: post.link || undefined
  });

  const externalPermalink = pinterestClient.buildPermalink(pin.id);
  return { externalPostId: pin.id, externalPermalink };
}

// "Quem avisar" de FALHA/SUCESSO -- duplicado (não importado) de
// routes/socialPosts.js de propósito, mesmo motivo já documentado em
// metaPublisher.js/youtubePublisher.js: aquele arquivo EXIGE este aqui,
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
  const label = `Pinterest · ${BRAND_LABEL_PT[post.brand] || post.brand}`;
  createAutoRecado({
    recipientIds: notifyRecipientIds(post),
    text: `Aviso Papoi: não consegui publicar sozinho seu Pin de ${label} (${post.scheduledDate}). Motivo: ${message}. Corrija e edite o agendamento para tentar de novo.`,
    postTitle: post.subject || label,
    postBrand: post.brand,
    postNetwork: post.platform,
    sourceSocialPostId: post.id
  });
}

function notifyPublishSuccess(post, externalUrl) {
  const label = `Pinterest · ${BRAND_LABEL_PT[post.brand] || post.brand}`;
  const linkPart = externalUrl ? ' Clique aqui pra ver o Pin no ar.' : ' (não consegui montar o link direto dessa vez, mas publicou certinho.)';
  createAutoRecado({
    recipientIds: publishSuccessRecipientIds(post),
    text: `Papoi: o Pin de ${label} (${post.scheduledDate}) foi publicado com sucesso!${linkPart}`,
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
    const message = e instanceof pinterestClient.PinterestApiError ? e.message : (e.message || 'Erro inesperado ao publicar.');
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
function startPinterestPublisherScheduler() {
  if (started) return;
  started = true;
  setInterval(checkAndPublishScheduledPosts, CHECK_INTERVAL_MS);
}

module.exports = {
  PINTEREST_BRANDS,
  startPinterestPublisherScheduler,
  checkAndPublishScheduledPosts,
  isEligible,
  isDue,
  isPinterestAutoPublishSupported,
  publishOne,
  findConnectedAccount
};
