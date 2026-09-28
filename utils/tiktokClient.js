// Cliente fino pra API oficial da TikTok (76ª rodada, pedido da Raquel:
// "Vamos para o tik tok, usamos ele na Ghel e na De Bacco, então
// precisaremos de 2 acessos" -- confirmado que são contas SEPARADAS, com
// login diferente pra cada marca, então nenhuma escolha de "qual conta é
// qual" precisa acontecer aqui (diferente da novela de 6 rodadas do
// YouTube por causa de conta compartilhada) -- cada marca simplesmente
// autoriza com o login certo, e a autorização já devolve só a criadora
// daquele login. Mesmo espírito de metaGraphClient.js/linkedinClient.js/
// youtubeClient.js/pinterestClient.js: cada função faz UMA chamada HTTP,
// sem nenhuma lógica de negócio -- isso fica em routes/socialAccounts.js
// e utils/tiktokPublisher.js. Isolado num módulo próprio pelo motivo de
// sempre: os testes automatizados trocam estas funções por versões
// falsas, sem rede nem credenciais reais.
//
// Escrito estritamente contra a documentação oficial da TikTok for
// Developers ("Content Posting API", "Login Kit for Web", "Manage User
// Access Tokens"), pesquisada ao vivo nesta rodada -- **ainda sem nenhum
// teste real** (mesmo aviso já usado pra LinkedIn/YouTube antes do 1º
// teste de verdade): pode precisar de ajuste no 1º teste, isolado aqui
// pra trocar fácil sem mexer no resto.
//
// **Ponto de atenção real, documentado logo de cara**: diferente das
// outras 4 redes, o access token da TikTok dura só 24 HORAS (bem mais
// curto até que o ~1h do Google) -- a Papoi por isso NUNCA guarda o
// access token entre um ciclo e outro, só o `refresh_token` (esse sim
// dura ~365 dias) e pede um access token novo (refreshAccessToken) toda
// vez antes de publicar, mesmo padrão já usado pro YouTube.
//
// **Limite de "App não auditado"**: todo conteúdo publicado por um App
// que ainda não passou pela auditoria da própria TikTok sai só em modo
// PRIVADO (`SELF_ONLY`) -- não tem como forçar público por parâmetro
// nenhum, é a própria TikTok quem decide isso do lado dela. É por isso
// que `attemptPublish` (ver utils/tiktokPublisher.js) sempre consulta
// `queryCreatorInfo` antes de publicar: `privacy_level_options` ali
// devolve, pra ESSA criadora e ESSE App, quais níveis de privacidade
// valem agora -- pré-auditoria só deve vir `SELF_ONLY`; depois de
// aprovado o App, a própria API passa a listar `PUBLIC_TO_EVERYONE`
// sozinha, sem precisar mudar nada aqui.

const OAUTH_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const API_BASE = 'https://open.tiktokapis.com/v2';

class TikTokApiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'TikTokApiError';
    this.details = details;
  }
}

// Endpoints de dados (creator_info/publish/status) embrulham TUDO --
// sucesso incluso -- num objeto `error` com `code`/`message`/`log_id`;
// sucesso de verdade vem com `code: 'ok'` (confirmado contra a própria
// documentação da TikTok). Só os 2 endpoints de OAuth abaixo usam o
// formato clássico (`error`/`error_description` direto na raiz).
function checkDataApiError(json, fallbackMessage) {
  const err = json && json.error;
  if (err && err.code && err.code !== 'ok') {
    throw new TikTokApiError(err.message || fallbackMessage, err);
  }
}

// Passo 1 do OAuth: troca o "code" (devolvido no redirect) por um access
// token de 24h + um refresh_token de ~365 dias.
async function exchangeCodeForToken({ clientKey, clientSecret, redirectUri, code }) {
  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error_description || (json.error && typeof json.error === 'string')) {
    throw new TikTokApiError(json.error_description || json.error || `Erro ${res.status} ao trocar o code por token com a TikTok.`, json);
  }
  return json; // { access_token, refresh_token, expires_in, refresh_expires_in, open_id, scope, token_type }
}

// Pega um access token novo a partir do refresh_token guardado -- chamado
// sempre antes de publicar (utils/tiktokPublisher.js), já que o access
// token dura só 24h (ver aviso no topo do arquivo).
async function refreshAccessToken({ clientKey, clientSecret, refreshToken }) {
  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error_description || (json.error && typeof json.error === 'string')) {
    throw new TikTokApiError(json.error_description || json.error || `Erro ${res.status} renovando o acesso à TikTok -- pode ser que a conexão tenha expirado (o refresh token dura ~365 dias) e precise ser refeita em Integrações.`, json);
  }
  return json; // { access_token, refresh_token, expires_in, refresh_expires_in }
}

