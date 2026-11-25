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
  // 88ª rodada
  brindesSaidas: 'Registro de Saídas',
  campanhaCooperada: 'Campanha Cooperada',
  // 68ª rodada
  expositoresEstoque: 'Controle de Expositores',
  // 144ª rodada
  expositoresTotalMensal: 'Expositores — Total Mensal',
  concorrencia: 'Análise de Concorrência',
  concorrenciaItem: 'Análise de Concorrência',
  // 108ª rodada
  ausencias: 'Ausências',
  // 158ª rodada -- faltava essa entrada (bug reportado pela Raquel: "o
  // link externo não funciona"), o resolver nunca soube o rótulo nem
  // (ver SHARE_RESOURCE_API_PATH em app.js) pra onde buscar os dados
  // reais desse recurso.
  lancamentos: 'Lançamentos de Produtos'
};

router.get('/resolve/:token', (req, res) => {
  const link = shareLinks.findByToken(req.params.token);
  if (!link) return res.status(404).json({ error: 'Link inválido ou desativado.' });
  res.json({ resource: link.resource, resourceLabel: RESOURCE_LABEL_PT[link.resource] || link.resource, scopeKey: link.scopeKey, mode: link.mode });
});

module.exports = router;
