const db = require('../db');
const { nanoid } = require('./id');
const { ENTRIES_2026_DEBACCO } = require('./budget2026DebaccoData');

function seedBudget2026Debacco() {
  const existing = db.get('budgetEntries').filter({ brand: 'debacco', year: 2026 }).value();
  if (existing.length > 0) {
    console.log(`[seedBudget2026Debacco] Pulado: já existem ${existing.length} lançamento(s) de De Bacco/2026 no banco.`);
    return;
  }
  const now = new Date().toISOString();
  const rows = ENTRIES_2026_DEBACCO.map((e) => ({
    id: nanoid(),
    brand: 'debacco',
    category: e.category,
    year: 2026,
    month: e.month,
    planejado: e.planejado,
    realizado: e.realizado,
    notes: 'Importado da planilha oficial de orçamento 2026 (De Bacco).',
    createdAt: now,
    updatedAt: now,
    updatedBy: 'Importação automática',
    updatedById: null
  }));
  rows.forEach((row) => db.get('budgetEntries').push(row).write());
  console.log(`[seedBudget2026Debacco] Importados ${rows.length} lançamentos de Orçamento De Bacco/2026.`);
}

module.exports = { seedBudget2026Debacco };
