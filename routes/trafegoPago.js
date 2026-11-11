const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { resolveUserName } = require('../utils/names');
const shareLinks = require('../utils/shareLinks');
const metaAdsClient = require('../utils/trafegoPagoMetaAdsClient');
const { syncCampaign } = require('../utils/trafegoPagoMetaAdsSync');

const router = express.Router();

// 156ª rodada, pedido da Raquel: "eu quero que ele pertença a plataforma,
// que fique dentro dela. Com o login dela, mas quero que mantenha o link
// externo de visualização" — migração do Tráfego Pago de um app Railway
// separado (login/dados próprios) pra dentro da Papoi, como módulo nativo:
// mesmo login/sessão da Papoi, dados nas coleções `trafegoPago*` abaixo
// (nunca mais em outro banco), permissão por usuário na chave já existente
// `permissions.trafegoPago` (ver EMPTY_PERMISSIONS em routes/auth.js — a
// chave já existia, só nunca tinha sido usada pra nada além do SSO do
// iframe antigo em routes/dashboards.js), link externo via
// utils/shareLinks.js (mesmo padrão do Orçamento/Brindes/Expositores, no
// lugar do token caseiro que o app separado usava) e histórico de ações no
// `auditLog` global da Papoi (igual a todo módulo).
//
// Visualização: SEMPRE que a pessoa está logada na Papoi, igual o
// comportamento de sempre do hub de dashboards (dashboards.js) — permissão
// 'none' nunca bloqueou ABRIR/VER os 3 dashboards (Tráfego Pago, Mídias,
// Ações Sazonais), só o Orçamento é que sempre foi privado por padrão. Pra
// não mudar esse comportamento na migração, aqui só existe uma checagem de
// EDIÇÃO (`requireTrafegoPagoEdit`, abaixo) — ver/abrir continua liberado
// pra qualquer pessoa logada (`requireAuth` sozinho).
function accessOf(req) {
  const user = db.get('users').find({ id: req.user.id }).value();
  return user ? (user.permissions || {}).trafegoPago || 'none' : 'none';
}

function requireTrafegoPagoEdit(req, res, next) {
  const access = accessOf(req);
  if (access !== 'editor' && access !== 'admin') {
    return res.status(403).json({ error: 'Você não tem permissão para editar o Tráfego Pago.' });
  }
  next();
}

function defaultResult(campaignId, platform) {
  return {
    campaignId, platform, status: 'planned', budget: 0, spend: 0, revenue: 0,
    impressions: 0, clicks: 0, conversions: 0, frequency: 0, reach: 0, engagement: 0,
    notes: '', updatedAt: null, updatedById: null, updatedBy: null
  };
}

function resultsForCampaign(c) {
  const plats = (c.platforms && c.platforms.length) ? c.platforms : ['Meta'];
  const rows = db.get('trafegoPagoResults').filter({ campaignId: c.id }).value();
  return plats.map((p) => {
    const row = rows.find((r) => r.platform === p) || defaultResult(c.id, p);
    return Object.assign({}, row, { updatedBy: resolveUserName(row.updatedById, row.updatedBy) });
  });
}

function ensureResultRows(c) {
  const plats = (c.platforms && c.platforms.length) ? c.platforms : ['Meta'];
  const rows = db.get('trafegoPagoResults').filter({ campaignId: c.id }).value();
  plats.forEach((p) => {
    if (!rows.find((r) => r.platform === p)) {
      db.get('trafegoPagoResults').push(defaultResult(c.id, p)).write();
    }
  });
}

function logTrafegoAudit({ user, brand, entityType, entityId, entityLabel, action, details }) {
  logAudit({ user, entityType, entityId, entityLabel, action, details, meta: { brand } });
}

// ---------- Campanhas ----------

router.get('/brands/:brand/campaigns', requireAuth, (req, res) => {
  const { brand } = req.params;
  const campaigns = db.get('trafegoPagoCampaigns').filter({ brand }).value();
  const merged = campaigns.map((c) => ({ ...c, results: resultsForCampaign(c) }));
  res.json({ campaigns: merged });
});

