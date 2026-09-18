const db = require('../db');
const { nanoid } = require('./id');
const { ITENS_EXPOREVESTIR_2026, ITENS_EXPOREVESTIR_2025 } = require('./feirasExporevestirDebaccoData');

// 42ª rodada — importação única (roda automaticamente ao iniciar o
// servidor, mas só faz alguma coisa da primeira vez) dos dados da feira
// ExpoRevestir (De Bacco) de 2025 e 2026, vindos da planilha oficial
// "2026 - BUDGET DE BACCO.xlsx", aba "EXPO REVESTIR 2026" — pedido da
// Raquel na 41ª rodada, link certo enviado por ela só na 42ª.
//
// Importante: como a Raquel já confirmou (41ª rodada) que os valores de
// 2025 e 2026 já estão lançados no Budget (vieram da importação
// granular anterior — ver utils/seedBudget2026DebaccoGranular.js,
// categoria "Feiras/Eventos - 2.5.3.1"), os itens importados aqui NÃO
// geram lançamento novo em budgetEntries (ficam com `origem: 'import'`
// e `budgetEntryIds: []`) — só os itens cadastrados/editados pela tela
// de Feiras dali pra frente é que passam a sincronizar automaticamente
// (ver routes/feiras.js), mesmo padrão já usado pra FEICON/GhelPlus.
const IMPORT_BATCH = 'exporevestir-debacco-2025-2026-v1';
const FLUXO_FEIRAS_DEBACCO = 'Feiras/Eventos - 2.5.3.1';

function buildFeira(nome, ano, itensData) {
  const now = new Date().toISOString();
  const itens = itensData.map((it) => ({
    id: nanoid(),
    nome: it.nome,
    quantidade: it.quantidade === undefined ? null : it.quantidade,
    fornecedor: it.fornecedor || '',
    observacoes: it.observacoes || '',
    valores: it.valores,
    total: it.total === undefined ? null : it.total,
    origem: 'import',
    budgetEntryIds: []
  }));
  return {
    id: nanoid(),
    brand: 'debacco',
    nome,
    ano,
    fluxo: FLUXO_FEIRAS_DEBACCO,
    itens,
    importBatch: IMPORT_BATCH,
    createdAt: now,
    updatedAt: now,
    updatedBy: 'Importação automática',
    updatedById: null
  };
}

function seedFeirasExporevestirDebacco2025_2026() {
  const already = db.get('feiras').filter({ importBatch: IMPORT_BATCH }).value();
  if (already.length > 0) {
    console.log(`[seedFeirasExporevestirDebacco2025_2026] Pulado: já existem ${already.length} feira(s) importada(s) desse lote.`);
    return;
  }
  const feira2026 = buildFeira('ExpoRevestir', 2026, ITENS_EXPOREVESTIR_2026);
  const feira2025 = buildFeira('ExpoRevestir', 2025, ITENS_EXPOREVESTIR_2025);
  db.get('feiras').push(feira2026).write();
  db.get('feiras').push(feira2025).write();
  console.log(`[seedFeirasExporevestirDebacco2025_2026] Importados: ExpoRevestir 2026 (${feira2026.itens.length} itens) e ExpoRevestir 2025 (${feira2025.itens.length} itens).`);
}

module.exports = { seedFeirasExporevestirDebacco2025_2026 };
