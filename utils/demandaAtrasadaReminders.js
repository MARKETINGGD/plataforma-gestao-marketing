// 109ª rodada, pedido da Raquel: "quero poder enviar e-mail de notificação
// para o email de cada membro da equipe -- somente as notificações de: ...
// demandas atrasadas (para a pessoa responsável) ...".
//
// Segundo recurso baseado em temporizador de verdade (`setInterval`) da
// Papoi -- mesmo espírito do primeiro (utils/pontoReminders.js, 47ª
// rodada): checagem periódica, idempotente, com log de disparo pra nunca
// mandar o mesmo aviso 2x. Diferença de propósito: isso aqui é só e-mail
// (sem recado interno nem push) -- pedido explícito da Raquel foi por
// e-mail; criar também um recado novo pra isso seria decisão própria, não
// pedida, então por ora fica de fora (fácil de adicionar depois se ela
// quiser).
//
// "Demanda atrasada" usa a MESMA definição já usada no quadro (ver
// `isOverdue` em routes/demandas.js): tem data de entrega, não está
// concluída, não está arquivada, e a data já passou. Duplicado aqui (não
// importado) pelo mesmo motivo de sempre nesta base -- evitar um require
// cruzado entre rotas/utils que não têm mais nada a ver uma com a outra
// (ver comentário em canApprove duplicado em utils/metaPublisher.js).
//
// Dispara 1x por dia por demanda enquanto ela continuar atrasada (não é
// "1x só pra sempre") -- decisão própria (a Raquel não detalhou a
// frequência), fácil de ajustar se ela preferir diferente. Checa de 30 em
// 30 minutos (não precisa da precisão de minuto do lembrete de ponto).

const db = require('../db');
const { sendEmailToUsers } = require('./mailer');
const { nowSaoPaulo } = require('./pontoReminders');
const { todaySaoPauloStr } = require('./dateSaoPaulo');

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const FIRED_LOG_RETENTION_DAYS = 3;

function isOverdue(demanda) {
  if (!demanda.dueDate || demanda.status === 'concluida' || demanda.archived) return false;
  // 110ª rodada, correção de bug: usava UTC pra saber "qual é o dia de
  // hoje" (`new Date().toISOString().slice(0, 10)`), o que fazia o e-mail
  // de "demanda atrasada" disparar ~3h antes do prazo realmente vencer no
  // horário de Brasília (entre 21h e meia-noite, horário de Brasília, o
  // UTC já virou o dia seguinte). Trocado por `todaySaoPauloStr()`
  // (utils/dateSaoPaulo.js), que calcula "hoje" no fuso America/Sao_Paulo.
  const today = todaySaoPauloStr();
  return demanda.dueDate < today;
}

function alreadyFired(demandaId, dateStr) {
  return !!db.get('demandaAtrasadaEmailFired').find({ demandaId, dateStr }).value();
}

function markFired(demandaId, dateStr) {
  db.get('demandaAtrasadaEmailFired').push({ demandaId, dateStr, firedAt: new Date().toISOString() }).write();
}

function pruneFiredLog(todayStr) {
  const cutoff = new Date(todayStr + 'T00:00:00');
  cutoff.setDate(cutoff.getDate() - FIRED_LOG_RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  db.get('demandaAtrasadaEmailFired').remove((f) => f.dateStr < cutoffStr).write();
}

function checkAndSendOverdueDemandEmails() {
  const { dateStr } = nowSaoPaulo();
  pruneFiredLog(dateStr);
  const demandas = db.get('demandas').value();
  demandas.forEach((d) => {
    if (!d.responsibleId) return;
    if (!isOverdue(d)) return;
    if (alreadyFired(d.id, dateStr)) return;
    sendEmailToUsers([d.responsibleId], {
      subject: `Demanda atrasada -- ${d.title}`,
      text: `Aviso Papoi: a demanda "${d.title}" está atrasada (data de entrega: ${d.dueDate}).`
    });
    markFired(d.id, dateStr);
  });
}

let started = false;
function startDemandaAtrasadaReminderScheduler() {
  if (started) return; // idempotente — evita 2 intervalos se for chamado 2x por engano
  started = true;
  setInterval(checkAndSendOverdueDemandEmails, CHECK_INTERVAL_MS);
}

module.exports = {
  startDemandaAtrasadaReminderScheduler,
  // Exportado só pra teste automatizado poder chamar a checagem sob
  // demanda (em vez de esperar o setInterval de verdade rodar).
  checkAndSendOverdueDemandEmails
};
