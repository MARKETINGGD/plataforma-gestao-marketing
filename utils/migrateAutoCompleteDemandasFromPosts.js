const db = require('../db');
const { cascadeCompleteDemandas } = require('./demandCascade');

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
// Naturalmente idempotente (não precisa de nenhuma marca de "já rodei") —
// uma vez que tudo num grupo está concluído, não sobra nada pra fazer nas
// próximas vezes que o servidor subir.
function migrateAutoCompleteDemandasFromPosts() {
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
}

module.exports = { migrateAutoCompleteDemandasFromPosts };
