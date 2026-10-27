const db = require('../db');
const { logAudit } = require('./audit');

// 34ª rodada — quando alguém é marcado como envolvido num agendamento de
// redes sociais, a Plataforma cria automaticamente 1 demanda por pessoa
// (uma pra cada, não 1 card compartilhado — ver createDemandCardsForNewInvolved
// em routes/socialPosts.js), todas ligadas de volta ao mesmo agendamento
// pelo campo `sourceSocialPostId`. Na prática, pro time, essas demandas
// "irmãs" representam UMA coisa só (o mesmo agendamento).
//
// 99ª rodada, pedido explícito da Raquel: "a mudança deve ocorrer em todos
// os cards de demandas irmãs vindas do agendamento. Essa mudança pode ser
// feita pelo agendamento ou pelas demandas, deve atualizar para todo
// mundo... Quando uma demanda, independente de onde ela veio, tem
// mudanças, isso sempre deve refletir no card de todos que estão ali,
// assim todos terão sempre as mesmas informações." Isso reverte, DE
// PROPÓSITO, a cautela da 98ª rodada ("demanda já concluída/arquivada é
// histórico, não deve ser alterada por sincronização") -- a partir desta
// rodada, a sincronização entre irmãs vale pra QUALQUER status, inclusive
// concluída/arquivada: o card-irmão sempre reflete o estado mais recente,
// não importa onde a mudança aconteceu (no agendamento ou direto em
// qualquer uma das demandas).
function getSiblings(sourceSocialPostId, excludeId) {
  if (!sourceSocialPostId) return [];
  return db.get('demandas').value().filter((d) =>
    d.sourceSocialPostId === sourceSocialPostId && d.id !== excludeId
  );
}

// `excludeId` (opcional) é o id da demanda que já está sendo concluída na
// mesma chamada que disparou essa função (pra não tentar re-gravar ela
// aqui) — quando o gatilho é o agendamento virando "publicado", não tem
// uma demanda específica sendo excluída, então passa null.
// `req` (opcional) é usado só pra registrar no Histórico quem/quando —
// sem ele (chamada de uma migração no boot do servidor, sem usuário
// logado), a conclusão acontece do mesmo jeito, só sem log de auditoria.
// Retorna quantas demandas foram concluídas, pra quem chamar poder logar.
//
// Usada quando o AGENDAMENTO em si é marcado como "publicado" (não uma
// demanda específica sendo concluída à mão -- esse outro caminho, desde a
// 99ª rodada, passa por syncLinkedDemandas abaixo, que cobre todo campo de
// uma vez só, não só a conclusão).
function cascadeCompleteDemandas(sourceSocialPostId, excludeId, req) {
  if (!sourceSocialPostId) return 0;
  const targets = getSiblings(sourceSocialPostId, excludeId);
  const now = new Date().toISOString();
  let changed = 0;
  targets.forEach((d) => {
    if (d.status === 'concluida' && d.archived) return; // já está nesse estado, nada a fazer
    // lastCompletedAt/lastCompletedDueDate (36ª/39ª rodada): mesma marcação
    // de "quando foi concluída de verdade" já feita no PUT /:id manual (ver
    // routes/demandas.js) -- usada pelo REIS DO MARKETING pra pontuar quem
    // está marcado em cada demanda-irmã, não só na que disparou a conclusão.
    db.get('demandas').find({ id: d.id }).assign({
      status: 'concluida',
      updatedAt: now,
      lastCompletedAt: now,
      lastCompletedDueDate: d.dueDate || null,
      archived: true
    }).write();
    changed += 1;
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
  return changed;
}

// Nomes de quem mais foi marcado no MESMO agendamento (demandas-irmãs,
// mesmo sourceSocialPostId), pra mostrar na tela — pedido da Raquel: "o
// card que é criado automaticamente na lista das pessoas marcadas não
// fica mostrando quem foi marcado originalmente no agendamento, preciso
// que essa marcação apareça". Não inclui a própria demanda `d`.
//
// 99ª rodada: deixou de filtrar `!s.archived` -- quem está marcado numa
// demanda-irmã já arquivada/concluída continua contando como "também
// envolvido", pelo mesmo motivo de sempre mostrar o estado real do grupo
// inteiro, não só da parte ainda "viva".
function alsoInvolvedUserIds(d) {
  if (!d.sourceSocialPostId) return [];
  const siblings = db.get('demandas').value().filter((s) =>
    s.sourceSocialPostId === d.sourceSocialPostId && s.id !== d.id
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
// já criadas, porque nada chamava de volta nelas.
//
// 99ª rodada, pedido explícito da Raquel -- esta função passou a ser a
// peça central da "conversa" entre demandas-irmãs, usada tanto por:
//  (a) uma edição no AGENDAMENTO (ver routes/socialPosts.js PUT /:id), SEM
//      excludeId (nenhuma demanda específica disparou, sincroniza todas);
//  (b) uma edição em QUALQUER UMA das demandas-irmãs (ver routes/demandas.js
//      PUT /:id), COM excludeId = a própria demanda que acabou de ser
//      salva (ela já está com o valor certo, não precisa regravar nela
//      mesma, só nas outras).
// Removido o filtro "!d.archived && d.status !== 'concluida'" que existia
// até a 98ª rodada -- a partir de agora, QUALQUER demanda-irmã recebe a
// sincronização, esteja ela concluída/arquivada ou não (pedido explícito:
// "independente de onde ela veio... sempre deve refletir... as mesmas
// informações"). `fields` é um objeto com os valores já calculados que
// devem valer pra todo o grupo -- só grava as chaves que vierem definidas
// (!== undefined) e que realmente mudaram, pra não gerar update/log à toa.
// `detail` (opcional) personaliza a frase do Histórico; sem ele, usa uma
// frase genérica. Retorna quantas demandas-irmãs foram de fato atualizadas.
function syncLinkedDemandas(sourceSocialPostId, fields, req, excludeId, detail) {
  if (!sourceSocialPostId) return 0;
  const targets = getSiblings(sourceSocialPostId, excludeId);
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
        entityLabel: updates.title || d.title,
        action: 'update',
        details: detail || 'Atualizada automaticamente: outra demanda (ou o agendamento) do mesmo material foi editada.',
        meta: { visibility: d.visibility }
      });
    }
  });
  return changedCount;
}

