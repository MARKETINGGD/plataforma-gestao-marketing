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

// 112ª rodada, correção de bugs reais (auditoria pedida pela Raquel):
// `publishStatus:'publishing'` é gravado ANTES de tentar publicar de
// verdade (ver publishOne) -- se o processo cair/reiniciar nesse meio
// tempo, o post ficava preso em 'publishing' pra sempre (isEligible
// sempre excluía qualquer post com publishStatus preenchido, e nada
// nunca resetava isso). Reconsidera (e reseta) um post travado em
// 'publishing' há mais de 15 minutos -- tempo generoso o bastante pra
// qualquer tentativa real (upload de vídeo incluso) terminar sozinha.
// Post sem `publishingStartedAt` (travado ANTES desta correção existir)
// também conta como travado -- é exatamente o cenário que motivou a
// correção.
const STUCK_PUBLISHING_MS = 15 * 60 * 1000;
function resetIfStuckPublishing(post) {
  if (post.publishStatus !== 'publishing') return;
  const startedAt = post.publishingStartedAt ? new Date(post.publishingStartedAt).getTime() : NaN;
  const stuckMs = Number.isNaN(startedAt) ? Infinity : Date.now() - startedAt;
  if (stuckMs < STUCK_PUBLISHING_MS) return;
  db.get('socialPosts').find({ id: post.id }).assign({ publishStatus: null, publishingStartedAt: null }).write();
}

// Token da conta expirado/prestes a expirar (112ª rodada) -- o YouTube não
// guarda `tokenExpiresAt` (renova o access token a cada publicação, ver
// attemptPublish abaixo) -- esta checagem fica de fora de propósito nenhum
// pra essa rede (nunca acha `tokenExpiresAt` definido), só existe aqui pra
// manter a MESMA checagem/mensagem nos 5 publicadores, caso a conta ganhe
// esse campo no futuro.
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
  if (!isYouTubeAutoPublishSupported(post)) return false;
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

