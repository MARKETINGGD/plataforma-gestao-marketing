const db = require('../db');
const { nanoid } = require('./id');
const { logAudit } = require('./audit');

// 141ª rodada — correção da 140ª rodada (que rodou em produção, 30/10/2026,
// mas não encontrou nenhum lançamento pra importar e por isso deixou a
// feira "ExpoRevestir 2027" zerada mesmo assim).
//
// Causa raiz do bug da 140ª: a migração filtrava os lançamentos do Budget
// exigindo `Number(e.year) === Number(feira.ano)` (ou seja, ano === 2027).
// Só que os lançamentos "ExpoRevestir 2027 - ..." foram importados pela 25ª
// rodada (ver utils/seedBudget2026DebaccoGranular.js linha ~42) com
// `year: 2026` fixo pra TODOS os lançamentos do arquivo, porque esse campo
// `year` representa o ano ORÇAMENTÁRIO (a aba "2026" da planilha oficial),
// não o ano do evento citado no título. O evento é em 2027, mas a verba
// foi lançada/planejada dentro do orçamento de 2026 -- por isso o título
// diz "2027" mas o campo `year` do lançamento é 2026. A 140ª rodada não
// sabia disso e exigiu os dois batendo, então nunca achou nada, imprimiu
// "nada a fazer" e já marcou a migração como concluída (travando pra
// sempre, mesmo sem ter importado nada).
//
// Correção: usa um NOME de migração novo (não mexe na trava da 140ª, que
// fica como registro histórico) e não exige mais `year === feira.ano` --
// só marca/fluxo/título (prefixo "ExpoRevestir 2027"/"ExpoRevetir 2027",
// com o mesmo suporte a typo da 140ª) já são específicos o bastante pra
// nunca pegar lançamento errado, independente do ano orçamentário em que
// foi lançado.
//
// Resto do design é idêntico à 140ª rodada (mesmas garantias de segurança):
// só mexe na feira "ExpoRevestir" de 2027 da De Bacco; os itens criados
// nascem com `origem: 'import'` e `budgetEntryIds: []` (nunca disparam
// `syncItemToBudget()`, nunca tocam/apagam/recriam o lançamento de
// origem -- só LEEM o valor, pra copiar, nunca movem); roda uma única vez
// (trava própria `oneTimeMigrationsCompleted`), mas com uma melhoria: se a
// feira "ExpoRevestir 2027" ainda não existir num boot, a migração NÃO se
// marca como concluída -- só tenta de novo no próximo boot, até a feira
// existir e os itens poderem ser importados (evita repetir o mesmo tipo de
// bug: antes, "não achei nada agora" e "não vou mais tentar" eram a mesma
// trava; agora só trava de verdade depois de realmente conseguir rodar).
const MIGRATION_NAME = 'importExpoRevestirFeiraItems141';

function ensureOneTimeMigrationsCollection() {
  db.defaults({ oneTimeMigrationsCompleted: [] }).write();
}
function hasOneTimeMigrationRun(name) {
  ensureOneTimeMigrationsCollection();
  return !!db.get('oneTimeMigrationsCompleted').find({ name }).value();
}
function markOneTimeMigrationRun(name) {
  ensureOneTimeMigrationsCollection();
  db.get('oneTimeMigrationsCompleted').push({ name, completedAt: new Date().toISOString() }).write();
}

// Mesmo suporte a typo da 140ª rodada: cobre tanto "ExpoRevestir" quanto
// "ExpoRevetir" (sem o "s"), que aparece em um lançamento real da Raquel.
const EXPOREVESTIR_PREFIX_RE = /^Expo\s*Reve[s]?tir\s*2027\s*-\s*(.+)$/i;
const EXPOREVESTIR_MATCH_RE = /^expo\s*reve[s]?tir\s*2027/i;

function stripExpoRevestirPrefix(tituloCompra) {
  const t = String(tituloCompra || '').trim();
  const m = t.match(EXPOREVESTIR_PREFIX_RE);
  return m ? m[1].trim() : t;
}

