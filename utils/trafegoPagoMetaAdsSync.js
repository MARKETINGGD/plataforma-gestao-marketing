// Sincronização automática de resultados do Meta Ads com as campanhas
// planejadas no Tráfego Pago. Só mexe nos campos de ENTREGA do anúncio
// (status, investido, impressões, cliques, alcance, frequência) — nunca em
// receita/conversões/engajamento/observações, que continuam 100% manuais
// (dependem de rastreamento de conversão específico de cada campanha, ainda
// não mapeado automaticamente — ver handoff pra próxima fase).
//
// 156ª rodada: porte idêntico de utils/metaAdsSync.js do app separado —
// só as coleções do banco mudaram de nome (campaigns/results ->
// trafegoPagoCampaigns/trafegoPagoResults, pra conviver com as ~50
// coleções já existentes da Papoi) e updatedBy virou updatedById (convenção
// da Papoi: nome resolvido ao vivo pelo id, não texto solto — ver
// utils/names.js). A lógica de sincronização em si não mudou em nada.
const db = require('../db');
const metaAdsClient = require('./trafegoPagoMetaAdsClient');

function mapEffectiveStatus(status) {
  switch (status) {
    case 'ACTIVE': return 'running';
    case 'PAUSED':
    case 'CAMPAIGN_PAUSED':
    case 'ADSET_PAUSED': return 'paused';
    case 'ARCHIVED':
    case 'DELETED': return 'done';
    default: return 'planned'; // PENDING_REVIEW, PREAPPROVED, PENDING_BILLING_INFO, IN_PROCESS, WITH_ISSUES, ...
  }
}

function defaultResult(campaignId, platform) {
  return {
    campaignId, platform, status: 'planned', budget: 0, spend: 0, revenue: 0,
    impressions: 0, clicks: 0, conversions: 0, frequency: 0, reach: 0, engagement: 0,
    notes: '', updatedAt: null, updatedById: null, updatedBy: null
  };
}

// Sincroniza UMA campanha já vinculada (campaign.metaCampaignId definido).
async function syncCampaign(campaign, { fetchImpl, statusRemote } = {}) {
  if (!campaign || !campaign.metaCampaignId) return null;
  const [remote, insights] = await Promise.all([
    statusRemote !== undefined
      ? Promise.resolve(statusRemote)
      : metaAdsClient.listAccountCampaigns({ fetchImpl }).then((list) => list.find((c) => c.id === campaign.metaCampaignId)),
    metaAdsClient.getCampaignInsights(campaign.metaCampaignId, {
      since: campaign.start || undefined,
      until: campaign.end || undefined,
      fetchImpl
    })
  ]);
  const now = new Date().toISOString();
  const existing = db.get('trafegoPagoResults').find({ campaignId: campaign.id, platform: 'Meta' }).value();
  const base = existing || defaultResult(campaign.id, 'Meta');
  const merged = {
    ...base,
    campaignId: campaign.id,
    platform: 'Meta',
    status: remote ? mapEffectiveStatus(remote.effective_status) : base.status,
    spend: insights.spend,
    impressions: insights.impressions,
    clicks: insights.clicks,
    reach: insights.reach,
    frequency: insights.frequency,
    updatedAt: now,
    updatedById: null,
    updatedBy: 'Meta Ads (sincronização automática)'
  };
  if (existing) db.get('trafegoPagoResults').find({ campaignId: campaign.id, platform: 'Meta' }).assign(merged).write();
  else db.get('trafegoPagoResults').push(merged).write();
  db.get('trafegoPagoCampaigns').find({ id: campaign.id }).assign({ metaLastSyncAt: now }).write();
  return merged;
}

// Roda um ciclo completo: busca a lista de campanhas do Meta UMA vez e
// sincroniza todas as campanhas do Tráfego Pago que estiverem vinculadas
// (de qualquer marca). Erro numa campanha não impede as outras de sincronizar.
async function runSync({ fetchImpl } = {}) {
  if (!metaAdsClient.isConfigured()) return { skipped: true, reason: 'not-configured' };
  const campaigns = db.get('trafegoPagoCampaigns').filter((c) => !!c.metaCampaignId).value();
  if (!campaigns.length) return { synced: 0 };
  let remoteList = [];
  try {
    remoteList = await metaAdsClient.listAccountCampaigns({ fetchImpl });
  } catch (e) {
    console.error('[trafegoPagoMetaAdsSync] falha ao listar campanhas da Meta:', e.message);
    return { synced: 0, error: e.message };
  }
  let synced = 0;
  const errors = [];
  for (const campaign of campaigns) {
    try {
      const remote = remoteList.find((r) => r.id === campaign.metaCampaignId);
      await syncCampaign(campaign, { fetchImpl, statusRemote: remote });
      synced++;
    } catch (e) {
      errors.push({ campaignId: campaign.id, error: e.message });
      console.error(`[trafegoPagoMetaAdsSync] falha ao sincronizar campanha ${campaign.id}:`, e.message);
    }
  }
  return { synced, errors };
}

let started = false;
let intervalHandle = null;
const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos

function startTrafegoPagoMetaAdsSyncScheduler() {
  if (started) return;
  started = true;
  if (!metaAdsClient.isConfigured()) {
    console.log('[trafegoPagoMetaAdsSync] META_ADS_ACCESS_TOKEN/META_ADS_ACCOUNT_ID ausentes — sincronização automática desativada.');
    return;
  }
  intervalHandle = setInterval(() => {
    runSync().catch((e) => console.error('[trafegoPagoMetaAdsSync] erro inesperado no ciclo:', e.message));
  }, SYNC_INTERVAL_MS);
  console.log('[trafegoPagoMetaAdsSync] Sincronização automática do Meta Ads iniciada (a cada 30 min).');
}

function _resetForTests() {
  started = false;
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

module.exports = { syncCampaign, runSync, startTrafegoPagoMetaAdsSyncScheduler, mapEffectiveStatus, _resetForTests };
