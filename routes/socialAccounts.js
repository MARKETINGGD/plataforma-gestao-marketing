const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth, requireSuperAdmin, JWT_SECRET } = require('../middleware/auth');
const { resolveUserName } = require('../utils/names');
const { logAudit } = require('../utils/audit');
const metaGraph = require('../utils/metaGraphClient');
const linkedinClient = require('../utils/linkedinClient');
const youtubeClient = require('../utils/youtubeClient');

const router = express.Router();

// Conectar Agendamento de Redes Sociais às APIs de verdade (54ª rodada,
// pedido da Raquel — começando pela Meta/Instagram+Facebook, priorizada por
// ela mesma). Só GhelPlus e De Bacco entram aqui por enquanto — são as
// únicas 2 marcas com Business Manager/Página do Facebook/Instagram
// Business já prontos (Duranox e Boutique Inox, que só existem dentro do
// Agendamento/Cronograma, ficam de fora até existir conta de verdade pra
// conectar).
const META_BRANDS = ['debacco', 'ghelplus'];
const BRAND_LABEL_PT = { debacco: 'De Bacco', ghelplus: 'GhelPlus' };

const META_APP_ID = process.env.META_APP_ID || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
// URL pública da própria Papoi — usada tanto pra montar a Redirect URI (se
// META_REDIRECT_URI não vier definida) quanto pra saber pra onde mandar o
// navegador de volta depois do callback.
const APP_BASE_URL = (process.env.PAPOI_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const META_REDIRECT_URI = process.env.META_REDIRECT_URI || `${APP_BASE_URL}/api/social-accounts/meta/callback`;

// Permissões pedidas — ver PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md pro
// histórico completo das tentativas (o nome certo dessa permissão foi bem
// mais difícil de achar do que parecia).
//
// **5ª correção, 23/09/2026 — a definitiva**: a tela "API do Instagram
// com login do Facebook" do painel (usada na 3ª correção) mostrava
// `instagram_content_publishing` (com "-ing"), mas isso também foi
// rejeitado ao vivo. O nome de verdade só foi confirmado pelo
// Explorador da Graph API (developers.facebook.com/tools/explorer,
// selecionando o App "Papoi - Agendamento Social" e buscando
// "instagram" no campo de permissões) — que lista o catálogo real de
// permissões do próprio App, sem depender de nenhum texto de tela ou
// documentação escrita à mão: o nome certo é **`instagram_content_publish`**
// (sem "-ing", sem "business_" — a 2ª correção já tinha esse nome certo,
// só que ainda não funcionava; ver `utils/metaGraphClient.js` pra
// entender por quê — tudo indica que era a versão antiga da URL de
// autorização abaixo, não o nome da permissão). Continua o fluxo
// clássico `response_type=code`, sem parâmetros especiais.
const META_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_read_engagement',
  'business_management',
  'pages_show_list'
].join(',');

function metaConfigured() {
  return !!(META_APP_ID && META_APP_SECRET);
}

// ---------- LinkedIn (67ª rodada, "vamos para a proxima integração de
// API, vamos para o linkedin") ----------
// Mesmas 2 marcas com Página pronta pra conectar na Meta -- ajuste fácil se
// a Raquel confirmar que Duranox/Boutique Inox também têm Página própria da
// LinkedIn. Duplicada (não importada de utils/linkedinPublisher.js) --
// mesmo motivo de sempre: aquele arquivo importa routes/recados.js, que não
// tem nada a ver com este arquivo, mas mantém o mesmo padrão de duplicação
// já usado pra META_BRANDS acima/em utils/metaPublisher.js.
const LINKEDIN_BRANDS = ['debacco', 'ghelplus'];
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || '';
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || '';
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || `${APP_BASE_URL}/api/social-accounts/linkedin/callback`;
// `w_organization_social` publica como a Página; `rw_organization_admin` é
// só pra descobrir QUAIS Páginas a pessoa administra (organizationAcls, ver
// utils/linkedinClient.js) -- sem ele não dá pra montar a lista de escolha,
// a pessoa precisaria saber o ID numérico da Página de cor. Os 2 fazem
// parte do produto "Community Management API" que a Raquel precisa
// solicitar e ter aprovado antes de qualquer conexão funcionar de verdade
// -- ver PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md, seção 7.
const LINKEDIN_SCOPES = ['w_organization_social', 'rw_organization_admin'].join(' ');

function linkedinConfigured() {
  return !!(LINKEDIN_CLIENT_ID && LINKEDIN_CLIENT_SECRET);
}

