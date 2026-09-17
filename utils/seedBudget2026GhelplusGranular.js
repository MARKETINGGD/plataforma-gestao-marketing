const db = require('../db');
const { nanoid } = require('./id');
const { ENTRIES_2026_GHELPLUS_GRANULAR } = require('./budget2026GhelplusGranularData');

// 25ª rodada — a Raquel pediu pra ver, dentro de cada fluxo, quais compras
// individuais geraram aquele valor (fornecedor, título da compra e
// quantidade), não só o total planejado/realizado por mês. Esse seed troca
// os 144 lançamentos AGREGADOS de GhelPlus/2026 importados na 23ª rodada
// (1 lançamento por categoria/mês, sem detalhe de compra) pelos 452
// lançamentos GRANULARES (1 por compra/mês, vindos linha a linha da
// planilha oficial). Roda automaticamente ao iniciar o servidor.
//
// Segurança (nunca apagar lançamento que a Raquel tenha registrado à mão):
// só REMOVE os lançamentos que a própria Plataforma criou automaticamente
// na 23ª rodada — reconhecidos por updatedById === null e pela nota
// "Importado da planilha oficial de orçamento 2026 (GhelPlus)." exatamente
// como o seed antigo gravava. Se a Raquel já editou um desses lançamentos
// pela tela (o que troca o updatedById pro usuário dela) ou criou um novo
// à mão, esse lançamento NUNCA é tocado por essa migração.
const LEGACY_AUTO_NOTES = 'Importado da planilha oficial de orçamento 2026 (GhelPlus).';
const GRANULAR_BATCH = 'granular-2026-ghelplus-v1';

function seedBudget2026GhelplusGranular() {
  const already = db.get('budgetEntries').filter({ brand: 'ghelplus', year: 2026, importBatch: GRANULAR_BATCH }).value();
  if (already.length > 0) {
    console.log(`[seedBudget2026GhelplusGranular] Pulado: já existem ${already.length} lançamento(s) granular(es) de GhelPlus/2026 no banco.`);
    return;
  }

  const legacyAuto = db.get('budgetEntries')
    .filter((e) => e.brand === 'ghelplus' && e.year === 2026 && e.updatedById === null && e.notes === LEGACY_AUTO_NOTES)
    .value();
  if (legacyAuto.length > 0) {
    legacyAuto.forEach((e) => db.get('budgetEntries').remove({ id: e.id }).write());
    console.log(`[seedBudget2026GhelplusGranular] Removidos ${legacyAuto.length} lançamento(s) agregado(s) da 23ª rodada (GhelPlus/2026) — substituídos pelos granulares.`);
  }

  const now = new Date().toISOString();
  const rows = ENTRIES_2026_GHELPLUS_GRANULAR.map((e) => ({
    id: nanoid(),
    brand: 'ghelplus',
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
  console.log(`[seedBudget2026GhelplusGranular] Importados ${rows.length} lançamentos granulares (linha a linha, com fornecedor/título/quantidade) de Orçamento GhelPlus/2026.`);
}

module.exports = { seedBudget2026GhelplusGranular };