// Descobre quem é a criadora conectada -- chamado logo depois de trocar o
// code por token (pra pessoa reconhecer visualmente qual conta é essa
// antes de confirmar, mesmo espírito do getMyChannel() do YouTube/
// listBoards() do Pinterest) E de novo antes de CADA publicação (pra
// saber, na hora, quais privacy_level_options valem -- ver aviso no topo
// do arquivo sobre App não auditado).
async function queryCreatorInfo({ accessToken }) {
  const res = await fetch(`${API_BASE}/post/publish/creator_info/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' }
  });
  const json = await res.json().catch(() => ({}));
  checkDataApiError(json, `Erro ${res.status} consultando a conta da TikTok.`);
  if (!res.ok) throw new TikTokApiError(`Erro ${res.status} consultando a conta da TikTok.`, json);
  const data = json.data || {};
  return {
    creatorUsername: data.creator_username || null,
    creatorNickname: data.creator_nickname || null,
    creatorAvatarUrl: data.creator_avatar_url || null,
    privacyLevelOptions: data.privacy_level_options || [],
    commentDisabled: !!data.comment_disabled,
    duetDisabled: !!data.duet_disabled,
    stitchDisabled: !!data.stitch_disabled,
    maxVideoPostDurationSec: data.max_video_post_duration_sec || null
  };
}

// Publica um vídeo direto de uma URL pública (PULL_FROM_URL) -- mesmo
// padrão de "manda a URL pública, a própria rede baixa sozinha" já usado
// pela Meta e pelo Pinterest (diferente da LinkedIn/YouTube, que exigem o
// binário de verdade). Devolve o publish_id pra depois conferir o status
// (fetchPublishStatus) -- a publicação é ASSÍNCRONA, não sai pronta na
// hora desta chamada.
async function initDirectPostFromUrl({ accessToken, videoUrl, title, privacyLevel }) {
  const res = await fetch(`${API_BASE}/post/publish/video/init/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      post_info: {
        title: title || '',
        privacy_level: privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false
      },
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: videoUrl
      }
    })
  });
  const json = await res.json().catch(() => ({}));
  checkDataApiError(json, `Erro ${res.status} iniciando a publicação na TikTok.`);
  if (!res.ok) throw new TikTokApiError(`Erro ${res.status} iniciando a publicação na TikTok.`, json);
  const publishId = json.data && json.data.publish_id;
  if (!publishId) throw new TikTokApiError('A TikTok não devolveu um publish_id -- tente de novo.', json);
  return publishId;
}

// Consulta o status do processamento -- chamada usada por
// waitForPublishComplete() abaixo, nunca sozinha (a publicação demora um
// pouco pra sair de PROCESSING_DOWNLOAD, mesmo padrão de "espera o
// container ficar pronto" já usado pela Meta em
// waitForMediaContainerReady, ver utils/metaGraphClient.js).
async function fetchPublishStatus({ accessToken, publishId }) {
  const res = await fetch(`${API_BASE}/post/publish/status/fetch/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ publish_id: publishId })
  });
  const json = await res.json().catch(() => ({}));
  checkDataApiError(json, `Erro ${res.status} consultando o status da publicação na TikTok.`);
  if (!res.ok) throw new TikTokApiError(`Erro ${res.status} consultando o status da publicação na TikTok.`, json);
  const data = json.data || {};
  return {
    status: data.status,
    failReason: data.fail_reason || null,
    publiclyAvailablePostIds: data.publicaly_available_post_id || []
  };
}

const STATUS_POLL_INTERVAL_MS = 3000;
const STATUS_POLL_TIMEOUT_MS = 60000; // 1 minuto -- suficiente pros vídeos curtos que a Papoi publica; o publicador roda de 2 em 2 min, então não trava a fila por muito tempo se demorar mais
const FAIL_REASON_LABEL_PT = {
  file_format_check_failed: 'formato de arquivo inválido pra TikTok',
  duration_check_failed: 'duração do vídeo fora do permitido',
  frame_rate_check_failed: 'taxa de quadros do vídeo inválida',
  picture_size_check_failed: 'resolução do vídeo inválida',
  video_pull_failed: 'a TikTok não conseguiu baixar o vídeo pela URL pública',
  spam_risk: 'a TikTok sinalizou risco de spam nesse conteúdo',
  auth_removed: 'a autorização da Papoi foi revogada do lado da TikTok'
};

// Espera a publicação sair de PROCESSING_DOWNLOAD/PROCESSING_UPLOAD e
// virar PUBLISH_COMPLETE (sucesso) ou FAILED (erro de verdade, com um
// `fail_reason` pra explicar por quê) -- `pollIntervalMs`/`timeoutMs`
// configuráveis pro teste automatizado não precisar esperar de verdade.
async function waitForPublishComplete({ accessToken, publishId, pollIntervalMs = STATUS_POLL_INTERVAL_MS, timeoutMs = STATUS_POLL_TIMEOUT_MS }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    last = await fetchPublishStatus({ accessToken, publishId });
    if (last.status === 'PUBLISH_COMPLETE' || last.status === 'SEND_TO_USER_INBOX') return last;
    if (last.status === 'FAILED') {
      const motivo = FAIL_REASON_LABEL_PT[last.failReason] || last.failReason || 'motivo não informado';
      throw new TikTokApiError(`A TikTok recusou a publicação (${motivo}).`, last);
    }
    if (Date.now() >= deadline) {
      throw new TikTokApiError(`A TikTok ainda estava processando o vídeo depois de ${Math.round(timeoutMs / 1000)}s (status: ${last.status || 'desconhecido'}) -- confira em alguns minutos se saiu, ou tente de novo.`, last);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

module.exports = {
  TikTokApiError,
  exchangeCodeForToken,
  refreshAccessToken,
  queryCreatorInfo,
  initDirectPostFromUrl,
  fetchPublishStatus,
  waitForPublishComplete
};
