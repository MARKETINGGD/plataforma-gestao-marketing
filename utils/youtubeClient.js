// Cliente fino pra API oficial do YouTube (69ª rodada, "amanhã ás 8 horas
// vamos começar a fazer a integração com o you tube" -- depois da Meta e da
// LinkedIn já implementadas, ver PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md,
// seção 8, pro histórico completo/checklist da Raquel). Mesmo espírito de
// utils/metaGraphClient.js e utils/linkedinClient.js: cada função faz UMA
// chamada HTTP pra API do Google/YouTube, sem nenhuma lógica de negócio --
// quem decide QUANDO chamar (fluxo de OAuth, publicador automático) fica em
// routes/socialAccounts.js e utils/youtubePublisher.js. Isolado num módulo
// próprio pelo mesmo motivo de sempre: os testes automatizados substituem
// estas funções por versões falsas, sem rede nem credenciais reais.
//
// **Diferença importante em relação à Meta/LinkedIn**: o YouTube usa OAuth
// do Google, não da própria rede -- o "access token" dura só ~1 hora (bem
// mais curto que os ~60 dias da Meta/LinkedIn), então a Papoi NUNCA guarda
// o access token, só o `refresh_token` (esse sim de longa duração -- desde
// que o App tenha saído do modo "Testing" no Google Cloud, onde ele expira
// sozinho em 7 dias, ver seção 8.1 do plano) e pede um access token novo
// (`refreshAccessToken`) toda vez que for publicar.

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3';

class YouTubeApiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'YouTubeApiError';
    this.details = details;
  }
}

// Passo 1 do OAuth: troca o "code" (que o Google devolveu no redirect) por
// um access token de curta duração + um refresh_token de longa duração. O
// Google só manda `refresh_token` de volta quando a autorização pede
// `prompt=consent` (ver routes/socialAccounts.js) -- sem isso, reconectar
// (ou uma 2ª marca com a mesma conta Google) pode devolver só o access
// token, sem jeito nenhum de renovar sozinho depois.
async function exchangeCodeForToken({ clientId, clientSecret, redirectUri, code }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new YouTubeApiError(json.error_description || json.error || `Erro ${res.status} ao trocar o code por token com o Google.`, json);
  }
  return json; // { access_token, expires_in, refresh_token, scope, token_type }
}

// Pega um access token novo a partir do refresh_token guardado -- chamado
// sempre antes de publicar (utils/youtubePublisher.js), já que o access
// token dura só ~1 hora e a Papoi nunca guarda ele entre um ciclo e outro.
async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new YouTubeApiError(json.error_description || json.error || `Erro ${res.status} renovando o acesso ao YouTube -- pode ser que a conexão tenha expirado (7 dias em modo de testes) e precise ser refeita em Integrações.`, json);
  }
  return json.access_token;
}

// Descobre qual canal está associado à autorização que acabou de acontecer
// -- diferente da Meta/LinkedIn (que listam VÁRIAS Páginas/organizations
// pra pessoa escolher depois), não existe uma chamada que liste "todos os
// canais que essa conta Google administra" -- só dá pra perguntar "qual é
// O canal desta conta" (`mine=true`).
//
// **Correção de um achado errado da 69ª rodada** (documentação original
// dizia que o Google devolvia "o canal que estava ativo no navegador NA
// HORA da autorização", e que por isso bastava trocar o canal ativo no
// seletor de contas do youtube.com antes de reconectar). Testado ao vivo
// na 73ª rodada tentando conectar a De Bacco depois da GhelPlus (mesma
// conta Google `marketingghelplus@gmail.com`): trocar o canal ativo no
// site NÃO mudou o que essa chamada devolve -- continuou vindo GhelPlus,
// mesmo numa janela anônima nova com o acesso da Papoi revogado antes e o
// canal De Bacco conferido como ativo. Ou seja, pelo menos pra essa conta,
// `channels.list?mine=true` resolve sempre pro canal "dono"/padrão da
// CONTA Google, não pro canal selecionado no site -- é a identidade da
// autorização OAuth, não uma preferência de navegação. Mitigação aplicada
// em `routes/socialAccounts.js` (`prompt: 'consent select_account'`): só
// ajuda se a 2ª marca tiver uma conta Google DIFERENTE como gerente dela;
// se não tiver, é um limite real da própria API do YouTube sem solução
// via código.
async function getMyChannel({ accessToken }) {
async function getMyChannel({ accessToken }) {
  const qs = new URLSearchParams({ part: 'snippet', mine: 'true' });
  const res = await fetch(`${API_BASE}/channels?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new YouTubeApiError((body.error && body.error.message) || `Erro ${res.status} consultando o canal do YouTube.`, body);
  }
  const channel = (body.items || [])[0];
  if (!channel) return null;
  return { channelId: channel.id, channelTitle: (channel.snippet || {}).title || null };
}

// ---------- Upload de vídeo (protocolo resumível em 2 chamadas) ----------
// 1) Inicializa a sessão de upload (manda metadados -- título/descrição/
//    privacidade -- e recebe de volta uma URL de sessão no cabeçalho
//    "Location"); 2) envia o binário de verdade nessa URL. Feito num PUT só
//    (sem quebrar em pedaços) -- os vídeos da Papoi não chegam nem perto do
//    limite de 256GB da API, então o upload "resumível de verdade" (com
//    pedaços e retomada em caso de queda de conexão) fica como melhoria
//    futura fácil de adicionar aqui sem mexer no resto do publicador.
async function initializeVideoUpload({ accessToken, fileSizeBytes, mimeType, title, description, privacyStatus }) {
  const qs = new URLSearchParams({ uploadType: 'resumable', part: 'snippet,status' });
  const res = await fetch(`${UPLOAD_BASE}/videos?${qs.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(fileSizeBytes),
      'X-Upload-Content-Type': mimeType
    },
    body: JSON.stringify({
      snippet: { title, description: description || '' },
      status: { privacyStatus: privacyStatus || 'public' }
    })
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new YouTubeApiError((body.error && body.error.message) || `Erro ${res.status} iniciando o upload do vídeo pro YouTube.`, body);
  }
  const uploadUrl = res.headers.get('location');
  if (!uploadUrl) {
    throw new YouTubeApiError('O YouTube não devolveu uma URL de upload -- tente de novo.');
  }
  return uploadUrl;
}

async function uploadVideo({ accessToken, buffer, mimeType, title, description, privacyStatus }) {
  const uploadUrl = await initializeVideoUpload({
    accessToken,
    fileSizeBytes: buffer.length,
    mimeType,
    title,
    description,
    privacyStatus
  });
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType, 'Content-Length': String(buffer.length) },
    body: buffer
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new YouTubeApiError((body.error && body.error.message) || `Erro ${res.status} enviando o arquivo pro YouTube.`, body);
  }
  return body.id; // ID do vídeo criado
}

// ---------- Capa/thumbnail (arquivo separado do vídeo em si) ----------
async function setThumbnail({ accessToken, videoId, buffer, mimeType }) {
  const qs = new URLSearchParams({ videoId });
  const res = await fetch(`${UPLOAD_BASE}/thumbnails/set?${qs.toString()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': mimeType },
    body: buffer
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new YouTubeApiError((body.error && body.error.message) || `Erro ${res.status} enviando a capa pro YouTube.`, body);
  }
}

function buildPermalink(videoId) {
  if (!videoId) return null;
  return `https://www.youtube.com/watch?v=${videoId}`;
}

module.exports = {
  YouTubeApiError,
  exchangeCodeForToken,
  refreshAccessToken,
  getMyChannel,
  uploadVideo,
  setThumbnail,
  buildPermalink
};
