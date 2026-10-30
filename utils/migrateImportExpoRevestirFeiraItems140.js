const db = require('../db');
const { nanoid } = require('./id');
const { logAudit } = require('./audit');

// 140ª rodada, pedido explícito da Raquel: ela mostrou a planilha de
// Realizado do Budget com vários gastos "ExpoRevestir 2027 - ..." (De
// Bacco, fluxo Feiras/Eventos - 2.5.3.1) já lançados, enquanto a feira
// "ExpoRevestir 2027" (submenu Feiras) seguia com 0 itens -- "esses
// gastos aqui no realizado, precisam estar dentro de feiras... Ai eu n
// preciso por de forma manual".
//
// Causa raiz (investigação desta rodada): existe sincronização automática
// só num sentido, Feiras -> Budget (ver routes/feiras.js,
// syncItemToBudget, 41ª rodada) -- lançar um item na tela de Feiras já
// cria o lançamento correspondente no Budget sozinho. O caminho contrário
// nunca existiu. Esses lançamentos de 2027 foram digitados direto no
// Budget (não pela tela de Feiras), por isso nunca viraram item lá.
//
// Escopo confirmado com a Raquel: resolver só este caso específico, uma
// vez só -- dali pra frente ela vai lançar sempre pela tela de Feiras
// (que já joga pro Budget sozinho, sem precisar de nenhuma mudança de
// código nova). Por isso esta migração roda uma única vez (trava
// `oneTimeMigrationsCompleted`, mesmo padrão já usado em
// migrateAutoCompleteDemandasFromPosts.js/migrateReconcileSiblingDemandas99.js)
// e é bem restrita de propósito: só mexe na feira "ExpoRevestir" de 2027
// da De Bacco, e só lê os lançamentos do Budget que baterem exatamente
// com a marca/fluxo/ano dela e título começando com "ExpoRevestir 2027".
//
// Importante sobre segurança do dado: os itens criados aqui nascem com
// `origem: 'import'` e `budgetEntryIds: []` -- EXATAMENTE o mesmo padrão
// já usado pros itens históricos importados de 2025/2026 (ver comentário
// no topo de routes/feiras.js e utils/seedFeirasExporevestirDebacco2025_2026.js):
// isso impede que editar o item depois (corrigir um nome, por exemplo)
// dispare `syncItemToBudget()` e recrie/apague os lançamentos reais do
// Budget -- os lançamentos de origem NUNCA são tocados, apagados ou
// recriados por esta migração; só são LIDOS, pra copiar os valores (nunca
// movidos). O "Realizado" de cada lançamento é o valor copiado pro item
// (se não tiver Realizado preenchido, usa o Planejado) -- é exatamente o
// valor que a Raquel apontou na mensagem.
const MIGRATION_NAME = 'importExpoRevestirFeiraItems140';

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

// Cobre tanto "ExpoRevestir" quanto "ExpoRevetir" (um dos lançamentos
// reais da Raquel tem esse erro de digitação, sem o "s" -- confirmado no
// print que ela mandou: "ExpoRevetir 2027- Taxas Obrigatórias
// (facilities)") -- o "s" depois do 2º "e" fica opcional nas duas regras
// abaixo, pra não deixar nenhum lançamento de fora só por causa do typo.
const EXPOREVESTIR_PREFIX_RE = /^Expo\s*Reve[s]?tir\s*2027\s*-\s*(.+)$/i;
const EXPOREVESTIR_MATCH_RE = /^expo\s*reve[s]?tir\s*2027/i;

function stripExpoRevestirPrefix(tituloCompra) {
  const t = String(tituloCompra || '').trim();
  // Cobre tanto "ExpoRevestir 2027 - X" quanto "ExpoRevestir 2027- X"
  // (as duas formas aparecem nos lançamentos reais) -- se não bater com
  // nenhum, mantém o título original (nunca falha/perde informação).
  const m = t.match(EXPOREVESTIR_PREFIX_RE);
  return m ? m[1].trim() : t;
}

function migrateImportExpoRevestirFeiraItems140() {
  if (hasOneTimeMigrationRun(MIGRATION_NAME)) return;

  const feira = db.get('feiras').value().find((f) =>
    f.brand === 'debacco' &&
    Number(f.ano) === 2027 &&
    /exporevestir/i.test(f.nome || '')
  );

  if (!feira) {
    console.log('[migrateImportExpoRevestirFeiraItems140] Feira "ExpoRevestir 2027" (De Bacco) não encontrada -- nada a fazer (migração marcada como concluída mesmo assim, pra não tentar de novo a cada boot).');
    markOneTimeMigrationRun(MIGRATION_NAME);
    return;
  }

  // budgetEntryIds já referenciados por QUALQUER item de QUALQUER feira --
  // segurança extra pra nunca duplicar um lançamento que, por algum
  // motivo, já estivesse vinculado a um item existente.
  const jaVinculados = new Set();
  db.get('feiras').value().forEach((f) => {
    (f.itens || []).forEach((it) => {
      (it.budgetEntryIds || []).forEach((id) => jaVinculados.add(id));
    });
  });

  const soltos = db.get('budgetEntries').value().filter((e) =>
    e.brand === feira.brand &&
    e.category === feira.fluxo &&
    Number(e.year) === Number(feira.ano) &&
    EXPOREVESTIR_MATCH_RE.test((e.tituloCompra || '').trim()) &&
    !jaVinculados.has(e.id)
  );

  if (soltos.length === 0) {
    console.log('[migrateImportExpoRevestirFeiraItems140] Nenhum lançamento solto de ExpoRevestir 2027 encontrado no Budget -- nada a fazer.');
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
      observacoes: 'Importado automaticamente do Budget (140ª rodada) -- valor já lançado lá anteriormente, nunca recriado/alterado por este item.',
      valores,
      total,
      budgetEntryIds: []
    });
  });

  const itensAtualizados = [...(feira.itens || []), ...novosItens];
  db.get('feiras').find({ id: feira.id }).assign({
    itens: itensAtualizados,
    updatedAt: new Date().toISOString(),
    updatedBy: 'Sistema (manutenção 140ª rodada)',
    updatedById: null
  }).write();

  // Alguns nomes de feira já incluem o ano (como "ExpoRevestir 2027", este
  // caso) e outros não (como "FEICON", com o ano só no campo separado) --
  // só concatena o ano no rótulo do log/auditoria quando ele ainda não
  // aparece no nome, pra nunca duplicar ("ExpoRevestir 2027 2027").
  const feiraLabel = String(feira.nome || '').includes(String(feira.ano))
    ? feira.nome
    : `${feira.nome} ${feira.ano}`;

  logAudit({
    user: { id: 'system', name: 'Sistema (manutenção 140ª rodada)' },
    entityType: 'feira',
    entityId: feira.id,
    entityLabel: feiraLabel,
    action: 'update',
    details: `${novosItens.length} item(ns) importado(s) automaticamente a partir de ${soltos.length} lançamento(s) de Budget já existente(s), sem alterar nenhum deles: ${novosItens.map((i) => i.nome).join(', ')}.`
  });

  console.log(`[migrateImportExpoRevestirFeiraItems140] ${novosItens.length} item(ns) importado(s) pra "${feiraLabel}", a partir de ${soltos.length} lançamento(s) de Budget.`);
  markOneTimeMigrationRun(MIGRATION_NAME);
}

module.exports = { migrateImportExpoRevestirFeiraItems140 };
