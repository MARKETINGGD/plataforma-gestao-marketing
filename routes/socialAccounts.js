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

module.exports = router;
module.exports.META_BRANDS = META_BRANDS;
