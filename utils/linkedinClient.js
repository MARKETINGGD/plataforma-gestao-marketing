// Cliente fino pra API oficial da LinkedIn (67ª rodada -- "vamos para a
// proxima integração de API, vamos para o linkedin", depois da Meta já
// funcionando em produção -- ver PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md,
// seção 7, pro histórico completo/checklist da Raquel). Mesmo espírito de
// utils/metaGraphClient.js: cada função faz UMA chamada HTTP pra API da
// LinkedIn (Community Management API), sem nenhuma lógica de negócio --
// quem decide QUANDO chamar (fluxo de OAuth, publicador automático) fica em
// routes/socialAccounts.js e utils/linkedinPublisher.js. Isolado num módulo
// próprio pelo mesmo motivo de sempre: os testes automatizados substituem
// estas funções por versões falsas, sem rede nem credenciais reais.
//
// **Diferença importante em relação à Meta**: aqui NADA foi confirmado
// contra a API de verdade ainda -- a LinkedIn exige aprovação prévia do
// produto "Community Management API" (revisão manual de 1 a 4 semanas,
// com Página verificada, CNPJ/razão social, política de privacidade e
// vídeo de demonstração -- ver seção 7 do plano) antes de qualquer token
// funcionar de verdade, diferente da Meta (onde a Raquel conseguiu testar
// no mesmo dia). Cada função abaixo foi escrita batendo o pé estritamente
// na documentação oficial (learn.microsoft.com/linkedin) -- sem nenhum
// teste ao vivo possível ainda. Pode ser que precise de alguma correção
// quando o primeiro teste de verdade acontecer (mesmo espírito das 7
// correções que a Meta precisou, documentadas no plano) -- por isso cada
// função troca facilmente sem mexer no resto do código (mesmo motivo de
// isolamento do metaGraphClient.js).

// Versão da API por mês (formato AAAAMM, exigida em todo request no
// cabeçalho "Linkedin-Version") -- a LinkedIn dá suporte a cada versão por
// 12 meses; se um dia essa versão for aposentada, trocar aqui é o único
// lugar (mesmo espírito do GRAPH_VERSION em metaGraphClient.js).
const LINKEDIN_VERSION = '202606';
const LINKEDIN_API_BASE = 'https://api.linkedin.com/rest';
const LINKEDIN_OAUTH_BASE = 'https://www.linkedin.com/oauth/v2';

class LinkedInApiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'LinkedInApiError';
    this.details = details;
  }
}

function authHeaders(accessToken, extra) {
  return Object.assign({
    Authorization: `Bearer ${accessToken}`,
    'Linkedin-Version': LINKEDIN_VERSION,
    'X-Restli-Protocol-Version': '2.0.0'
  }, extra || {});
}