function migrateImportExpoRevestirFeiraItems141() {
  if (hasOneTimeMigrationRun(MIGRATION_NAME)) return;

  const feira = db.get('feiras').value().find((f) =>
    f.brand === 'debacco' &&
    Number(f.ano) === 2027 &&
    /exporevestir/i.test(f.nome || '')
  );

  if (!feira) {
    // Não marca como concluída -- tenta de novo no próximo boot (ver nota
    // acima sobre a correção em relação à 140ª rodada).
    console.log('[migrateImportExpoRevestirFeiraItems141] Feira "ExpoRevestir 2027" (De Bacco) não encontrada ainda -- vai tentar de novo no próximo boot.');
    return;
  }

  // budgetEntryIds já referenciados por QUALQUER item de QUALQUER feira --
  // segurança extra pra nunca duplicar um lançamento que, por algum
  // motivo, já estivesse vinculado a um item existente (inclui os itens
  // que a própria 140ª rodada possa ter criado em algum ambiente, embora
  // em produção ela não tenha criado nenhum).
  const jaVinculados = new Set();
  db.get('feiras').value().forEach((f) => {
    (f.itens || []).forEach((it) => {
      (it.budgetEntryIds || []).forEach((id) => jaVinculados.add(id));
    });
  });

  // SEM o filtro de `year === feira.ano` que causou o bug da 140ª -- marca,
  // fluxo e o prefixo do título ("ExpoRevestir 2027"/"ExpoRevetir 2027")
  // já são específicos o bastante.
  const soltos = db.get('budgetEntries').value().filter((e) =>
    e.brand === feira.brand &&
    e.category === feira.fluxo &&
    EXPOREVESTIR_MATCH_RE.test((e.tituloCompra || '').trim()) &&
    !jaVinculados.has(e.id)
  );

  if (soltos.length === 0) {
    console.log('[migrateImportExpoRevestirFeiraItems141] Nenhum lançamento solto de ExpoRevestir 2027 encontrado no Budget -- nada a fazer.');
    markOneTimeMigrationRun(MIGRATION_NAME);
    return;
  }

  // Agrupa por título+fornecedor (um lançamento por mês vira 1 item só,
  // com os 12 meses preenchidos conforme o que existir).
  const grupos = {};
  soltos.forEach((e) => {
    const key = (e.tituloCompra || '') + '|' + (e.fornecedor || '');
    if (!grupos[key]) grupos[key] = [];
    grupos[key].push(e);
  });

  const novosItens = [];
  Object.keys(grupos).forEach((key) => {
    const entries = grupos[key];
    const first = entries[0];
    const valores = new Array(12).fill(null);
    entries.forEach((e) => {
      const idx = Number(e.month) - 1;
      if (idx < 0 || idx > 11) return;
      const valor = (e.realizado !== null && e.realizado !== undefined) ? e.realizado : e.planejado;
      if (valor !== null && valor !== undefined) valores[idx] = valor;
    });
    const total = valores.reduce((s, v) => s + (v || 0), 0);
    novosItens.push({
      id: nanoid(),
      origem: 'import',
      nome: stripExpoRevestirPrefix(first.tituloCompra),
      quantidade: first.quantidade === undefined ? null : first.quantidade,
      fornecedor: first.fornecedor || '',
      observacoes: 'Importado automaticamente do Budget (141ª rodada, correção da 140ª) -- valor já lançado lá anteriormente, nunca recriado/alterado por este item.',
      valores,
      total,
      budgetEntryIds: []
    });
  });

  const itensAtualizados = [...(feira.itens || []), ...novosItens];
  db.get('feiras').find({ id: feira.id }).assign({
    itens: itensAtualizados,
    updatedAt: new Date().toISOString(),
    updatedBy: 'Sistema (manutenção 141ª rodada)',
    updatedById: null
  }).write();

  // Mesmo ajuste cosmético da 140ª: só concatena o ano no rótulo do
  // log/auditoria quando ele ainda não aparece no nome da feira, pra nunca
  // duplicar ("ExpoRevestir 2027 2027").
  const feiraLabel = String(feira.nome || '').includes(String(feira.ano))
    ? feira.nome
    : `${feira.nome} ${feira.ano}`;

  logAudit({
    user: { id: 'system', name: 'Sistema (manutenção 141ª rodada)' },
    entityType: 'feira',
    entityId: feira.id,
    entityLabel: feiraLabel,
    action: 'update',
    details: `${novosItens.length} item(ns) importado(s) automaticamente a partir de ${soltos.length} lançamento(s) de Budget já existente(s), sem alterar nenhum deles (correção da 140ª rodada): ${novosItens.map((i) => i.nome).join(', ')}.`
  });

  console.log(`[migrateImportExpoRevestirFeiraItems141] ${novosItens.length} item(ns) importado(s) pra "${feiraLabel}", a partir de ${soltos.length} lançamento(s) de Budget.`);
  markOneTimeMigrationRun(MIGRATION_NAME);
}

module.exports = { migrateImportExpoRevestirFeiraItems141 };