// 99ª rodada: mesma ideia de syncLinkedDemandas, mas pra um campo que é
// SEMPRE um array inteiro substituído de uma vez (checklist, arquivos) em
// vez de comparado chave a chave -- usado quando o checklist ou a lista de
// arquivos de uma demanda-irmã muda (ver routes/demandas.js), pra que
// todo o grupo fique com o MESMO checklist/MESMOS arquivos, sempre.
function mirrorArrayField(sourceSocialPostId, excludeId, fieldName, value, req, detail) {
  if (!sourceSocialPostId) return 0;
  const targets = getSiblings(sourceSocialPostId, excludeId);
  if (targets.length === 0) return 0;
  const now = new Date().toISOString();
  targets.forEach((d) => {
    db.get('demandas').find({ id: d.id }).assign({ [fieldName]: value, updatedAt: now }).write();
    if (req && req.user) {
      logAudit({
        user: req.user,
        entityType: 'demanda',
        entityId: d.id,
        entityLabel: d.title,
        action: 'update',
        details: detail,
        meta: { visibility: d.visibility }
      });
    }
  });
  return targets.length;
}

// 99ª rodada: comentar numa demanda-irmã registra o MESMO comentário no
// Histórico de todas as outras do grupo (cada uma com sua própria entrada
// no auditLog, igual ao resto do histórico) -- assim quem abrir qualquer
// card-irmão vê a conversa inteira, não só quem comentou no card dela.
function mirrorCommentToSiblings(sourceSocialPostId, excludeId, text, req) {
  if (!sourceSocialPostId || !req || !req.user) return 0;
  const targets = getSiblings(sourceSocialPostId, excludeId);
  targets.forEach((d) => {
    logAudit({
      user: req.user,
      entityType: 'demanda',
      entityId: d.id,
      entityLabel: d.title,
      action: 'comment',
      details: text,
      meta: { visibility: d.visibility }
    });
  });
  return targets.length;
}

// 99ª rodada: quando uma pessoa NOVA é marcada como envolvida num
// agendamento que JÁ TINHA outras demandas-irmãs criadas antes, o card
// dela precisa nascer já com o mesmo estado "editável" que o resto do
// grupo tem (status, cor, link, título do checklist, etiquetas,
// responsável, arquivamento, checklist e arquivos) -- senão ela entraria
// com os valores padrão de sempre, quebrando a regra de "todos sempre com
// as mesmas informações". Título/descrição/dueDate/rede/marca NÃO entram
// aqui porque já nascem calculados direto do próprio agendamento (ver
// demandTitleAndDescriptionForPost em routes/socialPosts.js) -- esses já
// nascem iguais, não precisam ser copiados de ninguém.
// Retorna null quando não existe nenhuma demanda-irmã ainda (grupo novo,
// usa os padrões de sempre).
function sharedStateForNewSibling(sourceSocialPostId) {
  const siblings = getSiblings(sourceSocialPostId, null);
  if (siblings.length === 0) return null;
  const representative = siblings.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
  return {
    status: representative.status,
    // 106ª rodada: uma pessoa NOVA entrando num grupo que já está em
    // "pessoal" (alguém moveu antes dela entrar) nasce já em pessoal,
    // igual ao resto do grupo -- mesma lógica de "sempre as mesmas
    // informações" aplicada a visibility.
    visibility: representative.visibility === 'pessoal' ? 'pessoal' : 'geral',
    color: representative.color || null,
    link: representative.link || null,
    checklistTitle: representative.checklistTitle || 'Checklist',
    labelIds: representative.labelIds || [],
    responsibleId: representative.responsibleId || null,
    archived: !!representative.archived,
    checklist: representative.checklist || [],
    files: representative.files || [],
    lastCompletedAt: representative.lastCompletedAt || null,
    lastCompletedDueDate: representative.lastCompletedDueDate !== undefined ? representative.lastCompletedDueDate : null,
    // 114ª rodada, bug encontrado em auditoria (pedido da Raquel: "conserte
    // esses bugs"): dueDate/recurrence/recurring também precisam ser
    // herdados de quem já está no grupo -- sem isso, se o grupo já tinha
    // sido alterado (nova data combinada, virou recorrente) depois de
    // criado, a pessoa que entra depois nascia com a data antiga/fixa
    // calculada direto do agendamento, quebrando "todos com as mesmas
    // informações" pros campos que o grupo já havia customizado.
    dueDate: representative.dueDate !== undefined ? representative.dueDate : null,
    recurrence: representative.recurrence !== undefined ? representative.recurrence : null,
    recurring: !!representative.recurring
  };
}

module.exports = {
  cascadeCompleteDemandas,
  alsoInvolvedUserIds,
  syncLinkedDemandas,
  mirrorArrayField,
  mirrorCommentToSiblings,
  sharedStateForNewSibling,
  getSiblings
};
