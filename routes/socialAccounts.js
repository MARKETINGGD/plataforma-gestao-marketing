const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth, requireSuperAdmin, JWT_SECRET } = require('../middleware/auth');
const { resolveUserName } = require('../utils/names');
const { logAudit } = require('../utils/audit');
const metaGraph = require('../utils/metaGraphClient');

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

// Permissões pedidas no fluxo "clássico" (Facebook Login for Business +
// Página vinculada) — ver PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md pro
// levantamento completo de cada uma.
const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_business_content_publish',
  'business_management'
].join(',');

function metaConfigured() {
  return !!(META_APP_ID && META_APP_SECRET);
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

// ---------- listar status das conexões (tela "Integrações") ----------
router.get('/', requireAuth, requireSuperAdmin, (req, res) => {
  const accounts = META_BRANDS.map((brand) => {
    const account = db.get('socialAccounts').find({ brand, platform: 'meta' }).value();
    return {
      brand,
      brandLabel: BRAND_LABEL_PT[brand],
      connected: !!account,
      account: serialize(account)
    };
  });
  res.json({ metaConfigured: metaConfigured(), accounts });
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
  res.json({ redirectUrl: `https://www.facebook.com/v21.0/dialog/oauth?${qs.toString()}` });
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
    const pageWithInstagram = pages.find((p) => p.instagram_business_account);
    if (!pageWithInstagram) {
      return redirectBack({
        integracoes: 'erro',
        motivo: 'Nenhuma Página do Facebook com conta do Instagram vinculada foi encontrada nessa conta. Confirme se a Página certa foi selecionada na tela de permissão do Facebook.'
      });
    }

    const nowIso = new Date().toISOString();
    // Token de longa duração da Meta dura ~60 dias — grava a data de
    // expiração pra o publicador (utils/metaPublisher.js) avisar antes de
    // vencer, em vez de só falhar silenciosamente lá na frente.
    const expiresInSeconds = longLived.expires_in || 60 * 24 * 60 * 60;
    const tokenExpiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    const existing = db.get('socialAccounts').find({ brand, platform: 'meta' }).value();
    const accountData = {
      brand,
      platform: 'meta',
      igUserId: pageWithInstagram.instagram_business_account.id,
      igUsername: pageWithInstagram.instagram_business_account.username || null,
      pageId: pageWithInstagram.id,
      pageName: pageWithInstagram.name,
      pageAccessToken: pageWithInstagram.access_token,
      tokenExpiresAt,
      connectedBy: requestingUser.id,
      connectedByName: requestingUser.name || requestingUser.username,
      connectedAt: nowIso
    };
    if (existing) {
      db.get('socialAccounts').find({ id: existing.id }).assign(accountData).write();
    } else {
      db.get('socialAccounts').push(Object.assign({ id: nanoid() }, accountData)).write();
    }
    logAudit({ user: requestingUser, entityType: 'socialAccount', entityId: brand, entityLabel: `Meta · ${BRAND_LABEL_PT[brand] || brand}`, action: existing ? 'update' : 'create', details: `Conectado como @${accountData.igUsername || accountData.pageName}` });

    return redirectBack({ integracoes: 'ok', brand });
  } catch (e) {
    const motivo = e instanceof metaGraph.MetaGraphError ? e.message : 'Erro inesperado ao conectar com a Meta.';
    return redirectBack({ integracoes: 'erro', motivo });
  }
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

module.exports = router;
module.exports.META_BRANDS = META_BRANDS;
