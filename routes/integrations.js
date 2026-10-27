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
  const { kind, brand, sourceId, titulo, valor, data, category: categoryOverride } = req.body || {};
  if (!['action', 'showroom'].includes(kind)) return res.status(400).json({ error: 'kind inválido (esperado "action" ou "showroom").' });
  if (!['ghelplus', 'debacco'].includes(brand)) return res.status(400).json({ error: 'brand inválido.' });
  if (!sourceId) return res.status(400).json({ error: 'sourceId é obrigatório.' });

  // 113ª/114ª rodada, pedido da Raquel: "para que o que é lançado dentro do
  // relatorio de ações entre no budget, teria que ter no cadastro das
  // ações, que informar de forma obrigatória, o fluxo". O dashboard de
  // Ações Sazonais agora manda o fluxo escolhido por quem cadastrou a ação
  // (campo `category`) pra qualquer ação que não seja "Nova Feira" -- só
  // aceito quando bate com um fluxo de verdade da marca (nunca um texto
  // livre inventado por quem chama). "Pode manter a regra da feira e
  // expositores" (pedido explícito da Raquel): Showroom NUNCA aceita
  // override -- sempre usa o fluxo automático de Showroom, não importa o
  // que vier no corpo da requisição. "Nova Feira" (kind 'action' sem
  // `category`, já que o formulário de lá não pede fluxo pra esse tipo)
  // também continua 100% automática, cai no fluxoFeiras de sempre.
  const validCategoriesForBrand = FLUXOS_BY_BRAND[brand] || [];
  const usedOverride = kind === 'action' && categoryOverride && validCategoriesForBrand.includes(categoryOverride);
  const category = kind === 'showroom'
    ? fluxoShowroom(brand)
    : (usedOverride ? categoryOverride : fluxoFeiras(brand));
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
    // 114ª rodada: antes desta rodada, `kind === 'action'` só podia significar
    // uma ação "Nova Feira" (a única automática), então a nota dizia isso sempre.
    // Agora uma ação comum (ex.: Mostra) com fluxo escolhido no cadastro também
    // chega aqui como `kind: 'action'` -- a nota precisa distinguir os dois casos,
    // senão o lançamento de uma ação comum aparece no Budget dizendo "Nova Feira".
    notes: kind === 'showroom'
      ? 'Lançado automaticamente a partir de um Expositor Especial no dashboard de Ações Sazonais.'
      : (usedOverride
          ? `Lançado automaticamente a partir de uma ação cadastrada no dashboard de Ações Sazonais (fluxo informado no cadastro: "${category}").`
          : 'Lançado automaticamente a partir de uma Ação "Nova Feira" no dashboard de Ações Sazonais.'),
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
