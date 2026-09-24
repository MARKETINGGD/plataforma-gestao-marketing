// Publicador automático da LinkedIn (67ª rodada — "vamos para a proxima
// integração de API, vamos para o linkedin", depois da Meta já funcionando
// em produção). Mesmo padrão de utils/metaPublisher.js: um `setInterval`
// de verdade rodando sozinho no servidor, checando a cada poucos minutos
// se algum post agendado pra LinkedIn já venceu e tem conta conectada.
//
// Escopo desta 1ª versão (deliberadamente restrito, mesmo espírito de como
// a Meta cresceu aos poucos): publica texto puro, texto + 1 imagem, ou
// texto + 1 vídeo, como a Página (organization) da marca conectada. Post
// com MAIS de 1 arquivo (o equivalente a um "carrossel" da LinkedIn) fica
// de fora por enquanto — a LinkedIn até aceita múltiplas imagens num post,
// mas isso não foi pesquisado/implementado ainda; ver
// PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md seção 7 pra esse próximo passo
// candidato. Continua 100% manual pra qualquer post assim, como sempre foi.
//
// **Ainda sem nenhum teste real** (diferente da Meta) — a LinkedIn exige
// aprovação prévia do "Community Management API" antes de qualquer token
// funcionar de verdade (ver seção 7 do plano). Escrito estritamente contra
// a documentação oficial; pode precisar de ajuste no primeiro teste real,
// isolado em utils/linkedinClient.js pra trocar fácil sem mexer aqui.

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { nowSaoPaulo } = require('./pontoReminders');
const { createAutoRecado } = require('../routes/recados');
const linkedinClient = require('./linkedinClient');

const CHECK_INTERVAL_MS = 2 * 60 * 1000; // a cada 2 minutos, mesmo ritmo da Meta
// Só De Bacco e GhelPlus por enquanto — mesmas 2 marcas com Página
// pronta pra conectar na Meta (ver routes/socialAccounts.js). Duranox e
// Boutique Inox entram quando tiverem Página própria da LinkedIn.
const LINKEDIN_BRANDS = ['debacco', 'ghelplus'];
// Formato de vídeo aceito documentado pela própria LinkedIn (Videos API) —
// diferente da Meta, que aceita MP4 e MOV, a LinkedIn só documenta MP4.
const VIDEO_FILE_EXTENSIONS = ['.mp4'];
const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');

const BRAND_LABEL_PT = { debacco: 'De Bacco', ghelplus: 'GhelPlus' };

function scheduledDateTimeString(post) {
  return `${post.scheduledDate} ${post.scheduledTime || '00:00'}`;
}

function isDue(post) {
  const { dateStr, hhmm } = nowSaoPaulo();
  return scheduledDateTimeString(post) <= `${dateStr} ${hhmm}`;
}

// Combinação rede+marca que a publicação automática da LinkedIn sabe lidar
// — separado de isEligible() (mesmo motivo do isMetaAutoPublishSupported
// em metaPublisher.js) pra reaproveitar tanto no ciclo automático quanto
// na hora de alguém marcar "Publicado" na mão (ver routes/socialPosts.js).
function isLinkedInAutoPublishSupported({ platform, brand }) {
  if (platform !== 'linkedin') return false;
  if (!LINKEDIN_BRANDS.includes(brand)) return false;
  return true;
}

function isEligible(post) {
  if (post.publishStatus) return false;
  if (!isLinkedInAutoPublishSupported(post)) return false;
  // Legenda preenchida como confirmação de que o post está pronto — mesmo
  // critério já usado pela Meta (o texto vira o "commentary" do post).
  if (!post.caption || !post.caption.trim()) return false;
  // v1: só texto puro, 1 imagem ou 1 vídeo — mais de 1 arquivo (carrossel)
  // fica fora por enquanto, ver comentário do topo do arquivo.
  if ((post.files || []).length > 1) return false;
  if (!post.scheduledDate) return false;
  if (!isDue(post)) return false;
  return true;
}

