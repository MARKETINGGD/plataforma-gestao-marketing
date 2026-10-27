const db = require('../db');
const { logAudit } = require('./audit');

// 112ª rodada, correção de bugs reais (auditoria pedida pela Raquel): esta
// migração roda em TODO boot do servidor (ver server.js, fora do escopo
// desta correção) sem nenhuma trava de "já rodei" -- diferente de outras
// migrações desta base (ex.: migrateLastCompletedAt.js/
// migrateDemandaBrand.js), que são naturalmente idempotentes (só mexem em
// quem ainda não tem um campo), ESTA migração reconcilia demandas-irmãs
// IGUALANDO campos de valor único (incluindo `archived`) pelo valor mais
// recente do grupo -- o que desfaz, a cada reinício, uma divergência que
// passou a ser INTENCIONAL depois da 1ª reconciliação (ex.: alguém
// arquivar manualmente só a própria demanda-irmã). Acrescenta uma trava
// de "rodou uma vez só" (nenhuma migração desta base tinha esse padrão
// até aqui -- as outras são naturalmente idempotentes por checarem o
// próprio dado, o que não serve aqui, ver comentário acima) -- sem
// precisar mexer em db.js (fora do escopo desta correção): inicializa a
// coleção `oneTimeMigrationsCompleted` na própria migração, se ainda não
// existir.
const MIGRATION_NAME = 'reconcileSiblingDemandas99';
function ensureOneTimeMigrationsCollection() {
  // lowdb aceita chamar defaults() de novo a qualquer momento -- só
  // preenche a chave que ainda não existir, nunca sobrescreve um array já
  // gravado por uma migração anterior.
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

// 99ª rodada, pedido explícito da Raquel: "certifique-se de que todos os
// cards irmãos atualizados nas ultimas 2 semanas, estejam ok" -- antes
// desta rodada, demandas-irmãs (mesmo sourceSocialPostId, uma por pessoa
// envolvida num agendamento) só sincronizavam a conclusão e, desde a 98ª
// rodada, alguns campos vindos do próprio agendamento -- qualquer edição
// feita DIRETO numa demanda (status, cor, responsável, checklist,
// comentários, arquivos...) nunca refletia nas outras. Esta migração
// corrige retroativamente qualquer grupo que já tenha ficado divergente
// por esse motivo, ANTES da sincronização total (ver syncLinkedDemandas/
// mirrorArrayField/mirrorCommentToSiblings em utils/demandCascade.js e as
// chamadas em routes/demandas.js) existir.
//
// Regra de reconciliação, pensada pra NUNCA perder nenhuma informação já
// cadastrada:
//  - campos de valor único (título, descrição, dueDate, status, cor,
//    link, checklistTitle, labelIds, rede, marca(s), responsável,
//    arquivado, lastCompletedAt/lastCompletedDueDate): usa o valor da
//    demanda-irmã com o `updatedAt` mais recente do grupo -- reflete a
//    edição mais nova de verdade, não escolhida à toa;
//  - checklist e arquivos: NUNCA escolhe um lado só -- faz a UNIÃO de
//    todos os itens/arquivos vistos em QUALQUER demanda do grupo (por
//    id), e, quando o mesmo item existe em mais de uma com `done`
//    diferente, mantém o concluído (nunca desfaz um trabalho já feito).
//
// Idempotente (só grava e loga em grupo que ainda estiver divergente --
// uma vez reconciliado, e com a sincronização total já valendo pra toda
// edição nova, o grupo não volta a divergir por conta própria) e roda
// sozinha a cada início do servidor, sem precisar de nenhum passo manual
// -- igual às outras migrações desta base (ver server.js).
const SCALAR_FIELDS = ['title', 'description', 'dueDate', 'status', 'color', 'link', 'checklistTitle', 'labelIds', 'network', 'brand', 'brands', 'responsibleId', 'archived', 'lastCompletedAt', 'lastCompletedDueDate'];

function valuesEqual(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a || []) === JSON.stringify(b || []);
  return (a === undefined ? null : a) === (b === undefined ? null : b);
}

function mergeChecklist(siblings) {
  const byId = new Map();
  siblings.forEach((d) => (d.checklist || []).forEach((item) => {
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
    } else if (item.done && !byId.get(item.id).done) {
      byId.set(item.id, item);
    }
  }));
  return Array.from(byId.values());
}

function mergeFiles(siblings) {
  const byId = new Map();
  siblings.forEach((d) => (d.files || []).forEach((f) => { if (!byId.has(f.id)) byId.set(f.id, f); }));
  return Array.from(byId.values());
}

function migrateReconcileSiblingDemandas99() {
  if (hasOneTimeMigrationRun(MIGRATION_NAME)) return;
  const all = db.get('demandas').value();
  const groups = new Map();
  all.forEach((d) => {
    if (!d.sourceSocialPostId) return;
    if (!groups.has(d.sourceSocialPostId)) groups.set(d.sourceSocialPostId, []);
    groups.get(d.sourceSocialPostId).push(d);
  });

  let groupsFixed = 0;
  let demandasTocadas = 0;

  groups.forEach((siblings) => {
    if (siblings.length < 2) return;

    const divergentFields = SCALAR_FIELDS.filter((field) => {
      const values = siblings.map((d) => d[field]);
      return values.some((v) => !valuesEqual(v, values[0]));
    });
    const checklistDiverges = (() => {
      const serialized = siblings.map((d) => JSON.stringify((d.checklist || []).map((i) => i.id).sort()));
      return serialized.some((s) => s !== serialized[0]);
    })();
    const filesDiverges = (() => {
      const serialized = siblings.map((d) => JSON.stringify((d.files || []).map((f) => f.id).sort()));
      return serialized.some((s) => s !== serialized[0]);
    })();

    if (divergentFields.length === 0 && !checklistDiverges && !filesDiverges) return;

    const mostRecent = siblings.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
    const mergedChecklist = checklistDiverges ? mergeChecklist(siblings) : null;
    const mergedFiles = filesDiverges ? mergeFiles(siblings) : null;
    const now = new Date().toISOString();

    siblings.forEach((d) => {
      const updates = {};
      divergentFields.forEach((field) => {
        if (!valuesEqual(d[field], mostRecent[field])) updates[field] = mostRecent[field];
      });
      if (mergedChecklist) updates.checklist = mergedChecklist;
      if (mergedFiles) updates.files = mergedFiles;
      if (Object.keys(updates).length === 0) return;
      updates.updatedAt = now;
      db.get('demandas').find({ id: d.id }).assign(updates).write();
      demandasTocadas += 1;
      logAudit({
        user: { id: 'system', name: 'Sistema (manutenção 99ª rodada)' },
        entityType: 'demanda',
        entityId: d.id,
        entityLabel: updates.title || d.title,
        action: 'update',
        details: 'Reconciliada automaticamente: esta demanda e sua(s) irmã(s) do mesmo agendamento estavam com dados divergentes, de antes de existir a sincronização total entre demandas-irmãs -- igualadas sem perder nenhuma informação já cadastrada (checklist/arquivos: união de tudo que existia em cada uma).',
        meta: { visibility: d.visibility }
      });
    });
    groupsFixed += 1;
  });

  if (groupsFixed > 0) {
    console.log(`[migrateReconcileSiblingDemandas99] ${groupsFixed} grupo(s) de demandas-irmãs estavam divergentes e foram reconciliados (${demandasTocadas} demanda(s) atualizadas, nenhuma informação perdida).`);
  }
  markOneTimeMigrationRun(MIGRATION_NAME);
}

module.exports = { migrateReconcileSiblingDemandas99 };