router.post('/brands/:brand/campaigns', requireAuth, requireTrafegoPagoEdit, (req, res) => {
  const { brand } = req.params;
  const now = new Date().toISOString();
  const c = { id: nanoid(), brand, ...req.body, createdAt: now, updatedAt: now };
  db.get('trafegoPagoCampaigns').push(c).write();
  ensureResultRows(c);
  logTrafegoAudit({
    user: req.user, brand, entityType: 'trafegoPagoCampaign', entityId: c.id, entityLabel: c.name,
    action: 'create', details: `Quarter ${c.quarter} · ${(c.platforms || []).join(', ')}`
  });
  res.json({ campaign: { ...c, results: resultsForCampaign(c) } });
});

router.put('/campaigns/:id', requireAuth, requireTrafegoPagoEdit, (req, res) => {
  const { id } = req.params;
  const existing = db.get('trafegoPagoCampaigns').find({ id }).value();
  if (!existing) return res.status(404).json({ error: 'Campanha não encontrada.' });
  const now = new Date().toISOString();
  db.get('trafegoPagoCampaigns').find({ id }).assign({ ...req.body, updatedAt: now }).write();
  logTrafegoAudit({
    user: req.user, brand: existing.brand, entityType: 'trafegoPagoCampaign', entityId: id,
    entityLabel: req.body.name || existing.name, action: 'update', details: 'Dados da campanha editados'
  });
  const campaign = db.get('trafegoPagoCampaigns').find({ id }).value();
  ensureResultRows(campaign);
  res.json({ campaign: { ...campaign, results: resultsForCampaign(campaign) } });
});

router.delete('/campaigns/:id', requireAuth, requireTrafegoPagoEdit, (req, res) => {
  const { id } = req.params;
  const existing = db.get('trafegoPagoCampaigns').find({ id }).value();
  if (!existing) return res.status(404).json({ error: 'Campanha não encontrada.' });
  db.get('trafegoPagoCampaigns').remove({ id }).write();
  db.get('trafegoPagoResults').remove({ campaignId: id }).write();
  logTrafegoAudit({
    user: req.user, brand: existing.brand, entityType: 'trafegoPagoCampaign', entityId: id,
    entityLabel: existing.name, action: 'delete', details: 'Campanha e resultados excluídos'
  });
  res.json({ ok: true });
});

router.put('/campaigns/:id/results', requireAuth, requireTrafegoPagoEdit, (req, res) => {
  const { id } = req.params;
  const campaign = db.get('trafegoPagoCampaigns').find({ id }).value();
  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });
  const platform = req.body.platform || (campaign.platforms && campaign.platforms[0]) || 'Meta';
  const now = new Date().toISOString();
  const existing = db.get('trafegoPagoResults').find({ campaignId: id, platform }).value();
  const merged = {
    ...defaultResult(id, platform), ...existing, ...req.body,
    campaignId: id, platform, updatedAt: now, updatedById: req.user.id, updatedBy: null
  };
  if (existing) db.get('trafegoPagoResults').find({ campaignId: id, platform }).assign(merged).write();
  else db.get('trafegoPagoResults').push(merged).write();
  logTrafegoAudit({
    user: req.user, brand: campaign.brand, entityType: 'trafegoPagoResult', entityId: id,
    entityLabel: `${campaign.name} · ${platform}`, action: 'update',
    details: `Rede: ${platform} · Status: ${merged.status} · Investido: R$${merged.spend} · Receita: R$${merged.revenue} · Conversões: ${merged.conversions}`
  });
  res.json({ result: Object.assign({}, merged, { updatedBy: resolveUserName(merged.updatedById, merged.updatedBy) }), results: resultsForCampaign(campaign) });
});

// ---------- Mensal ----------

router.get('/brands/:brand/monthly', requireAuth, (req, res) => {
  const monthly = db.get('trafegoPagoMonthly').filter({ brand: req.params.brand }).value()
    .map((m) => Object.assign({}, m, { updatedBy: resolveUserName(m.updatedById, m.updatedBy) }));
  res.json({ monthly });
});

