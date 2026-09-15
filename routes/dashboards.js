const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

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
router.get('/launch/:key', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado. Faça login novamente.' });

  const dashboard = DASHBOARDS.find((d) => d.key === req.params.key);
  if (!dashboard) return res.status(404).json({ error: 'Dashboard não encontrado.' });

  const access = (user.permissions || {})[dashboard.key] || 'none';
  if (access === 'none') return res.status(403).json({ error: 'Você não tem acesso a este dashboard.' });
  if (!dashboard.url) return res.status(500).json({ error: `URL do dashboard "${dashboard.label}" ainda não foi configurada na plataforma.` });

  const handoffUser = { id: user.id, username: user.username, role: access };
  const handoffToken = jwt.sign(handoffUser, JWT_SECRET, { expiresIn: '30d' });

  const url = `${dashboard.url}/?platformToken=${encodeURIComponent(handoffToken)}&platformUser=${encodeURIComponent(JSON.stringify(handoffUser))}`;
  res.json({ url });
});

module.exports = router;