// ---------- YouTube (69ª rodada, "amanhã ás 8 horas vamos começar a fazer
// a integração com o you tube") ----------
// Mesmas 2 marcas com canal pronto pra conectar na Meta/LinkedIn -- ver
// PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md, seção 8, pro checklist
// completo (App no Google Cloud, Tela de consentimento OAuth, etc.).
const YOUTUBE_BRANDS = ['debacco', 'ghelplus'];
const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID || '';
const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET || '';
const YOUTUBE_REDIRECT_URI = process.env.YOUTUBE_REDIRECT_URI || `${APP_BASE_URL}/api/social-accounts/youtube/callback`;
// 72ª rodada, bug real reportado pela Raquel ao testar a conexão de
// verdade ("Request had insufficient authentication scopes"): só o
// escopo de upload NÃO é suficiente -- ele cobre `videos.insert`
// (publicar) e `thumbnails.set` (capa), mas `channels.list` (usado por
// getMyChannel() em utils/youtubeClient.js pra descobrir qual canal foi
// conectado) exige um escopo de LEITURA, que o upload sozinho não dá.
// `youtube.readonly` cobre exatamente essa consulta, sem dar nenhuma
// permissão de escrita a mais que o upload já não desse.
const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'].join(' ');

function youtubeConfigured() {
  return !!(YOUTUBE_CLIENT_ID && YOUTUBE_CLIENT_SECRET);
}

function serialize(account) {
  if (!account) return null;
  // O token de acesso NUNCA sai do servidor (nem pra super admin) — só o
  // suficiente pra mostrar "conectado como" na tela de Integrações.
  return {
    id: account.id,
    brand: account.brand,
    platform: account.platform,
    igUsername: account.igUsername || null,
    pageName: account.pageName || null,
    // Nome da Página da LinkedIn (organization) -- equivalente ao pageName
    // da Meta, campo próprio pra não confundir os dois na tela.
    orgName: account.orgName || null,
    // Nome do canal do YouTube -- mesmo espírito de pageName/orgName acima.
    channelTitle: account.channelTitle || null,
    tokenExpiresAt: account.tokenExpiresAt || null,
    connectedByName: resolveUserName(account.connectedBy, account.connectedByName),
    connectedAt: account.connectedAt
  };
}

// Estado do OAuth (CSRF + qual marca/quem iniciou) — assinado com o mesmo
// segredo do login da Plataforma, bem curto de duração (10 min é mais que
// suficiente pro fluxo de autorização no Facebook). Vai e volta só dentro
// da própria URL do Facebook, nunca é exposto em lugar nenhum.
const STATE_EXPIRES_IN = '10m';
function signState(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: STATE_EXPIRES_IN });
}
function verifyState(token) {
  return jwt.verify(token, JWT_SECRET);
}

// ---------- escolha de Página pendente (6ª correção, 23/09/2026) ----------
// Achado ao vivo pela Raquel: como ela administra as Páginas de MAIS de
// uma marca com a MESMA conta do Facebook, `getManagedPages` pode devolver
// várias Páginas com Instagram vinculado numa única autorização -- e o
// Facebook, depois da 1ª vez, nem sempre volta a perguntar quais Páginas
// conceder (ele reaproveita a concessão anterior). Resultado: conectar
// "De Bacco" escolhia sozinho a MESMA Página já usada pra "GhelPlus".
// Em vez de adivinhar (`.find()` no primeiro resultado), a Papoi agora
// SEMPRE para no meio do caminho e pede confirmação explícita de qual
// Página é a certa pra essa marca -- guardado em memória (nunca no
// banco: carrega token de acesso, é bem curto -- 15 min -- e cai sozinho
// se ninguém confirmar). Precisa ficar em memória (não em socialAccounts)
// porque ainda não é uma conexão de verdade até a pessoa confirmar.
const PENDING_TTL_MS = 15 * 60 * 1000;
const pendingSelections = new Map();
function cleanupExpiredSelections() {
  const now = Date.now();
  for (const [id, sel] of pendingSelections) {
    if (sel.expiresAt < now) pendingSelections.delete(id);
  }
}

// Mesma ideia (escolha pendente em memória, nunca no banco) reaproveitada
// pra LinkedIn -- Mapa separado do da Meta só pra nunca misturar por
// engano um `selectionId` de uma plataforma com o fluxo da outra.
const linkedinPendingSelections = new Map();
function cleanupExpiredLinkedinSelections() {
  const now = Date.now();
  for (const [id, sel] of linkedinPendingSelections) {
    if (sel.expiresAt < now) linkedinPendingSelections.delete(id);
  }
}

// Mesma ideia, pro YouTube -- Mapa separado de novo, mesmo motivo de
// sempre. Diferente da Meta/LinkedIn, o Google só devolve UM canal por
// autorização (não uma lista pra escolher, ver utils/youtubeClient.js) --
// mesmo assim, a Papoi sempre para e pede confirmação explícita antes de
// gravar a conexão de verdade, pelo mesmo motivo de segurança da 6ª
// correção da Meta (nunca decidir sozinha, mesmo com 1 candidato só).
const youtubePendingSelections = new Map();
function cleanupExpiredYoutubeSelections() {
  const now = Date.now();
  for (const [id, sel] of youtubePendingSelections) {
    if (sel.expiresAt < now) youtubePendingSelections.delete(id);
  }
}

