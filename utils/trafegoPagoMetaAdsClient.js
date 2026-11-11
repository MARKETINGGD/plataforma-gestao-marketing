// Cliente HTTP para a Marketing API do Meta (Facebook/Instagram Ads).
// Isolado num módulo próprio pra poder ser mockado nos testes — nenhuma
// outra parte do código faz fetch direto pra graph.facebook.com.
// Credenciais vêm só de variáveis de ambiente (nunca hardcoded):
//   META_ADS_ACCESS_TOKEN — token do Usuário de Sistema (ads_read)
//   META_ADS_ACCOUNT_ID   — ID numérico da conta de anúncios (sem "act_")
const GRAPH_VERSION = 'v21.0';

function isConfigured() {
  return !!(process.env.META_ADS_ACCESS_TOKEN && process.env.META_ADS_ACCOUNT_ID);
}

function accountPath() {
  const id = String(process.env.META_ADS_ACCOUNT_ID || '').replace(/^act_/, '');
  return `act_${id}`;
}

async function graphGet(path, params = {}, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  url.searchParams.set('access_token', process.env.META_ADS_ACCESS_TOKEN);
  const res = await doFetch(url.toString());
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const msg = (json.error && json.error.message) || `Erro HTTP ${res.status} na Graph API`;
    const err = new Error(msg);
    err.graphError = json.error;
    throw err;
  }
  return json;
}

// Lista campanhas da conta de anúncios compartilhada (usada pelas duas
// marcas, Ghel e De Bacco — diferenciadas pelo prefixo no nome).
async function listAccountCampaigns({ fetchImpl } = {}) {
  if (!isConfigured()) throw new Error('Meta Ads não configurado (faltam variáveis de ambiente).');
  const json = await graphGet(`${accountPath()}/campaigns`, {
    fields: 'id,name,effective_status,objective,start_time,stop_time',
    limit: 300
  }, fetchImpl);
  return json.data || [];
}

// Métricas reais de entrega (gasto, impressões, cliques, alcance,
// frequência) de UMA campanha específica, no período pedido (ou vitalício
// — "maximum" — se a campanha não tiver datas de início/fim definidas).
async function getCampaignInsights(campaignId, { since, until, fetchImpl } = {}) {
  if (!isConfigured()) throw new Error('Meta Ads não configurado (faltam variáveis de ambiente).');
  const params = { fields: 'spend,impressions,clicks,reach,frequency' };
  if (since && until) params.time_range = { since, until };
  else params.date_preset = 'maximum';
  const json = await graphGet(`${campaignId}/insights`, params, fetchImpl);
  const row = (json.data && json.data[0]) || {};
  return {
    spend: Number(row.spend) || 0,
    impressions: Number(row.impressions) || 0,
    clicks: Number(row.clicks) || 0,
    reach: Number(row.reach) || 0,
    frequency: Number(row.frequency) || 0
  };
}

module.exports = { isConfigured, listAccountCampaigns, getCampaignInsights, GRAPH_VERSION, accountPath };
