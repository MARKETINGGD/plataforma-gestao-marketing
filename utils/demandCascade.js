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
    // lastCompletedAt (36ª rodada) -- mesma marcação de "quando foi
    // concluída de verdade" já feita no PUT /:id manual (ver
    // routes/demandas.js), aplicada aqui também pra quem é completada
    // automaticamente pela cascata. lastCompletedDueDate (39ª rodada) --
    // mesma lógica, com a data de entrega que valia na hora (essas
    // demandas-irmãs não passam pelo bloco de recorrência do PUT manual,
    // então a `dueDate` atual do card já é a que valia na conclusão).
    // archived (40ª rodada, pedido da Raquel: "para todos que estavam no
    // card") -- concluir automaticamente por cascata também arquiva, igual
    // à demanda que disparou a conclusão.
    db.get('demandas').find({ id: d.id }).assign({
      status: 'concluida',
      updatedAt: now,
      lastCompletedAt: now,
      lastCompletedDueDate: d.dueDate || null,
      archived: true
    }).write();
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

// 98ª rodada, bug reportado pela Raquel: "quando é criado algo em
// agendamento, ele vira uma demanda correto? mas quando altero data de
// postagem lá no agendamento, não esta alterando na demanda criada por
// ele, n esta tendo essa covnersa entre eles" -- createDemandCardsForNewInvolved
// (routes/socialPosts.js) só grava título/descrição/dueDate/rede/marca na
// CRIAÇÃO do card; uma edição posterior do agendamento (trocar a data, o
// assunto, a legenda, a rede, a marca...) nunca refletia nas demandas-irmãs
// já criadas, porque nada chamava de volta nelas. Mesmo espírito de
// cascadeCompleteDemandas acima (achar pelo sourceSocialPostId), só que
// sincronizando os CAMPOS do card em vez de completá-lo -- só mexe nas
// demandas ainda "vivas" (não arquivadas, não concluídas): uma demanda já
// concluída/arquivada é histórico, uma edição posterior no agendamento não
// deve reabri-la nem alterar silenciosamente um registro já fechado.
// `fields` é um objeto com os valores JÁ calculados a partir do post
// atualizado (ver demandTitleAndDescriptionForPost em routes/socialPosts.js)
// -- só grava as chaves que vierem definidas (!== undefined) e que
// realmente mudaram, pra não gerar update/log à toa quando nada mudou de
// verdade (ex.: PUT que só mexeu em `link` ou `briefingText`, campos que
// não entram em `fields`). Retorna quantas demandas foram atualizadas.
function syncLinkedDemandas(sourceSocialPostId, fields, req) {
  if (!sourceSocialPostId) return 0;
  const targets = db.get('demandas').value().filter((d) =>
    d.sourceSocialPostId === sourceSocialPostId &&
    !d.archived &&
    d.status !== 'concluida'
  );
  if (targets.length === 0) return 0;
  const now = new Date().toISOString();
  let changedCount = 0;
  targets.forEach((d) => {
    const updates = {};
    Object.keys(fields).forEach((key) => {
      if (fields[key] !== undefined && fields[key] !== d[key]) updates[key] = fields[key];
    });
    if (Object.keys(updates).length === 0) return;
    updates.updatedAt = now;
    db.get('demandas').find({ id: d.id }).assign(updates).write();
    changedCount += 1;
    if (req && req.user) {
      logAudit({
        user: req.user,
        entityType: 'demanda',
        entityId: d.id,
        entityLabel: d.title,
        action: 'update',
        details: 'Atualizada automaticamente: o agendamento de redes sociais de origem foi editado (data/assunto/legenda/rede/marca).',
        meta: { visibility: d.visibility }
      });
    }
  });
  return changedCount;
}

module.exports = { cascadeCompleteDemandas, alsoInvolvedUserIds, syncLinkedDemandas };