// ---------- listar status das conexões (tela "Integrações") ----------
// Generalizado nesta rodada (67ª) pra devolver as 2 plataformas juntas --
// o front (public/app.js) agrupa por `platform` em vez de assumir que é
// sempre Meta.
router.get('/', requireAuth, requireSuperAdmin, (req, res) => {
  const metaAccounts = META_BRANDS.map((brand) => {
    const account = db.get('socialAccounts').find({ brand, platform: 'meta' }).value();
    return {
      platform: 'meta',
      brand,
      brandLabel: BRAND_LABEL_PT[brand],
      connected: !!account,
      account: serialize(account)
    };
  });
  const linkedinAccounts = LINKEDIN_BRANDS.map((brand) => {
    const account = db.get('socialAccounts').find({ brand, platform: 'linkedin' }).value();
    return {
      platform: 'linkedin',
      brand,
      brandLabel: BRAND_LABEL_PT[brand],
      connected: !!account,
      account: serialize(account)
    };
  });
  const youtubeAccounts = YOUTUBE_BRANDS.map((brand) => {
    const account = db.get('socialAccounts').find({ brand, platform: 'youtube' }).value();
    return {
      platform: 'youtube',
      brand,
      brandLabel: BRAND_LABEL_PT[brand],
      connected: !!account,
      account: serialize(account)
    };
  });
  res.json({
    metaConfigured: metaConfigured(),
    linkedinConfigured: linkedinConfigured(),
    youtubeConfigured: youtubeConfigured(),
    accounts: metaAccounts,
    linkedinAccounts,
    youtubeAccounts
  });
});

// ---------- iniciar a autorização ----------
// Devolve a URL de autorização em JSON (chamada autenticada normal, com o
// Bearer token de sempre) em vez de já redirecionar por aqui -- uma
// navegação de página inteira (window.location.href) não consegue mandar o
// cabeçalho Authorization, então quem faz a chamada autenticada é o
// front-end (fetch/api()), e só DEPOIS o navegador é levado pra URL do
// Facebook devolvida aqui (essa etapa em diante não precisa mais do nosso
// token -- quem autentica dali pra frente é o próprio Facebook).
router.get('/meta/connect', requireAuth, requireSuperAdmin, (req, res) => {
  if (!metaConfigured()) {
    return res.status(503).json({ error: 'META_APP_ID/META_APP_SECRET ainda não configurados no servidor.' });
  }
  const { brand } = req.query;
  if (!META_BRANDS.includes(brand)) {
    return res.status(400).json({ error: 'Marca inválida para conexão com a Meta.' });
  }
  const state = signState({ brand, userId: req.user.id });
  const qs = new URLSearchParams({
    client_id: META_APP_ID,
    redirect_uri: META_REDIRECT_URI,
    state,
    scope: META_SCOPES,
    response_type: 'code'
  });
  // Mesma versão da Graph API usada em utils/metaGraphClient.js (5ª
  // correção: a v21.0 antiga é a suspeita nº 1 de rejeitar um escopo que
  // o próprio catálogo de permissões do App já reconhece como válido).
  res.json({ redirectUrl: `https://www.facebook.com/${metaGraph.GRAPH_VERSION}/dialog/oauth?${qs.toString()}` });
});

