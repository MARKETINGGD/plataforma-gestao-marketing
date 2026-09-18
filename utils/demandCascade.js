const db = require('../db');
const { logAudit } = require('./audit');

// 34ª rodada — quando alguém é marcado como envolvido num agendamento de
// redes sociais, a Plataforma cria automaticamente 1 demanda por pessoa
// (uma pra cada, não 1 card compartilhado — ver createDemandCardsForNewInvolved
// em routes/socialPosts.js), todas ligadas de volta ao mesmo agendamento
// pelo campo `sourceSocialPostId`. Na prática, pro time, essas demandas
// "irmãs" representam UMA coisa só (o mesmo agendamento) — pedido da
// Raquel: concluir a demanda de uma dessas pessoas deve concluir a de
// todo mundo marcado no mesmo agendamento também, e marcar o próprio
// agendamento como "publicado" deve completar todas de uma vez.
//
// `excludeId` (opcional) é o id da demanda que já está sendo concluída na
// mesma chamada que disparou essa função (pra não tentar re-gravar ela
// aqui) — quando o gatilho é o agendamento virando "publicado", não tem
// uma demanda específica sendo excluída, então passa null.
// `req` (opcional) é usado só pra registrar no Histórico quem/quando —
// sem ele (chamada de uma migração no boot do servidor, sem usuário
// logado), a conclusão acontece do mesmo jeito, só sem log de auditoria.
// Retorna quantas demandas foram concluídas, pra quem chamar poder logar.
function cascadeCompleteDemandas(sourceSocialPostId, excludeId, req) {
  if (!sourceSocialPostId) return 0;
  const targets = db.get('demandas').value().filter((d) =>
    d.sourceSocialPostId === sourceSocialPostId &&
    d.id !== excludeId &&
    !d.archived &&
    d.status !== 'concluida'
  );
  const now = new Date().toISOString();
  targets.forEach((d) => {
    db.get('demandas').find({ id: d.id }).assign({ status: 'concluida', updatedAt: now }).write();
    if (req && req.user) {
      logAudit({
        user: req.user,
        entityType: 'demanda',
        entityId: d.id,
        entityLabel: d.title,
        action: 'update',
        details: 'Concluída automaticamente: outra demanda do mesmo agendamento de redes sociais foi concluída (ou o agendamento foi marcado como publicado).',
        meta: { visibility: d.visibility }
      });
    }
  });
  return targets.length;
}

// Nomes de quem mais foi marcado no MESMO agendamento (demandas-irmãs,
// mesmo sourceSocialPostId), pra mostrar na tela — pedido da Raquel: "o
// card que é criado automaticamente na lista das pessoas marcadas não
// fica mostrando quem foi marcado originalmente no agendamento, preciso
// que essa marcação apareça". Não inclui a própria demanda `d`.
function alsoInvolvedUserIds(d) {
  if (!d.sourceSocialPostId) return [];
  const siblings = db.get('demandas').value().filter((s) =>
    s.sourceSocialPostId === d.sourceSocialPostId && s.id !== d.id && !s.archived
  );
  const ids = new Set();
  siblings.forEach((s) => (s.assigneeIds || []).forEach((id) => ids.add(id)));
  return Array.from(ids);
}

module.exports = { cascadeCompleteDemandas, alsoInvolvedUserIds };
