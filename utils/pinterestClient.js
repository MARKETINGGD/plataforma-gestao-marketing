// Cliente fino pra API oficial do Pinterest (75ª rodada, pedido novo da
// Raquel: "vamos começar com pinterest, é apenas de bacco" -- depois da
// Meta, LinkedIn e YouTube já implementadas). Mesmo espírito de
// utils/metaGraphClient.js/utils/youtubeClient.js: cada função faz UMA
// chamada HTTP pra API do Pinterest, sem nenhuma lógica de negócio -- quem
// decide QUANDO chamar (fluxo de OAuth, publicador automático) fica em
// routes/socialAccounts.js e utils/pinterestPublisher.js. Isolado num
// módulo próprio pelo mesmo motivo de sempre: os testes automatizados
// substituem estas funções por versões falsas, sem rede nem credenciais
// reais.
//
// **Só a De Bacco usa Pinterest** (pedido explícito da Raquel) -- por isso
// `PINTEREST_BRANDS` em routes/socialAccounts.js/utils/pinterestPublisher.js
// tem 1 item só, diferente da Meta/LinkedIn/YouTube (2 marcas). Isso evita
// de vez a novela de contas compartilhadas que aconteceu no YouTube (ver
// rodadas 69ª a 75ª) -- não existe 2ª marca pra confundir.
//
// **OAuth do Pinterest tem 2 diferenças importantes em relação às outras 3
// redes**, confirmadas contra o repositório oficial de exemplos da própria
// Pinterest (github.com/pinterest/api-quickstart), já que a documentação em
// texto do site não deixa isso claro:
// 1) a URL de autorização usa `consumer_id` (não `client_id`) e um parâmetro
//    `refreshable=true` -- sem ele, o Pinterest NUNCA manda um
//    `refresh_token` de volta, só o access token (que dura só 30 dias);
// 2) a troca do "code" por token (e a renovação via `refresh_token`) exige
//    um cabeçalho `Authorization: Basic <base64(client_id:client_secret)>`
//    em vez de mandar `client_id`/`client_secret` no corpo do POST, como as
//    outras 3 redes fazem.
const OAUTH_BASE = 'https://www.pinterest.com';
const API_BASE = 'https://api.pinterest.com/v5';

class PinterestApiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'PinterestApiError';
    this.details = details;
  }
}

function basicAuthHeader({ clientId, clientSecret }) {
  const raw = `${clientId}:${clientSecret}`;
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
}

// Passo 1 do OAuth: troca o "code" (que o Pinterest devolveu no redirect)
// por um access token (~30 dias) + um refresh_token (~1 ano, só vem se a
// autorização pediu `refreshable=true`, ver routes/socialAccounts.js).
async function exchangeCodeForToken({ clientId, clientSecret, redirectUri, code }) {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader({ clientId, clientSecret }),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new PinterestApiError(json.error_description || json.message || json.error || `Erro ${res.status} ao trocar o code por token com o Pinterest.`, json);
  }
  return json; // { access_token, expires_in, refresh_token, scope, token_type }
}

// Pega um access token novo a partir do refresh_token guardado -- chamado
// sempre antes de publicar (utils/pinterestPublisher.js), já que o access
// token do Pinterest dura só ~30 dias e a Papoi nunca guarda ele entre um
// ciclo e outro (mesmo espírito do YouTube, ver utils/youtubeClient.js).
async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader({ clientId, clientSecret }),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new PinterestApiError(json.error_description || json.message || json.error || `Erro ${res.status} renovando o acesso ao Pinterest -- pode ser que a conexão tenha expirado (refresh_token dura cerca de 1 ano) e precise ser refeita em Integrações.`, json);
  }
  return json.access_token;
}

// Lista os quadros (boards) da conta que acabou de autorizar -- equivalente
// à lista de Páginas da Meta/organizations da LinkedIn: a pessoa escolhe
// depois, a Papoi nunca decide sozinha (mesmo cuidado de segurança da 6ª
// correção da Meta). Só a 1ª página de resultados é usada -- uma conta de
// marca única (o caso da De Bacco) dificilmente passa de 25 quadros; listar
// todas as páginas fica como melhoria futura fácil se isso um dia acontecer.
async function listBoards({ accessToken }) {
  const qs = new URLSearchParams({ page_size: '25' });
  const res = await fetch(`${API_BASE}/boards?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PinterestApiError((body.message) || `Erro ${res.status} consultando os quadros do Pinterest.`, body);
  }
  return (body.items || []).map((b) => ({ boardId: b.id, boardName: b.name }));
}

// Cria (e já publica -- não existe "rascunho" na API do Pinterest) um Pin
// novo. `imageUrl` precisa ser uma URL pública de verdade (mesmo padrão da
// Meta em utils/metaGraphClient.js) -- o Pinterest baixa a imagem sozinho a
// partir dela, nunca recebe o binário da Papoi.
async function createPin({ accessToken, boardId, imageUrl, title, description, link }) {
  const payload = {
    board_id: boardId,
    media_source: { source_type: 'image_url', url: imageUrl, is_standard: true }
  };
  if (title) payload.title = title;
  if (description) payload.description = description;
  if (link) payload.link = link;
  const res = await fetch(`${API_BASE}/pins`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PinterestApiError((body.message) || `Erro ${res.status} publicando o Pin.`, body);
  }
  return body; // inclui `id` do Pin criado
}

function buildPermalink(pinId) {
  if (!pinId) return null;
  return `https://www.pinterest.com/pin/${pinId}/`;
}

module.exports = {
  PinterestApiError,
  OAUTH_BASE,
  exchangeCodeForToken,
  refreshAccessToken,
  listBoards,
  createPin,
  buildPermalink
};