// ---------- callback (o Facebook redireciona o NAVEGADOR pra cá) ----------
// Sem requireAuth de propósito: quem chega aqui é o navegador da pessoa
// voltando do facebook.com, sem o cabeçalho Authorization da Papoi — a
// identidade de quem iniciou (e a marca) vem do `state` assinado acima.
router.get('/meta/callback', async (req, res) => {
  const redirectBack = (params) => res.redirect(`${APP_BASE_URL}/?${new URLSearchParams(params).toString()}`);

  const { code, state, error, error_description: errorDescription } = req.query;
  if (error) {
    return redirectBack({ integracoes: 'erro', motivo: errorDescription || error });
  }
  if (!code || !state) {
    return redirectBack({ integracoes: 'erro', motivo: 'Resposta inesperada do Facebook (faltou code/state).' });
  }

  let statePayload;
  try {
    statePayload = verifyState(state);
  } catch (e) {
    return redirectBack({ integracoes: 'erro', motivo: 'Link de autorização expirado ou inválido — tente conectar de novo.' });
  }
  const { brand, userId } = statePayload;
  const requestingUser = db.get('users').find({ id: userId }).value();
  if (!requestingUser) {
    return redirectBack({ integracoes: 'erro', motivo: 'Usuário que iniciou a conexão não existe mais.' });
  }

  try {
    const shortLived = await metaGraph.exchangeCodeForToken({
      appId: META_APP_ID,
      appSecret: META_APP_SECRET,
      redirectUri: META_REDIRECT_URI,
      code
    });
    const longLived = await metaGraph.getLongLivedUserToken({
      appId: META_APP_ID,
      appSecret: META_APP_SECRET,
      shortLivedToken: shortLived.access_token
    });
    const pages = await metaGraph.getManagedPages({ userAccessToken: longLived.access_token });
    const pagesWithInstagram = pages.filter((p) => p.instagram_business_account);
    if (pagesWithInstagram.length === 0) {
      return redirectBack({
        integracoes: 'erro',
        motivo: 'Nenhuma Página do Facebook com conta do Instagram vinculada foi encontrada nessa conta. Confirme se a Página certa foi selecionada na tela de permissão do Facebook.'
      });
    }

    // Token de longa duração da Meta dura ~60 dias — grava a data de
    // expiração pra o publicador (utils/metaPublisher.js) avisar antes de
    // vencer, em vez de só falhar silenciosamente lá na frente.
    const expiresInSeconds = longLived.expires_in || 60 * 24 * 60 * 60;
    const tokenExpiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    // 6ª correção: nunca mais escolhe sozinha (`.find()`) qual Página é a
    // certa -- sempre para aqui e pede confirmação explícita, mesmo
    // quando só veio 1 candidata (evita qualquer engano futuro se um dia
    // a mesma conta do Facebook passar a administrar mais Páginas ainda).
    cleanupExpiredSelections();
    const selectionId = nanoid();
    pendingSelections.set(selectionId, {
      brand,
      tokenExpiresAt,
      expiresAt: Date.now() + PENDING_TTL_MS,
      candidates: pagesWithInstagram.map((p) => ({
        pageId: p.id,
        pageName: p.name,
        pageAccessToken: p.access_token,
        igUserId: p.instagram_business_account.id,
        igUsername: p.instagram_business_account.username || null
      }))
    });
    return redirectBack({ integracoes: 'escolher', brand, selectionId });
  } catch (e) {
    const motivo = e instanceof metaGraph.MetaGraphError ? e.message : 'Erro inesperado ao conectar com a Meta.';
    return redirectBack({ integracoes: 'erro', motivo });
  }
});

// ---------- ver as Páginas candidatas de uma escolha pendente ----------
router.get('/meta/pending/:selectionId', requireAuth, requireSuperAdmin, (req, res) => {
  cleanupExpiredSelections();
  const sel = pendingSelections.get(req.params.selectionId);
  if (!sel) return res.status(404).json({ error: 'Essa conexão expirou ou já foi concluída — clique em "Conectar conta Meta" de novo.' });
  res.json({
    brand: sel.brand,
    brandLabel: BRAND_LABEL_PT[sel.brand] || sel.brand,
    // Token de acesso da Página NUNCA sai daqui — só o suficiente pra
    // pessoa reconhecer visualmente qual Página é qual.
    candidates: sel.candidates.map((c) => ({ pageId: c.pageId, pageName: c.pageName, igUsername: c.igUsername }))
  });
});

// ---------- confirmar qual Página é a certa pra essa marca ----------
router.post('/meta/pending/:selectionId/confirm', requireAuth, requireSuperAdmin, (req, res) => {
  cleanupExpiredSelections();
  const sel = pendingSelections.get(req.params.selectionId);
  if (!sel) return res.status(404).json({ error: 'Essa conexão expirou ou já foi concluída — clique em "Conectar conta Meta" de novo.' });
  const { pageId } = req.body || {};
  const chosen = sel.candidates.find((c) => c.pageId === pageId);
  if (!chosen) return res.status(400).json({ error: 'Página inválida.' });

  const nowIso = new Date().toISOString();
  const accountData = {
    brand: sel.brand,
    platform: 'meta',
    igUserId: chosen.igUserId,
    igUsername: chosen.igUsername,
    pageId: chosen.pageId,
    pageName: chosen.pageName,
    pageAccessToken: chosen.pageAccessToken,
    tokenExpiresAt: sel.tokenExpiresAt,
    connectedBy: req.user.id,
    connectedByName: req.user.name || req.user.username,
    connectedAt: nowIso
  };
  const existing = db.get('socialAccounts').find({ brand: sel.brand, platform: 'meta' }).value();
  if (existing) {
    db.get('socialAccounts').find({ id: existing.id }).assign(accountData).write();
  } else {
    db.get('socialAccounts').push(Object.assign({ id: nanoid() }, accountData)).write();
  }
  logAudit({ user: req.user, entityType: 'socialAccount', entityId: sel.brand, entityLabel: `Meta · ${BRAND_LABEL_PT[sel.brand] || sel.brand}`, action: existing ? 'update' : 'create', details: `Conectado como @${accountData.igUsername || accountData.pageName}` });

  pendingSelections.delete(req.params.selectionId);
  res.json({ ok: true, brand: sel.brand, igUsername: accountData.igUsername, pageName: accountData.pageName });
});