async function apiFetch(pathAndQuery, accessToken, options = {}) {
  const headers = authHeaders(accessToken, options.jsonBody ? { 'Content-Type': 'application/json' } : {});
  const res = await fetch(`${LINKEDIN_API_BASE}${pathAndQuery}`, {
    method: options.method || 'GET',
    headers,
    body: options.body
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = body.message || `Erro ${res.status} na API da LinkedIn.`;
    throw new LinkedInApiError(msg, body);
  }
  return { body, headers: res.headers };
}

// Passo 1 do OAuth: troca o "code" (que a LinkedIn devolveu no redirect) por
// um token de acesso. Diferente da Meta, a LinkedIn já devolve o token de
// longa duração direto aqui (~60 dias, `expires_in`) -- não existe uma 2ª
// troca por um token "de longa duração" separada. Também pode vir
// `refresh_token`, mas usá-lo pra renovar sozinho SEM a pessoa logar nada
// de novo só funciona pra parceiros com "Programmatic Refresh Tokens"
// aprovado à parte -- sem isso, reconectar depois de ~60 dias exige repetir
// o fluxo de login (ver aviso na tela de Integrações).
async function exchangeCodeForToken({ clientId, clientSecret, redirectUri, code }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri
  });
  const res = await fetch(`${LINKEDIN_OAUTH_BASE}/accessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new LinkedInApiError(json.error_description || json.error || `Erro ${res.status} ao trocar o code por token com a LinkedIn.`, json);
  }
  return json; // { access_token, expires_in, refresh_token, refresh_token_expires_in, scope }
}

// Papéis que permitem publicar como a organização (mesma lista documentada
// pra escopo w_organization_social) -- filtra fora papéis só de leitura
// (ANALYST, CURATOR etc.) que apareceriam na mesma lista de qualquer jeito.
const POSTER_ROLES = ['ADMINISTRATOR', 'CONTENT_ADMINISTRATOR'];

// Achar as Páginas (organizations) que a pessoa que autorizou administra --
// mesmo espírito de getManagedPages (metaGraphClient.js), só que na LinkedIn
// é em 2 passos: 1) organizationAcls?q=roleAssignee lista o URN de cada
// organização onde a pessoa tem algum papel (sem nome nenhum); 2) uma
// chamada por organização (getOrganizationDetails) traz o nome de exibição.
// Exige o escopo extra `rw_organization_admin` (além de `w_organization_social`,
// que só serve pra publicar de verdade) -- ver LINKEDIN_SCOPES em
// routes/socialAccounts.js.
async function listAdminOrganizations({ accessToken }) {
  const qs = new URLSearchParams({ q: 'roleAssignee', state: 'APPROVED' });
  const { body } = await apiFetch(`/organizationAcls?${qs.toString()}`, accessToken);
  const elements = (body.elements || []).filter((e) => POSTER_ROLES.includes(e.role));
  const orgs = [];
  for (const el of elements) {
    const organizationUrn = el.organization;
    const organizationId = String(organizationUrn || '').split(':').pop();
    if (!organizationId) continue;
    let name = `Organização ${organizationId}`;
    try {
      const details = await getOrganizationDetails({ accessToken, organizationId });
      name = details.localizedName || name;
    } catch (e) {
      // Sem nome de exibição não impede a pessoa de escolher -- mostra só o ID
      // (raro: só falharia se o papel aparecesse no passo 1 mas o token não
      // tivesse detalhe suficiente pro passo 2).
    }
    orgs.push({ organizationId, organizationUrn, name, role: el.role });
  }
  return orgs;
}

async function getOrganizationDetails({ accessToken, organizationId }) {
  const { body } = await apiFetch(`/organizations/${organizationId}`, accessToken);
  return body;
}

// ---------- Images API (upload síncrono, 1 chamada de inicialização + 1 PUT) ----------
async function initializeImageUpload({ accessToken, ownerUrn }) {
  const { body } = await apiFetch('/images?action=initializeUpload', accessToken, {
    method: 'POST',
    jsonBody: true,
    body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } })
  });
  return body.value; // { uploadUrl, image, uploadUrlExpiresAt }
}

// A uploadUrl devolvida já é uma URL pré-assinada (auto-contida) -- não leva
// o cabeçalho Authorization/Bearer, só o PUT do binário puro.
async function uploadBinaryToUploadUrl({ uploadUrl, buffer }) {
  const res = await fetch(uploadUrl, { method: 'PUT', body: buffer });
  if (!res.ok) {
    throw new LinkedInApiError(`Erro ${res.status} enviando o arquivo pra LinkedIn.`);
  }
  return res.headers.get('etag');
}

async function uploadImage({ accessToken, ownerUrn, buffer }) {
  const init = await initializeImageUpload({ accessToken, ownerUrn });
  await uploadBinaryToUploadUrl({ uploadUrl: init.uploadUrl, buffer });
  return init.image; // urn:li:image:...
}

// ---------- Videos API (upload em pedaços de 4MB, mesmo com arquivo pequeno) ----------
const VIDEO_CHUNK_SIZE = 4 * 1024 * 1024; // 4MB -- tamanho fixo exigido pela LinkedIn

async function initializeVideoUpload({ accessToken, ownerUrn, fileSizeBytes }) {
  const { body } = await apiFetch('/videos?action=initializeUpload', accessToken, {
    method: 'POST',
    jsonBody: true,
    body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn, fileSizeBytes } })
  });
  return body.value; // { video, uploadToken, uploadInstructions: [{uploadUrl, firstByte, lastByte}], uploadUrlsExpireAt }
}

async function finalizeVideoUpload({ accessToken, video, uploadToken, uploadedPartIds }) {
  await apiFetch('/videos?action=finalizeUpload', accessToken, {
    method: 'POST',
    jsonBody: true,
    body: JSON.stringify({ finalizeUploadRequest: { video, uploadToken, uploadedPartIds } })
  });
}

async function uploadVideo({ accessToken, ownerUrn, buffer }) {
  const init = await initializeVideoUpload({ accessToken, ownerUrn, fileSizeBytes: buffer.length });
  const instructions = init.uploadInstructions || [];
  const uploadedPartIds = [];
  // Sequencial de propósito (mesmo motivo de sempre no publicador da Meta):
  // mais fácil de acompanhar erro e não bate limite de conexões simultâneas.
  for (const part of instructions) {
    const chunk = buffer.subarray(part.firstByte, part.lastByte + 1);
    const etag = await uploadBinaryToUploadUrl({ uploadUrl: part.uploadUrl, buffer: chunk });
    uploadedPartIds.push(etag);
  }
  await finalizeVideoUpload({ accessToken, video: init.video, uploadToken: init.uploadToken, uploadedPartIds });
  return init.video; // urn:li:video:...
}

// ---------- Posts API ----------
// Um post de texto puro (sem media nenhuma), com 1 imagem ou com 1 vídeo --
// `mediaUrn` vem de uploadImage/uploadVideo acima. `authorUrn` é sempre
// `urn:li:organization:{id}` (só posta como a Página da marca, nunca como
// pessoa física). `visibility: PUBLIC` e `lifecycleState: PUBLISHED`
// publicam na hora (sem rascunho pendente do lado da LinkedIn).
async function createPost({ accessToken, authorUrn, commentary, mediaUrn }) {
  const payload = {
    author: authorUrn,
    commentary: commentary || '',
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false
  };
  if (mediaUrn) {
    payload.content = { media: { id: mediaUrn } };
  }
  const res = await fetch(`${LINKEDIN_API_BASE}/posts`, {
    method: 'POST',
    headers: authHeaders(accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new LinkedInApiError(errBody.message || `Erro ${res.status} publicando na LinkedIn.`, errBody);
  }
  // A LinkedIn devolve o ID do post criado no cabeçalho x-restli-id (201
  // Created, corpo vazio) -- não em JSON, diferente de quase toda outra
  // chamada desse cliente.
  const postUrn = res.headers.get('x-restli-id');
  return { id: postUrn };
}

// A LinkedIn não documenta um "permalink" pronto pra um Post criado via
// API -- esse formato de URL (feed/update/{urn}) é o mesmo usado pela
// própria LinkedIn ao linkar um post no feed público, e o mais comum entre
// outras integrações -- **não confirmado ainda contra um post publicado de
// verdade** (só será possível depois da aprovação/1º teste real, ver
// PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md seção 7). Se não abrir certo no
// 1º teste, é só ajustar esta função -- o resto do publicador não muda.
function buildPermalink(postUrn) {
  if (!postUrn) return null;
  return `https://www.linkedin.com/feed/update/${postUrn}/`;
}

module.exports = {
  LINKEDIN_VERSION,
  LinkedInApiError,
  exchangeCodeForToken,
  listAdminOrganizations,
  getOrganizationDetails,
  uploadImage,
  uploadVideo,
  VIDEO_CHUNK_SIZE,
  createPost,
  buildPermalink
};
