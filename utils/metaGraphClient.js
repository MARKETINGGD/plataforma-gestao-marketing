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

// 5ª correção (23/09/2026): o Explorador da Graph API (que lista o
// catálogo de permissões direto do próprio App "Papoi - Agendamento
// Social", sem depender de nome escrito à mão) confirmou que
// `instagram_content_publish` (a 2ª tentativa, sem "-ing" e sem
// "business_") É um nome válido de verdade -- mas o Explorador estava
// usando v25.0/v26.0, bem mais nova que a v21.0 usada aqui desde o
// começo. Como o nome exato já tinha sido tentado antes (commit
// `2f3cac6`) e rejeitado pela autorização de produção, a explicação que
// sobra é a versão antiga da URL de autorização
// (`/v21.0/dialog/oauth`, ver routes/socialAccounts.js) não reconhecendo
// esse escopo -- por isso subiu junto pra v23.0 (bem estabelecida, com
// anos de suporte pela frente, sem ser a mais nova de todas). Registrado
// com essa ressalva porque não há como confirmar 100% sem testar de
// novo ao vivo.
const GRAPH_VERSION = 'v23.0';
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

// 7ª correção (23/09/2026): a Raquel achou ao vivo -- funcionou pra
// GhelPlus, mas o post de teste da De Bacco falhou com "Media ID is not
// available" (erro clássico da Graph API, código 9007). A documentação
// da própria Meta diz que pra 1 imagem não precisaria checar o status do
// container antes de publicar -- mas na prática (confirmado por vários
// relatos de outros desenvolvedores com o mesmo erro) a Meta processa o
// download/validação da imagem em segundo plano DEPOIS de criar o
// container, e publicar cedo demais (antes desse processamento acabar)
// dá exatamente esse erro -- mais chance de acontecer com imagem maior/
// mais lenta pra baixar, o que bate com só a De Bacco ter falhado.
// `waitForMediaContainerReady` espera o status virar `FINISHED` antes de
// deixar `attemptPublish` (metaPublisher.js) seguir pro passo de
// publicar -- e, se der `ERROR` de verdade (imagem inválida/inacessível),
// erra com uma mensagem BEM mais clara que o "Media ID is not available"
// genérico.
const CONTAINER_POLL_INTERVAL_MS = 2000;
const CONTAINER_POLL_TIMEOUT_MS = 60000; // 1 minuto (Meta recomenda checar no máximo por ~5 min, mas o publicador roda a cada 2 min -- 1 min de espera aqui é suficiente pra maioria dos casos sem travar a fila)
// Vídeo (Reels, 9ª correção/melhoria, 23/09/2026) demora BEM mais que
// imagem pra processar -- a própria Meta recomenda checar por até uns 5
// minutos nesse caso (ver comentário de createInstagramReelsContainer
// mais abaixo).
const VIDEO_CONTAINER_POLL_INTERVAL_MS = 5000;
const VIDEO_CONTAINER_POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

async function getMediaContainerStatus({ containerId, pageAccessToken }) {
  const qs = new URLSearchParams({ fields: 'status_code,status', access_token: pageAccessToken });
  return graphFetch(`/${containerId}?${qs.toString()}`);
}