// ---------- desconectar ----------
router.delete('/meta/:brand', requireAuth, requireSuperAdmin, (req, res) => {
  const { brand } = req.params;
  const existing = db.get('socialAccounts').find({ brand, platform: 'meta' }).value();
  if (!existing) return res.status(404).json({ error: 'Essa marca não está conectada.' });
  db.get('socialAccounts').remove({ id: existing.id }).write();
  logAudit({ user: req.user, entityType: 'socialAccount', entityId: brand, entityLabel: `Meta · ${BRAND_LABEL_PT[brand] || brand}`, action: 'delete' });
  res.json({ ok: true });
});

// ---------- LinkedIn: iniciar a autorização ----------
router.get('/linkedin/connect', requireAuth, requireSuperAdmin, (req, res) => {
  if (!linkedinConfigured()) {
    return res.status(503).json({ error: 'LINKEDIN_CLIENT_ID/LINKEDIN_CLIENT_SECRET ainda não configurados no servidor -- a Raquel precisa terminar a aprovação do App na LinkedIn antes (ver PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md).' });
  }
  const { brand } = req.query;
  if (!LINKEDIN_BRANDS.includes(brand)) {
    return res.status(400).json({ error: 'Marca inválida para conexão com a LinkedIn.' });
  }
  const state = signState({ brand, userId: req.user.id, provider: 'linkedin' });
  const qs = new URLSearchParams({
    response_type: 'code',
    client_id: LINKEDIN_CLIENT_ID,
    redirect_uri: LINKEDIN_REDIRECT_URI,
    state,
    scope: LINKEDIN_SCOPES
  });
  res.json({ redirectUrl: `https://www.linkedin.com/oauth/v2/authorization?${qs.toString()}` });
});

// ---------- LinkedIn: callback (a LinkedIn redireciona o NAVEGADOR pra cá) ----------
// Sem requireAuth, mesmo motivo do callback da Meta acima.
router.get('/linkedin/callback', async (req, res) => {
  const redirectBack = (params) => res.redirect(`${APP_BASE_URL}/?${new URLSearchParams(params).toString()}`);

  const { code, state, error, error_description: errorDescription } = req.query;
  if (error) {
    return redirectBack({ integracoes: 'erro', motivo: errorDescription || error });
  }
  if (!code || !state) {
    return redirectBack({ integracoes: 'erro', motivo: 'Resposta inesperada da LinkedIn (faltou code/state).' });
  }

  let statePayload;
  try {
    statePayload = verifyState(state);
  } catch (e) {
    return redirectBack({ integracoes: 'erro', motivo: 'Link de autorização expirado ou inválido — tente conectar de novo.' });
  }
  const { brand, userId } = statePayload;
  const requestingUser = db.get('users').find({ id: userId }).value();
  if (!requestingUser) {
    return redirectBack({ integracoes: 'erro', motivo: 'Usuário que iniciou a conexão não existe mais.' });
  }

  try {
    const token = await linkedinClient.exchangeCodeForToken({
      clientId: LINKEDIN_CLIENT_ID,
      clientSecret: LINKEDIN_CLIENT_SECRET,
      redirectUri: LINKEDIN_REDIRECT_URI,
      code
    });
    const organizations = await linkedinClient.listAdminOrganizations({ accessToken: token.access_token });
    if (organizations.length === 0) {
      return redirectBack({
        integracoes: 'erro',
        motivo: 'Nenhuma Página da LinkedIn com permissão de publicar foi encontrada nessa conta. Confirme se quem autorizou é administradora da Página certa.'
      });
    }

    // Token da LinkedIn dura ~60 dias -- grava a data de expiração pro
    // publicador avisar antes de vencer, mesmo padrão da Meta. Diferente da
    // Meta, aqui não existe uma 2ª troca por token de "longa duração" --
    // este já É o token que fica guardado.
    const expiresInSeconds = token.expires_in || 60 * 24 * 60 * 60;
    const tokenExpiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    // Mesmo espírito da 6ª correção da Meta: nunca escolhe sozinha qual
    // Página é a certa, mesmo quando só vem 1 candidata -- sempre pede
    // confirmação explícita.
    cleanupExpiredLinkedinSelections();
    const selectionId = nanoid();
    linkedinPendingSelections.set(selectionId, {
      brand,
      accessToken: token.access_token,
      tokenExpiresAt,
      expiresAt: Date.now() + PENDING_TTL_MS,
      candidates: organizations.map((o) => ({
        organizationId: o.organizationId,
        organizationUrn: o.organizationUrn,
        orgName: o.name
      }))
    });
    return redirectBack({ integracoes: 'escolher-linkedin', brand, selectionId });
  } catch (e) {
    const motivo = e instanceof linkedinClient.LinkedInApiError ? e.message : 'Erro inesperado ao conectar com a LinkedIn.';
    return redirectBack({ integracoes: 'erro', motivo });
  }
});

