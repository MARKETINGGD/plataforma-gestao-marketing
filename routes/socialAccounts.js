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

// Permissões pedidas no fluxo "Business Login for Instagram" (Facebook
// Login + Página vinculada) — ver PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md
// pro histórico completo de tentativas.
//
// **2ª correção, 23/09/2026**: tanto `instagram_business_content_publish`
// quanto `instagram_content_publish` sozinhos (só trocando o nome da
// permissão) foram rejeitados pelo diálogo de autorização com "Invalid
// Scopes" -- o problema não era só o nome, era faltar 2 parâmetros
// especiais que a Meta exige nesse fluxo específico (chamado "Business
// Login for Instagram" na documentação oficial): `display=page` e
// `extras={"setup":{"channel":"IG_API_ONBOARDING"}}`. Sem esses dois, o
// diálogo não reconhece NENHUMA permissão de publicação do Instagram como
// válida, não importa o nome. Além disso, esse fluxo exige
// `response_type=token` (não `code`) -- a Meta devolve o token (inclusive
// já de longa duração, em `long_lived_token`) direto na URL de retorno,
// como fragmento (`#access_token=...`), não como parâmetro de busca. Como
// fragmento nunca chega no servidor (só existe no navegador), o fluxo
// mudou: o front-end (`public/app.js`, `checkMetaOAuthFragment`) lê o
// fragmento e manda o token pro backend terminar a conexão (ver
// `POST /meta/finish` abaixo) -- por isso não existe mais uma rota
// `GET /meta/callback` aqui: a Redirect URI cadastrada na Meta continua a
// mesma (`/api/social-accounts/meta/callback`), só que agora esse caminho
// não tem rota própria neste arquivo, e cai automaticamente na tela normal
// da Papoi (catch-all de `server.js`) -- é lá, já dentro da Plataforma
// carregada, que o JavaScript lê o fragmento.
const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
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
    display: 'page',
    extras: JSON.stringify({ setup: { channel: 'IG_API_ONBOARDING' } }),
    response_type: 'token'
  });
  res.json({ redirectUrl: `https://www.facebook.com/v21.0/dialog/oauth?${qs.toString()}` });
});

// ---------- terminar a conexão (chamado pelo FRONT-END, não pela Meta) ----------
// Com response_type=token, a Meta devolve o token como FRAGMENTO da URL
// (#access_token=...), que nunca chega ao servidor (só existe no
// navegador) -- por isso não existe mais uma rota de callback aqui. O
// front-end lê o fragmento (`checkMetaOAuthFragment` em public/app.js) e
// chama esta rota pra terminar a conexão. Exige login (requireAuth) E o
// `state` assinado bater (dupla checagem: a pessoa ainda está logada como
// super admin agora, e foi ela mesma quem iniciou o fluxo antes).
router.post('/meta/finish', requireAuth, requireSuperAdmin, async (req, res) => {
  const { state, longLivedToken, expiresIn } = req.body || {};
  if (!state || !longLivedToken) {
    return res.status(400).json({ error: 'Resposta incompleta vinda da Meta (faltou token).' });
  }
  let statePayload;
  try {
    statePayload = verifyState(state);
  } catch (e) {
    return res.status(400).json({ error: 'Link de autorização expirado ou inválido — tente conectar de novo.' });
  }
  const { brand, userId } = statePayload;
  if (userId !== req.user.id) {
    return res.status(403).json({ error: 'Essa autorização foi iniciada por outra pessoa.' });
  }
  const requestingUser = db.get('users').find({ id: userId }).value();
  if (!requestingUser) {
    return res.status(400).json({ error: 'Usuário que iniciou a conexão não existe mais.' });
  }

  try {
    const pages = await metaGraph.getManagedPages({ userAccessToken: longLivedToken });
    const pageWithInstagram = pages.find((p) => p.instagram_business_account);
    if (!pageWithInstagram) {
      return res.status(400).json({
        error: 'Nenhuma Página do Facebook com conta do Instagram vinculada foi encontrada nessa conta. Confirme se a Página certa foi selecionada na tela de permissão do Facebook.'
      });
    }

    const nowIso = new Date().toISOString();
    // Token já vem de longa duração (~60 dias) direto da Meta nesse fluxo
    // -- grava a data de expiração pra o publicador (utils/metaPublisher.js)
    // avisar antes de vencer, em vez de só falhar silenciosamente lá na
    // frente.
    const expiresInSeconds = Number(expiresIn) || 60 * 24 * 60 * 60;
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

    return res.json({ ok: true, brand });
  } catch (e) {
    const motivo = e instanceof metaGraph.MetaGraphError ? e.message : 'Erro inesperado ao conectar com a Meta.';
    return res.status(502).json({ error: motivo });
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