// Confirmação de processamento (112ª rodada) -- o upload binário só
// devolve o `id` do vídeo; isso NÃO quer dizer que o YouTube já terminou
// de processar o arquivo (`status.uploadStatus` começa em 'uploaded', só
// vira 'processed' quando termina de verdade, ou 'failed'/'rejected' se
// der errado). Faz um polling curto, mesmo espírito (não os mesmos
// valores) do polling de status já usado pela TikTok (ver
// waitForPublishComplete em utils/tiktokClient.js) -- timeout bem mais
// curto que o da TikTok de propósito: vídeo do YouTube pode legitimamente
// demorar bem mais que isso pra sair de 'uploaded' (processamento
// bem mais pesado), então o timeout aqui NÃO é tratado como falha --
// só vira um aviso, pra não travar o post pra sempre nem bloquear a fila
// (o publicador roda de 2 em 2 minutos) por um processamento que pode
// legitimamente continuar rolando por mais tempo do lado do YouTube.
const VIDEO_STATUS_POLL_INTERVAL_MS = 5000;
const VIDEO_STATUS_POLL_TIMEOUT_MS = 90 * 1000; // 1min30s
// `failureReason` e `rejectionReason` são campos DIFERENTES da API do
// YouTube (enums próprios cada um) -- junta os dois num dicionário só
// porque só um dos dois vem preenchido por vez (ver getVideoStatus em
// utils/youtubeClient.js), nunca os dois juntos.
const FAILURE_REASON_LABEL_PT = {
  // status.failureReason (erro técnico processando o arquivo)
  codec: 'codec de vídeo/áudio não suportado',
  conversion: 'erro convertendo o arquivo',
  emptyFile: 'arquivo vazio',
  invalidFile: 'arquivo inválido/corrompido',
  tooSmall: 'arquivo pequeno demais',
  uploadAborted: 'o upload foi interrompido antes de terminar',
  // status.rejectionReason (recusado por política/conteúdo)
  claim: 'reivindicação de direitos autorais sobre o conteúdo',
  copyright: 'violação de direitos autorais',
  duplicate: 'vídeo duplicado',
  inappropriate: 'conteúdo considerado inadequado',
  legal: 'motivo legal',
  length: 'duração do vídeo fora do permitido',
  termsOfUse: 'violação dos termos de uso do YouTube',
  trademark: 'violação de marca registrada',
  uploaderAccountClosed: 'a conta do canal foi fechada',
  uploaderAccountSuspended: 'a conta do canal foi suspensa'
};
async function waitForVideoProcessed({ accessToken, videoId, pollIntervalMs = VIDEO_STATUS_POLL_INTERVAL_MS, timeoutMs = VIDEO_STATUS_POLL_TIMEOUT_MS }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    last = await youtubeClient.getVideoStatus({ accessToken, videoId });
    const uploadStatus = last && last.uploadStatus;
    // 'uploaded' é o único status "ainda processando" -- qualquer outra
    // coisa (processed/failed/rejected/deleted, ou nulo se a consulta não
    // achou o vídeo) já é uma resposta final, sai do polling.
    if (uploadStatus !== 'uploaded') return { ...(last || {}), timedOut: false };
    if (Date.now() >= deadline) return { ...(last || {}), timedOut: true };
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

async function attemptPublish(post, account) {
  if (isAccountTokenExpiredOrExpiringSoon(account)) {
    throw new youtubeClient.YouTubeApiError('Token da conta expirado ou prestes a expirar -- reconecte a conta em Integrações.');
  }
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

  // 112ª rodada: só marca como publicado de verdade depois do YouTube
  // confirmar que o processamento terminou -- ver waitForVideoProcessed
  // acima. Falha/rejeição de verdade vira erro (mesmo tratamento de
  // qualquer outra falha de publicação); timeout do polling NÃO trava o
  // fluxo, só vira um aviso junto com o recado de sucesso (o vídeo pode
  // legitimamente ainda estar processando do lado do YouTube).
  const processedStatus = await waitForVideoProcessed({ accessToken, videoId });
  let processingWarning = null;
  if (processedStatus.uploadStatus === 'failed' || processedStatus.uploadStatus === 'rejected') {
    const motivo = FAILURE_REASON_LABEL_PT[processedStatus.failureReason] || FAILURE_REASON_LABEL_PT[processedStatus.rejectionReason] || processedStatus.failureReason || processedStatus.rejectionReason || 'motivo não informado';
    throw new youtubeClient.YouTubeApiError(`O YouTube recusou o vídeo depois do upload (status: ${processedStatus.uploadStatus}, motivo: ${motivo}). Confira o arquivo/conta e edite o agendamento para tentar de novo.`);
  }
  if (processedStatus.timedOut) {
    processingWarning = `o YouTube ainda estava processando o vídeo depois de ${Math.round(VIDEO_STATUS_POLL_TIMEOUT_MS / 1000)}s -- pode levar mais tempo pra ficar disponível publicamente, confira novamente em alguns minutos.`;
  }

  const externalPermalink = youtubeClient.buildPermalink(videoId);
  return { externalPostId: videoId, externalPermalink, processingWarning };
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

function notifyPublishSuccess(post, externalUrl, warning) {
  const label = `YouTube · ${BRAND_LABEL_PT[post.brand] || post.brand}`;
  const linkPart = externalUrl ? ' Clique aqui pra ver o vídeo no ar.' : ' (não consegui montar o link direto dessa vez, mas publicou certinho.)';
  const warningPart = warning ? ` Aviso: ${warning}` : '';
  createAutoRecado({
    recipientIds: publishSuccessRecipientIds(post),
    text: `Papoi: o vídeo de ${label} (${post.scheduledDate}) foi publicado com sucesso!${linkPart}${warningPart}`,
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
    const { externalPostId, externalPermalink, processingWarning } = await attemptPublish(post, account);
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
    notifyPublishSuccess(post, externalPermalink, processingWarning);
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