// ---------- LinkedIn: ver as Páginas candidatas de uma escolha pendente ----------
router.get('/linkedin/pending/:selectionId', requireAuth, requireSuperAdmin, (req, res) => {
  cleanupExpiredLinkedinSelections();
  const sel = linkedinPendingSelections.get(req.params.selectionId);
  if (!sel) return res.status(404).json({ error: 'Essa conexão expirou ou já foi concluída — clique em "Conectar conta LinkedIn" de novo.' });
  res.json({
    brand: sel.brand,
    brandLabel: BRAND_LABEL_PT[sel.brand] || sel.brand,
    // Token de acesso NUNCA sai daqui -- só o suficiente pra pessoa
    // reconhecer visualmente qual Página é qual.
    candidates: sel.candidates.map((c) => ({ organizationId: c.organizationId, orgName: c.orgName }))
  });
});

// ---------- LinkedIn: confirmar qual Página é a certa pra essa marca ----------
router.post('/linkedin/pending/:selectionId/confirm', requireAuth, requireSuperAdmin, (req, res) => {
  cleanupExpiredLinkedinSelections();
  const sel = linkedinPendingSelections.get(req.params.selectionId);
  if (!sel) return res.status(404).json({ error: 'Essa conexão expirou ou já foi concluída — clique em "Conectar conta LinkedIn" de novo.' });
  const { organizationId } = req.body || {};
  const chosen = sel.candidates.find((c) => c.organizationId === organizationId);
  if (!chosen) return res.status(400).json({ error: 'Página inválida.' });

  const nowIso = new Date().toISOString();
  const accountData = {
    brand: sel.brand,
    platform: 'linkedin',
    organizationId: chosen.organizationId,
    organizationUrn: chosen.organizationUrn,
    orgName: chosen.orgName,
    accessToken: sel.accessToken,
    tokenExpiresAt: sel.tokenExpiresAt,
    connectedBy: req.user.id,
    connectedByName: req.user.name || req.user.username,
    connectedAt: nowIso
  };
  const existing = db.get('socialAccounts').find({ brand: sel.brand, platform: 'linkedin' }).value();
  if (existing) {
    db.get('socialAccounts').find({ id: existing.id }).assign(accountData).write();
  } else {
    db.get('socialAccounts').push(Object.assign({ id: nanoid() }, accountData)).write();
  }
  logAudit({ user: req.user, entityType: 'socialAccount', entityId: sel.brand, entityLabel: `LinkedIn · ${BRAND_LABEL_PT[sel.brand] || sel.brand}`, action: existing ? 'update' : 'create', details: `Conectado como ${accountData.orgName}` });

  linkedinPendingSelections.delete(req.params.selectionId);
  res.json({ ok: true, brand: sel.brand, orgName: accountData.orgName });
});

// ---------- LinkedIn: desconectar ----------
router.delete('/linkedin/:brand', requireAuth, requireSuperAdmin, (req, res) => {
  const { brand } = req.params;
  const existing = db.get('socialAccounts').find({ brand, platform: 'linkedin' }).value();
  if (!existing) return res.status(404).json({ error: 'Essa marca não está conectada.' });
  db.get('socialAccounts').remove({ id: existing.id }).write();
  logAudit({ user: req.user, entityType: 'socialAccount', entityId: brand, entityLabel: `LinkedIn · ${BRAND_LABEL_PT[brand] || brand}`, action: 'delete' });
  res.json({ ok: true });
});

