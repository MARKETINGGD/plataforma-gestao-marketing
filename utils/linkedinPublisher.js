// Publicador automático da LinkedIn (67ª rodada — "vamos para a proxima
// integração de API, vamos para o linkedin", depois da Meta já funcionando
// em produção). Mesmo padrão de utils/metaPublisher.js: um `setInterval`
// de verdade rodando sozinho no servidor, checando a cada poucos minutos
// se algum post agendado pra LinkedIn já venceu e tem conta conectada.
//
// Escopo: publica texto puro, texto + 1 imagem, texto + 1 vídeo, ou texto +
// VÁRIAS imagens (carrossel -- 78ª rodada, pedido explícito da Raquel:
// "LinkedIn deve aceitar carrossel", antes travado em "máximo 1 arquivo"),
// como a Página (organization) da marca conectada. O carrossel da LinkedIn
// (`multiImage`, ver utils/linkedinClient.js) só aceita IMAGEM — post com
// mais de 1 arquivo onde qualquer um deles é vídeo continua de fora da
// publicação automática (não existe "carrossel de vídeo" na API da
// LinkedIn), e segue 100% manual, como sempre foi.
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
// 76ª rodada, pedido explícito da Raquel: "Só a GhelPlus usa linkedin" --
// a De Bacco não tem Página própria da LinkedIn (mesmo espírito do
// Pinterest, só De Bacco -- não é limitação técnica, é só o que a Raquel
// pediu). Duranox e Boutique Inox entram quando tiverem Página própria.
const LINKEDIN_BRANDS = ['ghelplus'];
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

// 112ª rodada, correção de bugs reais (auditoria pedida pela Raquel):
// `publishStatus:'publishing'` é gravado ANTES de tentar publicar de
// verdade (ver publishOne) -- se o processo cair/reiniciar nesse meio
// tempo, o post ficava preso em 'publishing' pra sempre (isEligible
// sempre excluía qualquer post com publishStatus preenchido, e nada
// nunca resetava isso). Reconsidera (e reseta) um post travado em
// 'publishing' há mais de 15 minutos -- tempo generoso o bastante pra
// qualquer tentativa real terminar sozinha. Post sem
// `publishingStartedAt` (travado ANTES desta correção existir) também
// conta como travado -- é exatamente o cenário que motivou a correção.
const STUCK_PUBLISHING_MS = 15 * 60 * 1000;
function resetIfStuckPublishing(post) {
  if (post.publishStatus !== 'publishing') return;
  const startedAt = post.publishingStartedAt ? new Date(post.publishingStartedAt).getTime() : NaN;
  const stuckMs = Number.isNaN(startedAt) ? Infinity : Date.now() - startedAt;
  if (stuckMs < STUCK_PUBLISHING_MS) return;
  db.get('socialPosts').find({ id: post.id }).assign({ publishStatus: null, publishingStartedAt: null }).write();
}

// Token da conta expirado/prestes a expirar (112ª rodada) -- a LinkedIn
// guarda `tokenExpiresAt` (ver routes/socialAccounts.js); tentar publicar
// mesmo assim é o que dava um erro cru/genérico da própria API, em vez de
// uma mensagem clara (ver attemptPublish abaixo).
const TOKEN_EXPIRY_BUFFER_MS = 60 * 60 * 1000; // 1 hora de folga
function isAccountTokenExpiredOrExpiringSoon(account) {
  if (!account.tokenExpiresAt) return false;
  const expiresAt = new Date(account.tokenExpiresAt).getTime();
  if (Number.isNaN(expiresAt)) return false;
  return (expiresAt - Date.now()) <= TOKEN_EXPIRY_BUFFER_MS;
}

function isEligible(post) {
  resetIfStuckPublishing(post);
  if (post.publishStatus) return false;
  if (!isLinkedInAutoPublishSupported(post)) return false;
  // 112ª rodada: nunca publica sozinho um post ainda em Rascunho (só
  // 'agendado' quer dizer "pronto, só falta a hora chegar".
  // 128ª rodada, pedido explícito da Raquel: "os posts só devem se
  // postados nas redes sociais, se tiverem sido aprovados. Essa regra deve
  // sempre valer" -- reverte a decisão da 112ª rodada (que deixava a
  // aprovação OPCIONAL, publicando normalmente um post que nunca passou
  // por revisão nenhuma). Agora só publica sozinho um post com
  // approvalStatus 'aprovado' de verdade -- 'pendente' (nunca revisado) e
  // 'reprovado' ficam os dois de fora.
  if (post.status !== 'agendado') return false;
  if (post.approvalStatus !== 'aprovado') return false;
  // Legenda preenchida como confirmação de que o post está pronto — mesmo
  // critério já usado pela Meta (o texto vira o "commentary" do post).
  if (!post.caption || !post.caption.trim()) return false;
  // 78ª rodada: texto puro, 1 arquivo (imagem OU vídeo), ou VÁRIAS imagens
  // (carrossel) -- a única combinação que continua de fora é mais de 1
  // arquivo com QUALQUER vídeo no meio, porque a LinkedIn não tem
  // "carrossel de vídeo" (ver comentário no topo do arquivo).
  const files = post.files || [];
  if (files.length > 1 && files.some(isVideoFile)) return false;
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
  if (isAccountTokenExpiredOrExpiringSoon(account)) {
    throw new linkedinClient.LinkedInApiError('Token da conta expirado ou prestes a expirar -- reconecte a conta em Integrações.');
  }
  const files = post.files || [];
  const authorUrn = `urn:li:organization:${account.organizationId}`;
  let mediaUrn = null;
  let mediaUrns = null;
  function readFileBuffer(file) {
    const diskPath = diskPathForFile(file);
    if (!fs.existsSync(diskPath)) {
      throw new linkedinClient.LinkedInApiError(`Não encontrei o arquivo desse post no servidor (${file.name || file.url || 'sem nome'}) -- confirme se o upload terminou e edite o agendamento para tentar de novo.`);
    }
    return fs.readFileSync(diskPath);
  }
  if (files.length === 1) {
    const file = files[0];
    const buffer = readFileBuffer(file);
    mediaUrn = isVideoFile(file)
      ? await linkedinClient.uploadVideo({ accessToken: account.accessToken, ownerUrn: authorUrn, buffer })
      : await linkedinClient.uploadImage({ accessToken: account.accessToken, ownerUrn: authorUrn, buffer });
  } else if (files.length > 1) {
    // 78ª rodada, carrossel: isEligible() já garante que nenhum desses
    // arquivos é vídeo (a LinkedIn só aceita carrossel de imagem) --
    // sequencial de propósito, mesmo motivo de sempre (mais fácil de
    // acompanhar erro, não bate limite de conexões simultâneas).
    mediaUrns = [];
    for (const file of files) {
      const buffer = readFileBuffer(file);
      const urn = await linkedinClient.uploadImage({ accessToken: account.accessToken, ownerUrn: authorUrn, buffer });
      mediaUrns.push(urn);
    }
  }
  const created = await linkedinClient.createPost({
    accessToken: account.accessToken,
    authorUrn,
    commentary: post.caption,
    mediaUrn,
    mediaUrns
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

  db.get('socialPosts').find({ id: post.id }).assign({ publishStatus: 'publishing', publishingStartedAt: new Date().toISOString() }).write();
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