router.post('/brands/:brand/monthly', requireAuth, requireTrafegoPagoEdit, (req, res) => {
  const { brand } = req.params;
  const now = new Date().toISOString();
  const existing = db.get('trafegoPagoMonthly').find({ brand, month: req.body.month }).value();
  let entry;
  if (existing) {
    entry = { ...existing, ...req.body, brand, updatedAt: now, updatedById: req.user.id, updatedBy: null };
    db.get('trafegoPagoMonthly').find({ id: existing.id }).assign(entry).write();
  } else {
    entry = { id: nanoid(), brand, ...req.body, updatedAt: now, updatedById: req.user.id, updatedBy: null };
    db.get('trafegoPagoMonthly').push(entry).write();
  }
  logTrafegoAudit({
    user: req.user, brand, entityType: 'trafegoPagoMonthly', entityId: entry.id, entityLabel: entry.month,
    action: existing ? 'update' : 'create',
    details: `Investimento: R$${entry.investment || 0} · Seguidores: ${entry.followers || 0} · Engajamento: ${entry.engagement || 0}`
  });
  res.json({ monthly: Object.assign({}, entry, { updatedBy: resolveUserName(entry.updatedById, entry.updatedBy) }) });
});

router.put('/monthly/:id', requireAuth, requireTrafegoPagoEdit, (req, res) => {
  const existing = db.get('trafegoPagoMonthly').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Registro não encontrado.' });
  const now = new Date().toISOString();
  const updated = { ...existing, ...req.body, id: existing.id, brand: existing.brand, updatedAt: now, updatedById: req.user.id, updatedBy: null };
  db.get('trafegoPagoMonthly').find({ id: existing.id }).assign(updated).write();
  logTrafegoAudit({
    user: req.user, brand: existing.brand, entityType: 'trafegoPagoMonthly', entityId: existing.id, entityLabel: updated.month,
    action: 'update',
    details: `Investimento: R$${updated.investment || 0} · Seguidores: ${updated.followers || 0} · Engajamento: ${updated.engagement || 0}`
  });
  res.json({ monthly: Object.assign({}, updated, { updatedBy: resolveUserName(updated.updatedById, updated.updatedBy) }) });
});

router.delete('/monthly/:id', requireAuth, requireTrafegoPagoEdit, (req, res) => {
  const existing = db.get('trafegoPagoMonthly').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Registro não encontrado.' });
  db.get('trafegoPagoMonthly').remove({ id: req.params.id }).write();
  logTrafegoAudit({
    user: req.user, brand: existing.brand, entityType: 'trafegoPagoMonthly', entityId: existing.id, entityLabel: existing.month,
    action: 'delete', details: 'Registro mensal excluído'
  });
  res.json({ ok: true });
});

// ---------- Configurações (título do dashboard por marca) ----------

router.get('/brands/:brand/settings', requireAuth, (req, res) => {
  const settings = db.get('trafegoPagoSettings').find({ brand: req.params.brand }).value();
  res.json({ settings: settings || { brand: req.params.brand, tagline: '' } });
});

router.put('/brands/:brand/settings', requireAuth, requireTrafegoPagoEdit, (req, res) => {
  const { brand } = req.params;
  const tagline = (req.body.tagline || '').trim();
  const now = new Date().toISOString();
  const existing = db.get('trafegoPagoSettings').find({ brand }).value();
  const data = { brand, tagline, updatedAt: now, updatedById: req.user.id, updatedBy: null };
  if (existing) db.get('trafegoPagoSettings').find({ brand }).assign(data).write();
  else db.get('trafegoPagoSettings').push(data).write();
  logTrafegoAudit({
    user: req.user, brand, entityType: 'trafegoPagoSettings', entityId: brand, entityLabel: 'Título do dashboard',
    action: 'update', details: `Novo título: "${tagline}"`
  });
  res.json({ settings: Object.assign({}, data, { updatedBy: resolveUserName(data.updatedById, data.updatedBy) }) });
});

// ---------- Histórico (auditoria) ----------

router.get('/brands/:brand/audit-log', requireAuth, (req, res) => {
  const { brand } = req.params;
  const logs = db.get('auditLog').value()
    .filter((e) => e.brand === brand && typeof e.entityType === 'string' && e.entityType.indexOf('trafegoPago') === 0)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ logs });
});

// ---------- Meta Ads (vínculo + sincronização) ----------

router.get('/meta/campaigns', requireAuth, requireTrafegoPagoEdit, async (req, res) => {
  try {
    const list = await metaAdsClient.listAccountCampaigns();
    const q = (req.query.q || '').trim().toLowerCase();
    const filtered = q ? list.filter((c) => (c.name || '').toLowerCase().includes(q)) : list;
    res.json({ campaigns: filtered.map((c) => ({ id: c.id, name: c.name, status: c.effective_status })) });
  } catch (e) {
    res.status(502).json({ error: 'Não foi possível buscar campanhas no Meta Ads: ' + e.message });
  }
});

