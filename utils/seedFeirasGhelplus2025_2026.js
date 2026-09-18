const db = require('../db');
const { nanoid } = require('./id');
const { ITENS_FEICON_2026, ITENS_FEICON_2025 } = require('./feirasFeiconGhelplusData');

// 41ª rodada — importação única (roda automaticamente ao iniciar o
// servidor, mas só faz alguma coisa da primeira vez) dos dados da feira
// FEICON (GhelPlus) de 2025 e 2026, vindos da planilha oficial
// "2026- BUDGET GHELPLUS.xlsx", aba "FEICON 2026" — pedido da Raquel:
// "no dash de feiras... já coloque todas as informações das planilhas".
//
// Importante: como a Raquel confirmou que os valores de 2025 e 2026 já
// estão lançados no Budget (vieram da importação granular da 25ª rodada —
// ver utils/seedBudget2026GhelplusGranular.js, categoria "Feiras e Eventos
// - 2.5.2.22"), os itens importados aqui NÃO geram lançamento novo em
// budgetEntries (ficam com `origem: 'import'` e `budgetEntryIds: []`) —
// só os itens cadastrados/editados pela tela de Feiras dali pra frente é
// que passam a sincronizar automaticamente (ver routes/feiras.js).
const IMPORT_BATCH = 'feicon-ghelplus-2025-2026-v1';
const FLUXO_FEIRAS_GHELPLUS = 'Feiras e Eventos - 2.5.2.22';

function buildFeira(nome, ano, itensData, req) {
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
    brand: 'ghelplus',
    nome,
    ano,
    fluxo: FLUXO_FEIRAS_GHELPLUS,
    itens,
    importBatch: IMPORT_BATCH,
    createdAt: now,
    updatedAt: now,
    updatedBy: 'Importação automática',
    updatedById: null
  };
}

function seedFeirasGhelplus2025_2026() {
  const already = db.get('feiras').filter({ importBatch: IMPORT_BATCH }).value();
  if (already.length > 0) {
    console.log(`[seedFeirasGhelplus2025_2026] Pulado: já existem ${already.length} feira(s) importada(s) desse lote.`);
    return;
  }
  const feira2026 = buildFeira('FEICON', 2026, ITENS_FEICON_2026);
  const feira2025 = buildFeira('FEICON', 2025, ITENS_FEICON_2025);
  db.get('feiras').push(feira2026).write();
  db.get('feiras').push(feira2025).write();
  console.log(`[seedFeirasGhelplus2025_2026] Importados: FEICON 2026 (${feira2026.itens.length} itens) e FEICON 2025 (${feira2025.itens.length} itens).`);
}

module.exports = { seedFeirasGhelplus2025_2026 };
