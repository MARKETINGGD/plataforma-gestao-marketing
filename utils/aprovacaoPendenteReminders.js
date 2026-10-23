// 109ª rodada, pedido da Raquel: "quero poder enviar e-mail de notificação
// para o email de cada membro da equipe -- somente as notificações de: ...
// pedido de aprovação em espera a mais de 24 horas (somente para quem
// aprova) ...".
//
// Terceiro recurso baseado em temporizador de verdade da Papoi (ver
// utils/pontoReminders.js, 47ª rodada, e utils/demandaAtrasadaReminders.js,
// também 109ª rodada). Só e-mail (sem recado/push) -- mesmo motivo
// explicado em utils/demandaAtrasadaReminders.js.
//
// Cobre os 2 lugares da Papoi que têm um conceito de "esperando
// aprovação":
//  - Agendamento de redes sociais (routes/socialPosts.js): post com
//    `approvalStatus` 'pendente' (default quando o campo nunca foi
//    gravado, ver serialize() ali) E `pendingApprovalSince` preenchido
//    (campo novo desta rodada -- post de antes dela não tem, fica de fora
//    até a próxima vez que a aprovação dele for tocada).
//  - Demandas (routes/demandas.js): card com status 'aprovacao' ("Em
//    Aprovação") E `pendingApprovalSince` preenchido (mesma lógica, campo
//    novo).
//
// "Quem aprova": só gerente/coordenador(a) ou admin da Plataforma --
// mesmo público de `canApprove` (routes/socialPosts.js) e do equivalente
// duplicado em routes/demandas.js. Demandas não tem uma trava de
// permissão de verdade pra quem marca "Em Aprovação" (quadro é livre,
// qualquer um move qualquer card pra qualquer status) -- usar o mesmo
// público de "quem aprova" de Agendamento foi decisão própria, por ser o
// único grupo com esse papel já estabelecido na Papoi; fácil de ajustar
// se a Raquel quiser outro público pra Demandas especificamente.
//
// Dispara 1x por dia por post/demanda enquanto continuar esperando (mesma
// filosofia de "1x por dia" do lembrete de demanda atrasada). Checa de 30
// em 30 minutos.

const db = require('../db');
const { sendEmailToUsers } = require('./mailer');
const { nowSaoPaulo } = require('./pontoReminders');

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const THRESHOLD_MS = 24 * 60 * 60 * 1000;
const FIRED_LOG_RETENTION_DAYS = 3;

function approverIds() {
  return db.get('users').value()
    .filter((u) => u.isSuperAdmin || u.cargo === 'gerente' || u.cargo === 'coordenador')
    .map((u) => u.id);
}

function alreadyFired(entityType, entityId, dateStr) {
  return !!db.get('pendingApprovalEmailFired').find({ entityType, entityId, dateStr }).value();
}

function markFired(entityType, entityId, dateStr) {
  db.get('pendingApprovalEmailFired').push({ entityType, entityId, dateStr, firedAt: new Date().toISOString() }).write();
}

function pruneFiredLog(todayStr) {
  const cutoff = new Date(todayStr + 'T00:00:00');
  cutoff.setDate(cutoff.getDate() - FIRED_LOG_RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  db.get('pendingApprovalEmailFired').remove((f) => f.dateStr < cutoffStr).write();
}

function waitingTooLong(sinceIso) {
  if (!sinceIso) return false;
  const since = new Date(sinceIso).getTime();
  if (Number.isNaN(since)) return false;
  return Date.now() - since >= THRESHOLD_MS;
}

function checkAndSendPendingApprovalEmails() {
  const { dateStr } = nowSaoPaulo();
  pruneFiredLog(dateStr);
  const approvers = approverIds();
  if (approvers.length === 0) return;

  const posts = db.get('socialPosts').value();
  posts.forEach((p) => {
    const effectiveApprovalStatus = p.approvalStatus || 'pendente';
    if (effectiveApprovalStatus !== 'pendente') return;
    if (!waitingTooLong(p.pendingApprovalSince)) return;
    if (alreadyFired('socialPost', p.id, dateStr)) return;
    const postTitle = p.subject && p.subject.trim() ? p.subject.trim() : `${p.platform} · ${p.scheduledDate || 'sem data'}`;
    sendEmailToUsers(approvers, {
      subject: `Aprovação pendente há mais de 24h -- ${postTitle}`,
      text: `Aviso Papoi: o post "${postTitle}" está esperando aprovação há mais de 24 horas.`
    });
    markFired('socialPost', p.id, dateStr);
  });

  const demandas = db.get('demandas').value();
  demandas.forEach((d) => {
    if (d.status !== 'aprovacao' || d.archived) return;
    if (!waitingTooLong(d.pendingApprovalSince)) return;
    if (alreadyFired('demanda', d.id, dateStr)) return;
    sendEmailToUsers(approvers, {
      subject: `Aprovação pendente há mais de 24h -- ${d.title}`,
      text: `Aviso Papoi: a demanda "${d.title}" está esperando aprovação ("Em Aprovação") há mais de 24 horas.`
    });
    markFired('demanda', d.id, dateStr);
  });
}

let started = false;
function startAprovacaoPendenteReminderScheduler() {
  if (started) return; // idempotente — evita 2 intervalos se for chamado 2x por engano
  started = true;
  setInterval(checkAndSendPendingApprovalEmails, CHECK_INTERVAL_MS);
}

module.exports = {
  startAprovacaoPendenteReminderScheduler,
  // Exportado só pra teste automatizado poder chamar a checagem sob
  // demanda (em vez de esperar o setInterval de verdade rodar).
  checkAndSendPendingApprovalEmails
};