function findConnectedAccount(brand) {
  return db.get('socialAccounts').find({ brand, platform: 'linkedin' }).value();
}

function isVideoFile(file) {
  const ext = path.extname((file && (file.url || file.name)) || '').toLowerCase();
  return VIDEO_FILE_EXTENSIONS.includes(ext);
}

// `file.url` é sempre "/uploads/..." (ver makeUpload em
// routes/socialPosts.js) -- diferente da Meta (que só precisa de uma URL
// pública pra Graph API baixar sozinha), a LinkedIn exige o envio do
// BINÁRIO de verdade (initializeUpload + PUT), por isso precisa ler o
// arquivo do disco aqui.
function diskPathForFile(file) {
  return path.join(UPLOADS_DIR, String(file.url || '').replace(/^\/uploads\//, ''));
}

async function attemptPublish(post, account) {
  const files = post.files || [];
  const authorUrn = `urn:li:organization:${account.organizationId}`;
  let mediaUrn = null;
  if (files.length === 1) {
    const file = files[0];
    const diskPath = diskPathForFile(file);
    if (!fs.existsSync(diskPath)) {
      throw new linkedinClient.LinkedInApiError(`Não encontrei o arquivo desse post no servidor (${file.name || file.url || 'sem nome'}) -- confirme se o upload terminou e edite o agendamento para tentar de novo.`);
    }
    const buffer = fs.readFileSync(diskPath);
    mediaUrn = isVideoFile(file)
      ? await linkedinClient.uploadVideo({ accessToken: account.accessToken, ownerUrn: authorUrn, buffer })
      : await linkedinClient.uploadImage({ accessToken: account.accessToken, ownerUrn: authorUrn, buffer });
  }
  const created = await linkedinClient.createPost({
    accessToken: account.accessToken,
    authorUrn,
    commentary: post.caption,
    mediaUrn
  });
  const externalPostId = created.id;
  const externalPermalink = linkedinClient.buildPermalink(externalPostId);
  return { externalPostId, externalPermalink };
}

// "Quem avisar" de FALHA/SUCESSO -- duplicado (não importado) de
// routes/socialPosts.js de propósito, mesmo motivo já documentado em
// metaPublisher.js: aquele arquivo EXIGE este aqui, então importar de lá
// pra cá criaria um require circular.
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
  const label = `LinkedIn · ${BRAND_LABEL_PT[post.brand] || post.brand}`;
  createAutoRecado({
    recipientIds: notifyRecipientIds(post),
    text: `Aviso Papoi: não consegui publicar sozinho seu post de ${label} (${post.scheduledDate}). Motivo: ${message}. Corrija e edite o agendamento para tentar de novo.`,
    postTitle: post.subject || label,
    postBrand: post.brand,
    postNetwork: post.platform,
    sourceSocialPostId: post.id
  });
}

function notifyPublishSuccess(post, externalUrl) {
  const label = `LinkedIn · ${BRAND_LABEL_PT[post.brand] || post.brand}`;
  const linkPart = externalUrl ? ' Clique aqui pra ver o post no ar.' : ' (não consegui montar o link direto dessa vez, mas publicou certinho.)';
  createAutoRecado({
    recipientIds: publishSuccessRecipientIds(post),
    text: `Papoi: o post de ${label} (${post.scheduledDate}) foi publicado com sucesso!${linkPart}`,
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
    const message = e instanceof linkedinClient.LinkedInApiError ? e.message : (e.message || 'Erro inesperado ao publicar.');
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
function startLinkedInPublisherScheduler() {
  if (started) return;
  started = true;
  setInterval(checkAndPublishScheduledPosts, CHECK_INTERVAL_MS);
}

module.exports = {
  LINKEDIN_BRANDS,
  startLinkedInPublisherScheduler,
  checkAndPublishScheduledPosts,
  isEligible,
  isDue,
  isLinkedInAutoPublishSupported,
  publishOne,
  findConnectedAccount
};
