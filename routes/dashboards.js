const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// Catálogo dos dashboards existentes. As URLs vêm de variáveis de ambiente
// (ver .env.example) para não precisar mexer no código se o domínio mudar.
const DASHBOARDS = [
  {
    key: 'trafegoPago',
    label: 'Tráfego Pago',
    description: 'Planejamento e resultados de campanhas pagas',
    url: process.env.TRAFEGO_PAGO_URL || ''
  },
  {
    key: 'acoesSazonais',
    label: 'Ações Sazonais',
    description: 'Ações de marketing, expositores especiais e orçamento anual',
    url: process.env.ACOES_SAZONAIS_URL || ''
  },
  {
    key: 'redesSociais',
    label: 'Redes Sociais',
    description: 'Resultados de redes sociais, site, blog e assessoria',
    url: process.env.REDES_SOCIAIS_URL || ''
  }
];

// Lista os dashboards e o nível de acesso do usuário logado em cada um
// ('none' | 'editor' | 'admin'), para montar os botões na tela inicial.
router.get('/', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado. Faça login novamente.' });
  const permissions = user.permissions || {};
  res.json({
    dashboards: DASHBOARDS.map((d) => ({ ...d, access: permissions[d.key] || 'none' })),
    budgetAccess: permissions.budget || 'none'
  });
});

// Gera um link de acesso direto ao dashboard escolhido, já autenticado
// (login único): o token é assinado com o MESMO JWT_SECRET configurado nos
// outros 3 projetos, então o dashboard de destino aceita sem pedir login.
//
// Qualquer pessoa logada na Plataforma pode ABRIR e VER os 3 dashboards —
// só o Orçamento (rota /api/budget) continua restrito por permissão. Quem
// não tem permissão de edição (`access === 'none'`) entra como visitante:
// o "role" repassado no token de handoff reflete isso, e cada dashboard
// decide por conta própria o que essa pessoa pode editar por lá.
router.get('/launch/:key', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado. Faça login novamente.' });

  const dashboard = DASHBOARDS.find((d) => d.key === req.params.key);
  if (!dashboard) return res.status(404).json({ error: 'Dashboard não encontrado.' });

  const access = (user.permissions || {})[dashboard.key] || 'none';
  if (!dashboard.url) return res.status(500).json({ error: `URL do dashboard "${dashboard.label}" ainda não foi configurada na plataforma.` });

  const handoffUser = { id: user.id, username: user.username, role: access };
  const handoffToken = jwt.sign(handoffUser, JWT_SECRET, { expiresIn: '30d' });

  const url = `${dashboard.url}/?platformToken=${encodeURIComponent(handoffToken)}&platformUser=${encodeURIComponent(JSON.stringify(handoffUser))}`;
  res.json({ url });
});

// ---------- link externo (por dashboard, 28ª rodada) ----------
// Mesmo padrão do link externo dos Influencers: um token por dashboard,
// qualquer pessoa com o link acessa sem login e sem conta na Plataforma —
// pensado pra gente de fora (fora da equipe) acompanhar Mídias/Tráfego.
// Quem abre o link entra como "Visitante" (role 'none': só leitura — cada
// dashboard de destino barra escrita pra esse role, ver blockViewerWrites).
//
// As rotas /public/:token e /public/:token/launch ficam ANTES das rotas
// autenticadas abaixo, sem requireAuth, seguindo o mesmo padrão de
// routes/influencers.js.
router.get('/public/:token', (req, res) => {
  const link = db.get('dashboardPublicLinks').find({ token: req.params.token }).value();
  if (!link) return res.status(404).json({ error: 'Link inválido ou desativado.' });
  const dashboard = DASHBOARDS.find((d) => d.key === link.key);
  if (!dashboard) return res.status(404).json({ error: 'Dashboard não encontrado.' });
  res.json({ key: dashboard.key, label: dashboard.label, url: dashboard.url });
});

router.get('/public/:token/launch', (req, res) => {
  const link = db.get('dashboardPublicLinks').find({ token: req.params.token }).value();
  if (!link) return res.status(404).json({ error: 'Link inválido ou desativado.' });
  const dashboard = DASHBOARDS.find((d) => d.key === link.key);
  if (!dashboard) return res.status(404).json({ error: 'Dashboard não encontrado.' });
  if (!dashboard.url) return res.status(500).json({ error: `URL do dashboard "${dashboard.label}" ainda não foi configurada na plataforma.` });

  const handoffUser = { id: 'visitante-' + dashboard.key, username: 'Visitante', role: 'none' };
  const handoffToken = jwt.sign(handoffUser, JWT_SECRET, { expiresIn: '30d' });
  const publicUrl = `${dashboard.url}/?platformToken=${encodeURIComponent(handoffToken)}&platformUser=${encodeURIComponent(JSON.stringify(handoffUser))}`;
  res.json({ url: publicUrl });
});

router.get('/:key/public-link', requireAuth, (req, res) => {
  const dashboard = DASHBOARDS.find((d) => d.key === req.params.key);
  if (!dashboard) return res.status(404).json({ error: 'Dashboard não encontrado.' });
  const link = db.get('dashboardPublicLinks').find({ key: dashboard.key }).value();
  res.json({ publicToken: link ? link.token : null });
});

router.post('/:key/public-link/generate', requireAuth, (req, res) => {
  const dashboard = DASHBOARDS.find((d) => d.key === req.params.key);
  if (!dashboard) return res.status(404).json({ error: 'Dashboard não encontrado.' });
  const token = crypto.randomBytes(20).toString('hex');
  const existing = db.get('dashboardPublicLinks').find({ key: dashboard.key }).value();
  if (existing) {
    db.get('dashboardPublicLinks').find({ key: dashboard.key }).assign({ token, createdAt: new Date().toISOString(), createdBy: req.user.id }).write();
  } else {
    db.get('dashboardPublicLinks').push({ key: dashboard.key, token, createdAt: new Date().toISOString(), createdBy: req.user.id }).write();
  }
  logAudit({ user: req.user, entityType: 'dashboardPublicLink', entityId: dashboard.key, entityLabel: dashboard.label, action: 'generate_public_link' });
  res.json({ publicToken: token });
});

router.delete('/:key/public-link', requireAuth, (req, res) => {
  const dashboard = DASHBOARDS.find((d) => d.key === req.params.key);
  if (!dashboard) return res.status(404).json({ error: 'Dashboard não encontrado.' });
  db.get('dashboardPublicLinks').remove({ key: dashboard.key }).write();
  logAudit({ user: req.user, entityType: 'dashboardPublicLink', entityId: dashboard.key, entityLabel: dashboard.label, action: 'revoke_public_link' });
  res.json({ ok: true });
});

module.exports = router;
