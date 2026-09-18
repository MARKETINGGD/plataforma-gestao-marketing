const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireInternalToken } = require('../middleware/internalAuth');
const budgetRouter = require('./budget');

const router = express.Router();

// Sincronização de entrada (Ações Sazonais -> Plataforma), 41ª rodada,
// pedido da Raquel: "no dash de ações (feiras e tbm os de expositores
// especiais), tudo que for lançado a partir de hoje, deve ser
// automaticamente incluído no budget de acordo com a marca. Dentro do
// fluxo correto". Autenticado por token interno (não é login de usuário —
// ver middleware/internalAuth.js), chamado pelo dashboard de Ações
// Sazonais (routes/actions.js e routes/showrooms.js de lá) sempre que uma
// Ação do tipo "Nova Feira" ou um Expositor Especial (showroom) é
// criado/editado por lá.
const { FLUXOS_BY_BRAND } = budgetRouter;

function fluxoFeiras(brand) {
  const lista = FLUXOS_BY_BRAND[brand] || [];
  return lista.find((f) => f.toLowerCase().startsWith('feiras')) || lista[0] || '';
}
function fluxoShowroom(brand) {
  const lista = FLUXOS_BY_BRAND[brand] || [];
  return lista.find((f) => f.toLowerCase().startsWith('showroom')) || lista[0] || '';
}

router.post('/acoes-sazonais/sync', requireInternalToken, (req, res) => {
  const { kind, brand, sourceId, titulo, valor, data } = req.body || {};
  if (!['action', 'showroom'].includes(kind)) return res.status(400).json({ error: 'kind inválido (esperado "action" ou "showroom").' });
  if (!['ghelplus', 'debacco'].includes(brand)) return res.status(400).json({ error: 'brand inválido.' });
  if (!sourceId) return res.status(400).json({ error: 'sourceId é obrigatório.' });

  const category = kind === 'showroom' ? fluxoShowroom(brand) : fluxoFeiras(brand);
  let year, month;
  if (data) {
    const d = new Date(data);
    if (!isNaN(d.getTime())) { year = d.getFullYear(); month = d.getMonth() + 1; }
  }
  if (!year) {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }

  const nowIso = new Date().toISOString();
  const existing = db.get('budgetEntries').find({ sourceSystem: 'acoesSazonais', sourceId }).value();
  if (existing) {
    db.get('budgetEntries').find({ id: existing.id }).assign({
      brand, category, year, month,
      realizado: valor === undefined || valor === null ? existing.realizado : Number(valor),
      tituloCompra: titulo !== undefined ? titulo : existing.tituloCompra,
      updatedAt: nowIso
    }).write();
    return res.json({ ok: true, updated: true, entry: db.get('budgetEntries').find({ id: existing.id }).value() });
  }
  const entry = {
    id: nanoid(),
    brand,
    category,
    year,
    month,
    planejado: null,
    realizado: valor === undefined || valor === null ? null : Number(valor),
    notes: kind === 'showroom'
      ? 'Lançado automaticamente a partir de um Expositor Especial no dashboard de Ações Sazonais.'
      : 'Lançado automaticamente a partir de uma Ação "Nova Feira" no dashboard de Ações Sazonais.',
    fornecedor: '',
    tituloCompra: titulo || '',
    quantidade: null,
    sourceSystem: 'acoesSazonais',
    sourceId,
    createdAt: nowIso,
    updatedAt: nowIso,
    updatedBy: 'Sincronização automática (Ações Sazonais)',
    updatedById: null
  };
  db.get('budgetEntries').push(entry).write();
  res.json({ ok: true, created: true, entry });
});

module.exports = router;
