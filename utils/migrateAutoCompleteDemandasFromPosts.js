const db = require('../db');
const { cascadeCompleteDemandas } = require('./demandCascade');

// 112ª rodada, correção de bugs reais (auditoria pedida pela Raquel): esta
// migração roda em TODO boot do servidor (ver server.js, fora do escopo
// desta correção) -- o comentário original dizia "naturalmente
// idempotente", mas isso só vale enquanto ninguém REABRE manualmente uma
// demanda depois de completada: se alguém faz isso de propósito (demanda
// reaberta manualmente depois da publicação), o 2º caso desta migração
// ("grupo de demandas-irmãs onde alguém já completou a própria") enxerga
// a demanda-irmã AINDA completa do mesmo grupo e completa a reaberta de
// novo sozinha no próximo boot, desfazendo a reabertura manual. Mesma
// trava de "rodou uma vez só" usada em migrateReconcileSiblingDemandas99.js
// (ver comentário completo lá) -- inicializa a coleção
// `oneTimeMigrationsCompleted` na própria migração, sem mexer em db.js
// (fora do escopo desta correção).
const MIGRATION_NAME = 'autoCompleteDemandasFromPosts';
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

// 34ª rodada — o recurso de auto-conclusão (ver utils/demandCascade.js)
// só entra em ação a partir de agora, quando uma demanda-irmã é concluída
// ou um agendamento é marcado como publicado. Pedido da Raquel: "toda
// atualização deve considerar o que já está lançado" — ou seja, isso
// precisa valer também pro que já estava publicado/concluído ANTES dessa
// rodada existir, não só daqui pra frente. Essa migração roda sozinha ao
// iniciar o servidor e cobre os 2 casos:
//
// 1) Agendamento já publicado antes desta rodada: completa agora todas as
//    demandas ligadas a ele que ainda não estavam concluídas.
// 2) Grupo de demandas-irmãs (mesmo agendamento) onde alguém já tinha
//    concluído a própria demanda manualmente antes desse recurso existir:
//    completa o resto do grupo agora.
//
// ATUALIZAÇÃO (112ª rodada): o parágrafo acima ("naturalmente
// idempotente") só valia enquanto ninguém reabria manualmente uma demanda
// depois de completada -- ver a trava de "rodou uma vez só" logo acima
// (hasOneTimeMigrationRun/markOneTimeMigrationRun), que agora impede esta
// função de rodar de novo em boots seguintes.
function migrateAutoCompleteDemandasFromPosts() {
  if (hasOneTimeMigrationRun(MIGRATION_NAME)) return;
  let total = 0;

  const publishedPosts = db.get('socialPosts').value().filter((p) => p.status === 'publicado');
  publishedPosts.forEach((post) => {
    total += cascadeCompleteDemandas(post.id, null);
  });

  const linked = db.get('demandas').value().filter((d) => d.sourceSocialPostId && !d.archived);
  const bySource = {};
  linked.forEach((d) => {
    if (!bySource[d.sourceSocialPostId]) bySource[d.sourceSocialPostId] = [];
    bySource[d.sourceSocialPostId].push(d);
  });
  Object.keys(bySource).forEach((sourceId) => {
    const group = bySource[sourceId];
    const hasCompleted = group.some((d) => d.status === 'concluida');
    if (hasCompleted) {
      total += cascadeCompleteDemandas(sourceId, null);
    }
  });

  if (total > 0) {
    console.log(`[migrateAutoCompleteDemandasFromPosts] ${total} demanda(s) concluída(s) retroativamente (agendamento já publicado ou demanda-irmã já concluída antes desta rodada).`);
  }
  markOneTimeMigrationRun(MIGRATION_NAME);
}

module.exports = { migrateAutoCompleteDemandasFromPosts };
