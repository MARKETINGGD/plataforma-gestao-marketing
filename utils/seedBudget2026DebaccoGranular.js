const db = require('../db');
const { nanoid } = require('./id');
const { ENTRIES_2026_DEBACCO_GRANULAR } = require('./budget2026DebaccoGranularData');

// 25ª rodada — mesma ideia do seed granular da GhelPlus (ver
// seedBudget2026GhelplusGranular.js): troca os 132 lançamentos AGREGADOS de
// De Bacco/2026 importados na 24ª rodada pelos 580 lançamentos GRANULARES
// (1 por compra/mês, com fornecedor/título da compra/quantidade quando a
// planilha informava). Inclui também o fluxo "Showroom - 2.5.3.13", que
// existe na planilha da De Bacco mas não tinha sido capturado na 24ª rodada
// (a importação por totais não reconheceu esse cabeçalho de fluxo).
//
// Segurança (nunca apagar lançamento que a Raquel tenha registrado à mão):
// só REMOVE os lançamentos que a própria Plataforma criou automaticamente
// na 24ª rodada — reconhecidos por updatedById === null e pela nota
// "Importado da planilha oficial de orçamento 2026 (De Bacco)." exatamente
// como o seed antigo gravava. Qualquer lançamento editado ou criado à mão
// pela Raquel (updatedById dela) nunca é tocado por essa migração.
const LEGACY_AUTO_NOTES = 'Importado da planilha oficial de orçamento 2026 (De Bacco).';
const GRANULAR_BATCH = 'granular-2026-debacco-v1';

function seedBudget2026DebaccoGranular() {
  const already = db.get('budgetEntries').filter({ brand: 'debacco', year: 2026, importBatch: GRANULAR_BATCH }).value();
  if (already.length > 0) {
    console.log(`[seedBudget2026DebaccoGranular] Pulado: já existem ${already.length} lançamento(s) granular(es) de De Bacco/2026 no banco.`);
    return;
  }

  const legacyAuto = db.get('budgetEntries')
    .filter((e) => e.brand === 'debacco' && e.year === 2026 && e.updatedById === null && e.notes === LEGACY_AUTO_NOTES)
    .value();
  if (legacyAuto.length > 0) {
    legacyAuto.forEach((e) => db.get('budgetEntries').remove({ id: e.id }).write());
    console.log(`[seedBudget2026DebaccoGranular] Removidos ${legacyAuto.length} lançamento(s) agregado(s) da 24ª rodada (De Bacco/2026) — substituídos pelos granulares.`);
  }

  const now = new Date().toISOString();
  const rows = ENTRIES_2026_DEBACCO_GRANULAR.map((e) => ({
    id: nanoid(),
    brand: 'debacco',
    category: e.category,
    year: 2026,
    month: e.month,
    planejado: e.planejado === undefined ? null : e.planejado,
    realizado: e.realizado === undefined ? null : e.realizado,
    fornecedor: e.fornecedor || '',
    tituloCompra: e.tituloCompra || '',
    quantidade: e.quantidade === undefined ? null : e.quantidade,
    notes: '',
    importBatch: GRANULAR_BATCH,
    createdAt: now,
    updatedAt: now,
    updatedBy: 'Importação automática',
    updatedById: null
  }));
  rows.forEach((row) => db.get('budgetEntries').push(row).write());
  console.log(`[seedBudget2026DebaccoGranular] Importados ${rows.length} lançamentos granulares (linha a linha, com fornecedor/título/quantidade) de Orçamento De Bacco/2026.`);
}

module.exports = { seedBudget2026DebaccoGranular };