// ---------- YouTube: iniciar a autorização ----------
// `access_type=offline` pede um refresh_token (não só o access token de ~1
// hora); `prompt=consent` FORÇA o Google a devolver um refresh_token novo
// toda vez (sem isso, numa 2ª autorização ele pode reaproveitar a anterior
// e não mandar refresh_token nenhum de volta -- inútil pra publicar sozinho
// depois). Ver utils/youtubeClient.js.
//
// 72ª rodada, achado real testando ao vivo: trocar o "canal ativo" no
// seletor de contas do próprio youtube.com (como avisado na tela de
// Integrações, e como a documentação da 69ª rodada registrava) NÃO
// mudou qual canal o Google devolveu pra De Bacco -- continuou vindo o
// GhelPlus, mesmo numa janela anônima nova, com o acesso da Papoi
// revogado antes e o canal De Bacco conferido como ativo. Ou seja: pelo
// menos nesta conta, `channels.list?mine=true` sempre resolve pro canal
// "dono" de verdade da conta Google (GhelPlus), não pro canal
// selecionado na hora no site -- a troca de canal no site é só uma
// preferência de navegação do youtube.com, não muda a identidade que a
// API de autorização usa. Adicionado `select_account` ao `prompt` (além
// do `consent` que já existia) pra o Google sempre mostrar a tela de
// escolha de CONTA (não canal) antes de autorizar -- se a De Bacco tiver
// uma conta Google DIFERENTE como gerente dela (não a
// marketingghelplus@gmail.com), essa tela deixa escolher essa outra
// conta na hora de conectar a 2ª marca, contornando o problema. Se não
// existir uma conta separada pra De Bacco, esse é um limite real da
// própria API do YouTube pra contas com mais de 1 canal de marca sob o
// mesmo login -- não tem nenhum parâmetro de OAuth que resolva isso.
//
// **74ª rodada, confirmado ao vivo**: a Raquel testou depois do deploy --
// a tela de escolha de CONTA apareceu de verdade (o `select_account`
// funcionou), mas GhelPlus e De Bacco são administradas pelo MESMO login
// Google (`marketingghelplus@gmail.com`), então só existe 1 conta pra
// escolher -- escolhendo ela, a tela seguinte mostrou só a "página"
// (canal) GhelPlus de novo, sem listar De Bacco como opção nenhuma. Ou
// seja: **é o cenário sem saída por código, confirmado de vez** -- não
// existe nenhum parâmetro de OAuth (nem `select_account`, nem nenhum
// outro documentado) que deixe escolher ENTRE canais/marcas de uma MESMA
// conta Google na hora de autorizar; só entre CONTAS diferentes. A saída
// de verdade exige uma ação da Raquel no lado do Google, não mais código
// daqui: dar a algum login Google diferente (pode ser um novo, criado só
// pra isso) permissão de "Proprietário" ou "Gerente" no canal De Bacco
// (YouTube Studio → De Bacco → Configurações → Permissões → Convidar) e
// depois conectar a De Bacco na Papoi logando com ESSE login novo, não o
// `marketingghelplus@gmail.com` -- aí sim o `select_account` já
// implementado vai ter uma 2ª conta de verdade pra oferecer.
router.get('/youtube/connect', requireAuth, requireSuperAdmin, (req, res) => {
  if (!youtubeConfigured()) {
    return res.status(503).json({ error: 'YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET ainda não configurados no servidor.' });
  }
  const { brand } = req.query;
  if (!YOUTUBE_BRANDS.includes(brand)) {
    return res.status(400).json({ error: 'Marca inválida para conexão com o YouTube.' });
  }
  const state = signState({ brand, userId: req.user.id, provider: 'youtube' });
  const qs = new URLSearchParams({
    client_id: YOUTUBE_CLIENT_ID,
    redirect_uri: YOUTUBE_REDIRECT_URI,
    response_type: 'code',
    scope: YOUTUBE_SCOPES,
    access_type: 'offline',
    prompt: 'consent select_account',
    state
  });
  res.json({ redirectUrl: `https://accounts.google.com/o/oauth2/v2/auth?${qs.toString()}` });
});

// ---------- YouTube: callback (o Google redireciona o NAVEGADOR pra cá) ----------
// Sem requireAuth, mesmo motivo do callback da Meta/LinkedIn acima.
router.get('/youtube/callback', async (req, res) => {
  const redirectBack = (params) => res.redirect(`${APP_BASE_URL}/?${new URLSearchParams(params).toString()}`);

  const { code, state, error, error_description: errorDescription } = req.query;
  if (error) {
    return redirectBack({ integracoes: 'erro', motivo: errorDescription || error });
  }
  if (!code || !state) {
    return redirectBack({ integracoes: 'erro', motivo: 'Resposta inesperada do Google (faltou code/state).' });
  }

  let statePayload;
  try {
    statePayload = verifyState(state);
  } catch (e) {
    return redirectBack({ integracoes: 'erro', motivo: 'Link de autorização expirado ou inválido — tente conectar de novo.' });
  }
  const { brand, userId } = statePayload;
  const requestingUser = db.get('users').find({ id: userId }).value();
  if (!requestingUser) {
    return redirectBack({ integracoes: 'erro', motivo: 'Usuário que iniciou a conexão não existe mais.' });
  }

  try {
    const token = await youtubeClient.exchangeCodeForToken({
      clientId: YOUTUBE_CLIENT_ID,
      clientSecret: YOUTUBE_CLIENT_SECRET,
      redirectUri: YOUTUBE_REDIRECT_URI,
      code
    });
    if (!token.refresh_token) {
      return redirectBack({
        integracoes: 'erro',
        motivo: 'O Google não devolveu uma autorização de longa duração dessa vez — normalmente acontece quando essa conta já autorizou a Papoi antes. Revogue o acesso da Papoi em myaccount.google.com/permissions e tente conectar de novo.'
      });
    }
    const channel = await youtubeClient.getMyChannel({ accessToken: token.access_token });
    if (!channel) {
      return redirectBack({
        integracoes: 'erro',
        motivo: 'Nenhum canal do YouTube foi encontrado nessa conta. Confirme se o canal certo estava ativo (ver seletor de contas do YouTube) antes de conectar.'
      });
    }

    // Mesmo espírito da 6ª correção da Meta: nunca escolhe sozinha, mesmo
    // vindo só 1 canal (aqui é sempre só 1, ver utils/youtubeClient.js) --
    // sempre para e pede confirmação explícita de qual marca é essa.
    cleanupExpiredYoutubeSelections();
    const selectionId = nanoid();
    youtubePendingSelections.set(selectionId, {
      brand,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + PENDING_TTL_MS,
      candidates: [{ channelId: channel.channelId, channelTitle: channel.channelTitle }]
    });
    return redirectBack({ integracoes: 'escolher-youtube', brand, selectionId });
  } catch (e) {
    const motivo = e instanceof youtubeClient.YouTubeApiError ? e.message : 'Erro inesperado ao conectar com o YouTube.';
    return redirectBack({ integracoes: 'erro', motivo });
  }
});

