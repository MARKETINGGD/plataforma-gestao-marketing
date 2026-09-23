// Cliente fino pra Graph API da Meta (54ª rodada — conectar o Agendamento de
// Redes Sociais à API de verdade do Instagram/Facebook). Cada função aqui
// faz UMA chamada HTTP pra Meta, sem nenhuma lógica de negócio — quem decide
// QUANDO chamar (fluxo de OAuth, publicador automático) fica em
// routes/socialAccounts.js e utils/metaPublisher.js.
//
// Isolado num módulo próprio de propósito: os testes automatizados
// substituem estas funções (require.cache / injeção) por versões falsas,
// sem precisar de rede nem de credenciais reais — o handshake de login de
// verdade no Facebook só pode ser testado por uma pessoa de verdade
// clicando "Conectar conta Meta" no navegador (não dá pra automatizar login
// alheio), então essa parte fica documentada como teste manual (ver
// PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md).

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

class MetaGraphError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'MetaGraphError';
    this.details = details;
  }
}

async function graphFetch(pathAndQuery, options = {}) {
  const res = await fetch(`${GRAPH_BASE}${pathAndQuery}`, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const msg = (body.error && body.error.message) || `Erro ${res.status} na Graph API.`;
    throw new MetaGraphError(msg, body.error || null);
  }
  return body;
}

// Passo 1 do OAuth: troca o "code" (que a Meta devolveu no redirect) por um
// token de usuário de curta duração.
async function exchangeCodeForToken({ appId, appSecret, redirectUri, code }) {
  const qs = new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code });
  return graphFetch(`/oauth/access_token?${qs.toString()}`);
}

// Passo 2: troca o token curto por um de longa duração (~60 dias) — é esse
// que fica guardado no banco pro publicador usar sozinho depois.
async function getLongLivedUserToken({ appId, appSecret, shortLivedToken }) {
  const qs = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken
  });
  return graphFetch(`/oauth/access_token?${qs.toString()}`);
}

// Lista as Páginas do Facebook que a pessoa que autorizou administra, já
// trazendo o token de acesso DA PÁGINA (não do usuário) e a conta do
// Instagram vinculada a cada uma, quando existir.
async function getManagedPages({ userAccessToken }) {
  const qs = new URLSearchParams({
    fields: 'id,name,access_token,instagram_business_account{id,username}',
    access_token: userAccessToken
  });
  const body = await graphFetch(`/me/accounts?${qs.toString()}`);
  return body.data || [];
}

// Publicação no Instagram é sempre em 2 passos: cria um "container" de
// mídia (aponta pra uma URL pública da imagem/vídeo) e depois publica esse
// container. `imageUrl` precisa ser uma URL acessível publicamente pela
// Meta (por isso o publicador usa a URL pública do arquivo já hospedado na
// própria Papoi, nunca um caminho local).
async function createInstagramMediaContainer({ igUserId, pageAccessToken, imageUrl, caption }) {
  const qs = new URLSearchParams({ image_url: imageUrl, caption: caption || '', access_token: pageAccessToken });
  return graphFetch(`/${igUserId}/media?${qs.toString()}`, { method: 'POST' });
}

async function publishInstagramMediaContainer({ igUserId, pageAccessToken, creationId }) {
  const qs = new URLSearchParams({ creation_id: creationId, access_token: pageAccessToken });
  return graphFetch(`/${igUserId}/media_publish?${qs.toString()}`, { method: 'POST' });
}

// Publicação direta na Página do Facebook (1 passo só, mais simples que o
// Instagram) — `imageUrl` opcional (post só de texto é permitido no
// Facebook, diferente do Instagram).
async function publishFacebookPagePost({ pageId, pageAccessToken, message, imageUrl }) {
  if (imageUrl) {
    const qs = new URLSearchParams({ url: imageUrl, caption: message || '', access_token: pageAccessToken });
    return graphFetch(`/${pageId}/photos?${qs.toString()}`, { method: 'POST' });
  }
  const qs = new URLSearchParams({ message: message || '', access_token: pageAccessToken });
  return graphFetch(`/${pageId}/feed?${qs.toString()}`, { method: 'POST' });
}

// Permalink de verdade do post publicado — usado só pra mostrar o link
// clicável na Papoi depois de publicar (não é necessário pra publicar).
async function getPermalink({ objectId, pageAccessToken }) {
  const qs = new URLSearchParams({ fields: 'permalink,permalink_url', access_token: pageAccessToken });
  const body = await graphFetch(`/${objectId}?${qs.toString()}`);
  return body.permalink_url || body.permalink || null;
}

module.exports = {
  MetaGraphError,
  exchangeCodeForToken,
  getLongLivedUserToken,
  getManagedPages,
  createInstagramMediaContainer,
  publishInstagramMediaContainer,
  publishFacebookPagePost,
  getPermalink
};
