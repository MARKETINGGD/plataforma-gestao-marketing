// Resolvedor genérico de link externo (66ª rodada, "Rodada H" da
// Pendência 51) -- o front-end recebe só um token na URL
// (?sharePublic=TOKEN) e precisa descobrir de qual RECURSO esse token é
// (Budget, Feiras, Brindes, Campanha Cooperada...) antes de saber em qual
// endpoint específico buscar os dados de verdade (cada recurso serializa
// os próprios campos do seu jeito -- ver GET /public/:token em cada
// routes/<recurso>.js). Sem login, mesmo espírito de qualquer outra rota
// pública já existente na Papoi.
const express = require('express');
const shareLinks = require('../utils/shareLinks');

const router = express.Router();

const RESOURCE_LABEL_PT = {
  budget: 'Budget',
  feiras: 'Feiras',
  brindes: 'Brindes',
  campanhaCooperada: 'Campanha Cooperada',
  // 68ª rodada
  expositoresEstoque: 'Controle de Expositores',
  concorrencia: 'Análise de Concorrência',
  concorrenciaItem: 'Análise de Concorrência'
};

router.get('/resolve/:token', (req, res) => {
  const link = shareLinks.findByToken(req.params.token);
  if (!link) return res.status(404).json({ error: 'Link inválido ou desativado.' });
  res.json({ resource: link.resource, resourceLabel: RESOURCE_LABEL_PT[link.resource] || link.resource, scopeKey: link.scopeKey, mode: link.mode });
});

module.exports = router;