// ---------- YouTube: ver o canal candidato de uma escolha pendente ----------
router.get('/youtube/pending/:selectionId', requireAuth, requireSuperAdmin, (req, res) => {
  cleanupExpiredYoutubeSelections();
  const sel = youtubePendingSelections.get(req.params.selectionId);
  if (!sel) return res.status(404).json({ error: 'Essa conexão expirou ou já foi concluída — clique em "Conectar conta YouTube" de novo.' });
  res.json({
    brand: sel.brand,
    brandLabel: BRAND_LABEL_PT[sel.brand] || sel.brand,
    // Refresh token NUNCA sai daqui -- só o suficiente pra pessoa reconhecer
    // visualmente qual canal é qual.
    candidates: sel.candidates.map((c) => ({ channelId: c.channelId, channelTitle: c.channelTitle }))
  });
});

// ---------- YouTube: confirmar que o canal encontrado é o certo pra essa marca ----------
router.post('/youtube/pending/:selectionId/confirm', requireAuth, requireSuperAdmin, (req, res) => {
  cleanupExpiredYoutubeSelections();
  const sel = youtubePendingSelections.get(req.params.selectionId);
  if (!sel) return res.status(404).json({ error: 'Essa conexão expirou ou já foi concluída — clique em "Conectar conta YouTube" de novo.' });
  const { channelId } = req.body || {};
  const chosen = sel.candidates.find((c) => c.channelId === channelId);
  if (!chosen) return res.status(400).json({ error: 'Canal inválido.' });

  const nowIso = new Date().toISOString();
  const accountData = {
    brand: sel.brand,
    platform: 'youtube',
    channelId: chosen.channelId,
    channelTitle: chosen.channelTitle,
    refreshToken: sel.refreshToken,
    connectedBy: req.user.id,
    connectedByName: req.user.name || req.user.username,
    connectedAt: nowIso
  };
  const existing = db.get('socialAccounts').find({ brand: sel.brand, platform: 'youtube' }).value();
  if (existing) {
    db.get('socialAccounts').find({ id: existing.id }).assign(accountData).write();
  } else {
    db.get('socialAccounts').push(Object.assign({ id: nanoid() }, accountData)).write();
  }
  logAudit({ user: req.user, entityType: 'socialAccount', entityId: sel.brand, entityLabel: `YouTube · ${BRAND_LABEL_PT[sel.brand] || sel.brand}`, action: existing ? 'update' : 'create', details: `Conectado como ${accountData.channelTitle}` });

  youtubePendingSelections.delete(req.params.selectionId);
  res.json({ ok: true, brand: sel.brand, channelTitle: accountData.channelTitle });
});

// ---------- YouTube: desconectar ----------
router.delete('/youtube/:brand', requireAuth, requireSuperAdmin, (req, res) => {
  const { brand } = req.params;
  const existing = db.get('socialAccounts').find({ brand, platform: 'youtube' }).value();
  if (!existing) return res.status(404).json({ error: 'Essa marca não está conectada.' });
  db.get('socialAccounts').remove({ id: existing.id }).write();
  logAudit({ user: req.user, entityType: 'socialAccount', entityId: brand, entityLabel: `YouTube · ${BRAND_LABEL_PT[brand] || brand}`, action: 'delete' });
  res.json({ ok: true });
});

module.exports = router;
module.exports.META_BRANDS = META_BRANDS;
module.exports.LINKEDIN_BRANDS = LINKEDIN_BRANDS;
module.exports.YOUTUBE_BRANDS = YOUTUBE_BRANDS;
