// Lembretes automáticos de bater o ponto (47ª rodada, pedido da Raquel):
// "Cada colaborador 5 minutos antes de dar o horario de entrada e saida,
// deve receber um aviso... e 5 min depois um novo lembrete". Cada pessoa
// tem até 4 horários cadastrados (entrada da manhã, saída pro almoço,
// volta do almoço, saída final — ver routes/auth.js, `pontoSchedule`) —
// pra cada horário preenchido, dispara 2 lembretes privados em Recados
// (mesmo mecanismo de recado automático do sistema já usado desde a 44ª/
// 45ª rodada, `createAutoRecado`): um "Hey NOME! Não esqueça de bater o
// ponto." 5 minutos antes, e um "Bateu o ponto né NOME?" 5 minutos
// depois. Confirmado com a Raquel: só de segunda a sexta (sem fim de
// semana), e pessoa sem nenhum horário cadastrado (ela mesma e a Melissa,
// que não batem ponto) simplesmente não recebe nada.
//
// Como a Plataforma não tem nenhuma infraestrutura de "job agendado" (tudo
// até aqui sempre reagia a uma ação de alguém — ver Arquitetura-base), este
// é o primeiro recurso que precisa de um temporizador de verdade rodando
// sozinho no servidor. Broadcast é feito comparando o horário atual (fuso
// America/Sao_Paulo, calculado com Intl — independente de em qual fuso o
// processo do Node está rodando no Railway) contra cada horário cadastrado
// ± 5 minutos, checando a cada 20 segundos (mais frequente que 1x/minuto,
// de propósito, pra reduzir o risco de o `setInterval` "pular" o minuto
// exato por causa de pequenas variações de agendamento do próprio Node).
// Pra nunca disparar o mesmo lembrete 2x (o `setInterval` pode bater mais
// de uma vez dentro do mesmo minuto), cada disparo é registrado em
// `pontoFired` (chave única por pessoa+dia+horário+fase) e conferido antes
// de mandar o próximo.
//
// Limitação conhecida (mesmo espírito das outras ressalvas de "coisa
// baseada em temporizador" já registradas na documentação): se o servidor
// ficar fora do ar bem no minuto exato do lembrete, esse lembrete
// específico não dispara mais nesse dia (não existe uma janela de "já
// passou, mas ainda dá tempo" — decisão deliberada, pra não mandar um
// aviso de "bata o ponto" atrasado demais e sem sentido).

const db = require('../db');
const { PONTO_SLOTS } = require('../routes/auth');
const { createAutoRecado } = require('../routes/recados');

const CHECK_INTERVAL_MS = 20 * 1000;
const REMINDER_OFFSET_MINUTES = 5;
const FIRED_LOG_RETENTION_DAYS = 3;

function nowSaoPaulo() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const map = {};
  fmt.formatToParts(new Date()).forEach((p) => { map[p.type] = p.value; });
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0; // alguns runtimes devolvem "24:00" à meia-noite com hour12:false
  return {
    dateStr: `${map.year}-${map.month}-${map.day}`,
    hhmm: `${String(hour).padStart(2, '0')}:${map.minute}`,
    isWeekday: !['Sat', 'Sun'].includes(map.weekday)
  };
}

// Soma (ou subtrai, com delta negativo) minutos a um horário "HH:MM",
// sempre dentro do mesmo dia (não precisa lidar com virada de dia — os
// horários de ponto são sempre durante o expediente, nunca perto da
// meia-noite).
function addMinutesToHHMM(hhmm, deltaMinutes) {
  const [h, m] = hhmm.split(':').map(Number);
  let total = h * 60 + m + deltaMinutes;
  total = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || name;
}

function alreadyFired(userId, dateStr, slot, phase) {
  return !!db.get('pontoFired').find({ userId, dateStr, slot, phase }).value();
}

function markFired(userId, dateStr, slot, phase) {
  db.get('pontoFired').push({ userId, dateStr, slot, phase, firedAt: new Date().toISOString() }).write();
}

// Limpa entradas de dias antigos a cada checagem, pra `pontoFired` nunca
// crescer sem controle (só precisamos saber o que já disparou HOJE).
function pruneFiredLog(todayStr) {
  const cutoff = new Date(todayStr + 'T00:00:00');
  cutoff.setDate(cutoff.getDate() - FIRED_LOG_RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  db.get('pontoFired').remove((f) => f.dateStr < cutoffStr).write();
}

function checkAndFirePontoReminders() {
  const { dateStr, hhmm, isWeekday } = nowSaoPaulo();
  pruneFiredLog(dateStr);
  if (!isWeekday) return; // confirmado com a Raquel: só dias úteis (seg-sex)

  const users = db.get('users').value().filter((u) => u.pontoSchedule);
  users.forEach((u) => {
    PONTO_SLOTS.forEach((slot) => {
      const target = u.pontoSchedule[slot];
      if (!target) return;

      const antesTarget = addMinutesToHHMM(target, -REMINDER_OFFSET_MINUTES);
      if (hhmm === antesTarget && !alreadyFired(u.id, dateStr, slot, 'antes')) {
        createAutoRecado({
          recipientIds: [u.id],
          text: `Hey ${firstName(u.name)}! Não esqueça de bater o ponto.`
        });
        markFired(u.id, dateStr, slot, 'antes');
      }

      const depoisTarget = addMinutesToHHMM(target, REMINDER_OFFSET_MINUTES);
      if (hhmm === depoisTarget && !alreadyFired(u.id, dateStr, slot, 'depois')) {
        createAutoRecado({
          recipientIds: [u.id],
          text: `Bateu o ponto né ${firstName(u.name)}?`
        });
        markFired(u.id, dateStr, slot, 'depois');
      }
    });
  });
}

let started = false;
function startPontoReminderScheduler() {
  if (started) return; // idempotente — evita 2 intervalos se for chamado 2x por engano
  started = true;
  setInterval(checkAndFirePontoReminders, CHECK_INTERVAL_MS);
}

module.exports = {
  startPontoReminderScheduler,
  // Exportado só pra teste automatizado poder chamar a checagem sob
  // demanda (em vez de esperar o setInterval de verdade rodar).
  checkAndFirePontoReminders,
  addMinutesToHHMM,
  nowSaoPaulo
};