// `pollIntervalMs`/`timeoutMs` são configuráveis pra dar mais tempo a vídeo
// (Reels) do que a uma imagem só -- ver as constantes de vídeo acima.
async function waitForMediaContainerReady({ containerId, pageAccessToken, pollIntervalMs = CONTAINER_POLL_INTERVAL_MS, timeoutMs = CONTAINER_POLL_TIMEOUT_MS }) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  for (;;) {
    const body = await getMediaContainerStatus({ containerId, pageAccessToken });
    lastStatus = body.status_code;
    if (lastStatus === 'FINISHED') return;
    if (lastStatus === 'ERROR') {
      throw new MetaGraphError(`A Meta não conseguiu processar o arquivo (container deu erro)${body.status ? ' -- ' + body.status : ''}. Confirme se é um arquivo válido (foto JPEG/PNG ou vídeo MP4/MOV).`, body);
    }
    if (lastStatus === 'EXPIRED') {
      throw new MetaGraphError('O container de mídia expirou antes de conseguir publicar -- tente de novo.', body);
    }
    if (Date.now() >= deadline) {
      throw new MetaGraphError(`A Meta ainda estava processando o arquivo depois de ${Math.round(timeoutMs / 1000)}s (status: ${lastStatus || 'desconhecido'}) -- tente de novo em alguns minutos.`, body);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

// Carrossel do Instagram (8ª correção, 23/09/2026 — pedido da Raquel
// depois da Meta funcionar pra post Estático): diferente de 1 imagem só,
// um carrossel é montado em 3 passos -- cada imagem vira um container
// "filho" (`is_carousel_item: true`, sem legenda -- a legenda vai só no
// container "pai"), esses containers filhos são combinados num container
// "pai" (`media_type: CAROUSEL`, `children` com a lista de IDs, na
// ordem certa), e só o container pai é publicado. Cada container (filho
// e pai) passa pelo mesmo `waitForMediaContainerReady` de cima -- o
// Instagram exige de 2 a 10 imagens por carrossel (ver validação em
// utils/metaPublisher.js).
async function createInstagramCarouselChildContainer({ igUserId, pageAccessToken, imageUrl }) {
  const qs = new URLSearchParams({ image_url: imageUrl, is_carousel_item: 'true', access_token: pageAccessToken });
  return graphFetch(`/${igUserId}/media?${qs.toString()}`, { method: 'POST' });
}

async function createInstagramCarouselContainer({ igUserId, pageAccessToken, childrenIds, caption }) {
  const qs = new URLSearchParams({
    media_type: 'CAROUSEL',
    children: childrenIds.join(','),
    caption: caption || '',
    access_token: pageAccessToken
  });
  return graphFetch(`/${igUserId}/media?${qs.toString()}`, { method: 'POST' });
}

// Reels do Instagram (9ª correção/melhoria, 23/09/2026 — pedido da Raquel
// logo depois do Carrossel: "agora o reels"). Bem mais simples que
// Carrossel na montagem (1 chamada só, `media_type: 'REELS'` +
// `video_url` apontando pro arquivo de vídeo já hospedado na própria
// Papoi, igual o publicador já faz pra imagem) -- a diferença de verdade
// é o TEMPO: a Meta baixa e processa (transcodifica) o vídeo em segundo
// plano, o que demora bem mais que uma imagem (a própria documentação
// recomenda checar por até uns 5 minutos, contra os ~1 minuto que basta
// pra imagem) -- por isso o publicador usa
// VIDEO_CONTAINER_POLL_INTERVAL_MS/VIDEO_CONTAINER_POLL_TIMEOUT_MS (bem
// maiores que os de imagem) ao chamar `waitForMediaContainerReady` pra
// um Reels, em vez dos padrões. `share_to_feed: true` é a mesma escolha
// que o próprio app do Instagram usa por padrão ao publicar um Reels
// normal -- aparece tanto na aba Reels quanto no Feed, não só numa das
// duas.
async function createInstagramReelsContainer({ igUserId, pageAccessToken, videoUrl, caption }) {
  const qs = new URLSearchParams({
    media_type: 'REELS',
    video_url: videoUrl,
    caption: caption || '',
    share_to_feed: 'true',
    access_token: pageAccessToken
  });
  return graphFetch(`/${igUserId}/media?${qs.toString()}`, { method: 'POST' });
}

// Stories do Instagram (10ª melhoria, 24/09/2026 — pedido da Raquel logo
// depois do Reels). Aceita foto OU vídeo (nunca os dois no mesmo Story),
// sempre com `media_type: 'STORIES'` -- por isso recebe `isVideo` pra
// saber se manda `video_url` ou `image_url`. Diferença importante: **a
// Meta não aceita legenda nenhuma pra Story** (a própria documentação da
// API confirma isso -- é uma limitação da Meta, não da Papoi) -- por
// isso essa função nem recebe `caption` como parâmetro; a legenda que a
// pessoa digita na Papoi continua servindo só de anotação interna
// (title/controle), nunca aparece no Story publicado de verdade. Some
// sozinho depois de 24h -- comportamento normal do Instagram, nada a ver
// com a Papoi.
async function createInstagramStoryContainer({ igUserId, pageAccessToken, mediaUrl, isVideo }) {
  const qs = new URLSearchParams({ media_type: 'STORIES', access_token: pageAccessToken });
  qs.set(isVideo ? 'video_url' : 'image_url', mediaUrl);
  return graphFetch(`/${igUserId}/media?${qs.toString()}`, { method: 'POST' });
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
  GRAPH_VERSION,
  MetaGraphError,
  exchangeCodeForToken,
  getLongLivedUserToken,
  getManagedPages,
  createInstagramMediaContainer,
  createInstagramCarouselChildContainer,
  createInstagramCarouselContainer,
  createInstagramReelsContainer,
  createInstagramStoryContainer,
  getMediaContainerStatus,
  waitForMediaContainerReady,
  VIDEO_CONTAINER_POLL_INTERVAL_MS,
  VIDEO_CONTAINER_POLL_TIMEOUT_MS,
  publishInstagramMediaContainer,
  publishFacebookPagePost,
  getPermalink
};