router.put('/campaigns/:id/meta-link', requireAuth, requireTrafegoPagoEdit, (req, res) => {
  const { id } = req.params;
  const campaign = db.get('trafegoPagoCampaigns').find({ id }).value();
  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });
  const { metaCampaignId, metaCampaignName } = req.body;
  db.get('trafegoPagoCampaigns').find({ id }).assign({
    metaCampaignId: metaCampaignId || null,
    metaCampaignName: metaCampaignId ? (metaCampaignName || null) : null,
    metaLastSyncAt: metaCampaignId ? (campaign.metaLastSyncAt || null) : null
  }).write();
  logTrafegoAudit({
    user: req.user, brand: campaign.brand, entityType: 'trafegoPagoCampaign', entityId: id, entityLabel: campaign.name,
    action: 'update',
    details: metaCampaignId ? `Vinculada à campanha do Meta Ads: ${metaCampaignName || metaCampaignId}` : 'Desvinculada do Meta Ads'
  });
  res.json({ campaign: db.get('trafegoPagoCampaigns').find({ id }).value() });
});

router.post('/campaigns/:id/meta-sync', requireAuth, requireTrafegoPagoEdit, async (req, res) => {
  const { id } = req.params;
  const campaign = db.get('trafegoPagoCampaigns').find({ id }).value();
  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });
  if (!campaign.metaCampaignId) return res.status(400).json({ error: 'Esta campanha ainda não está vinculada a uma campanha do Meta Ads.' });
  try {
    const result = await syncCampaign(campaign);
    res.json({ result });
  } catch (e) {
    res.status(502).json({ error: 'Não foi possível sincronizar com o Meta Ads: ' + e.message });
  }
});

// ---------- Link externo (via utils/shareLinks.js, mesmo padrão do
// Orçamento/Brindes/Expositores) ----------
// Substitui o token caseiro do app separado — a Raquel confirmou que o
// link antigo pode quebrar (apontava pra um domínio que vai ser
// desligado) e que um link novo gerado pela Papoi está certo.

router.get('/public/:token', (req, res) => {
  const link = shareLinks.findByToken(req.params.token);
  if (!link || link.resource !== 'trafegoPago') return res.status(404).json({ error: 'Link inválido ou desativado.' });
  const brand = link.scopeKey;
  const campaigns = db.get('trafegoPagoCampaigns').filter({ brand }).value()
    .map((c) => ({ ...c, results: resultsForCampaign(c) }));
  const monthly = db.get('trafegoPagoMonthly').filter({ brand }).value()
    .map((m) => Object.assign({}, m, { updatedBy: resolveUserName(m.updatedById, m.updatedBy) }));
  const settings = db.get('trafegoPagoSettings').find({ brand }).value() || { brand, tagline: '' };
  res.json({ brand, campaigns, monthly, settings });
});

router.get('/public-link', requireAuth, requireTrafegoPagoEdit, (req, res) => {
  const { brand } = req.query;
  const link = shareLinks.getLink('trafegoPago', brand);
  res.json({ publicToken: link ? link.token : null });
});

router.post('/public-link/generate', requireAuth, requireTrafegoPagoEdit, (req, res) => {
  const { brand } = req.body || {};
  if (!brand) return res.status(400).json({ error: 'Escolha a marca.' });
  const token = shareLinks.generateLink('trafegoPago', brand, req);
  logTrafegoAudit({ user: req.user, brand, entityType: 'trafegoPagoShareLink', entityId: 'trafegoPago:' + brand, entityLabel: 'Tráfego Pago · ' + brand, action: 'generate_public_link' });
  res.json({ publicToken: token });
});

router.delete('/public-link', requireAuth, requireTrafegoPagoEdit, (req, res) => {
  const { brand } = req.query;
  shareLinks.revokeLink('trafegoPago', brand);
  logTrafegoAudit({ user: req.user, brand, entityType: 'trafegoPagoShareLink', entityId: 'trafegoPago:' + brand, entityLabel: 'Tráfego Pago · ' + brand, action: 'revoke_public_link' });
  res.json({ ok: true });
});

module.exports = router;
