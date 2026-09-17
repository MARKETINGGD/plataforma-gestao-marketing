const db = require('../db');
const { nanoid } = require('./id');
const { ENTRIES_2026_GHELPLUS } = require('./budget2026GhelplusData');

// Importa, uma única vez, os dados reais de 2026 (Planejado x Realizado) da
// marca GhelPlus, vindos da planilha oficial de orçamento (ver
// budget2026GhelplusData.js). Roda automaticamente ao iniciar o servidor.
//
// Segurança (nunca apagar dado já cadastrado, pedido da Raquel): só insere
// se AINDA NÃO existir nenhum lançamento de brand=ghelplus/year=2026 no
// banco — ou seja, só popula uma vez, na primeira vez que essa versão sobe.
// Se a Raquel já tiver lançado algo manualmente antes desse deploy, a
// importação automática é pulada por inteiro (evita sobrescrever ou
// duplicar o que já existe) e fica registrado no log do servidor.
function seedBudget2026Ghelplus() {
  const existing = db.get('budgetEntries').filter({ brand: 'ghelplus', year: 2026 }).value();
  if (existing.length > 0) {
    console.log(`[seedBudget2026Ghelplus] Pulado: já existem ${existing.length} lançamento(s) de GhelPlus/2026 no banco.`);
    return;
  }
  const now = new Date().toISOString();
  const rows = ENTRIES_2026_GHELPLUS.map((e) => ({
    id: nanoid(),
    brand: 'ghelplus',
    category: e.category,
    year: 2026,
    month: e.month,
    planejado: e.planejado,
    realizado: e.realizado,
    notes: 'Importado da planilha oficial de orçamento 2026 (GhelPlus).',
    createdAt: now,
    updatedAt: now,
    updatedBy: 'Importação automática',
    updatedById: null
  }));
  rows.forEach((row) => db.get('budgetEntries').push(row).write());
  console.log(`[seedBudget2026Ghelplus] Importados ${rows.length} lançamentos de Orçamento GhelPlus/2026.`);
}

module.exports = { seedBudget2026Ghelplus };
