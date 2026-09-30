// Aviso de aniversário de influencer (78ª rodada, pedido explícito da
// Raquel: "deve vir um recado na aba de recados, para quem cadastrou a
// influencer e a coordenadora, avisando o aniversario, sempre 10 dias
// antes do aniversario"). Mesmo padrão de temporizador de verdade rodando
// sozinho no servidor já usado em utils/pontoReminders.js (esse é o
// primeiro recurso "baseado em timer" desde aquele) -- só que aqui não
// precisa de precisão de minuto (aniversário é por DIA), então a checagem
// roda de hora em hora, não a cada poucos segundos.
//
// Pra nunca mandar o mesmo aviso 2x no mesmo ano (o `setInterval` pode
// bater várias vezes dentro do mesmo dia), cada disparo fica registrado em
// `influencerBirthdayFired` (chave única por influencer + ano) e conferido
// antes de mandar o próximo -- mesma ideia do `pontoFired` de lá.
//
// Limitação conhecida, mesmo espírito das outras ressalvas de "timer" já
// documentadas: se o servidor ficar fora do ar bem no dia exato do aviso
// (hoje == aniversário - 10 dias), esse aviso específico não dispara mais
// nesse ano -- não existe janela de "atrasado, mas ainda avisa".
const db = require('../db');
const { nowSaoPaulo } = require('./pontoReminders');
const { createAutoRecado } = require('../routes/recados');

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // de hora em hora -- aniversário não precisa de mais que isso
const DAYS_BEFORE = 10;
const BRAND_LABEL_PT = { debacco: 'De Bacco', ghelplus: 'GhelPlus' };

// Quantos dias faltam pro PRÓXIMO aniversário (0 = o aniversário é hoje),
// considerando o ano corrente ou o seguinte se a data já passou este ano.
// `dataNascimento` vem como 'YYYY-MM-DD' (ver personalFields em
// routes/influencers.js) -- só o mês/dia importam pra calcular o
// aniversário, o ano de nascimento em si não entra na conta.
function daysUntilNextBirthday(dataNascimento, todayStr) {
  const partes = String(dataNascimento || '').split('-');
  if (partes.length !== 3) return null;
  const [, mm, dd] = partes;
  const today = new Date(todayStr + 'T00:00:00');
  let next = new Date(`${today.getFullYear()}-${mm}-${dd}T00:00:00`);
  if (isNaN(next.getTime())) return null; // data inválida -- não deixa quebrar o resto da checagem
  if (next < today) next = new Date(`${today.getFullYear() + 1}-${mm}-${dd}T00:00:00`);
  return Math.round((next - today) / (1000 * 60 * 60 * 24));
}

function alreadyFired(influencerId, year) {
  return !!db.get('influencerBirthdayFired').find({ influencerId, year }).value();
}
function markFired(influencerId, year) {
  db.get('influencerBirthdayFired').push({ influencerId, year, firedAt: new Date().toISOString() }).write();
}

function checkAndFireInfluencerBirthdayReminders() {
  const { dateStr } = nowSaoPaulo();
  const year = parseInt(dateStr.slice(0, 4), 10);
  const influencers = db.get('influencers').value().filter((i) => i.dataNascimento);
  influencers.forEach((inf) => {
    const dias = daysUntilNextBirthday(inf.dataNascimento, dateStr);
    if (dias !== DAYS_BEFORE) return;
    if (alreadyFired(inf.id, year)) return;
    // Destinatários: quem cadastrou o influencer + toda coordenadora/
    // coordenador (pedido explícito -- "para quem cadastrou a influencer e
    // a coordenadora"). createAutoRecado já filtra qualquer id inválido
    // (ex.: quem cadastrou já não existe mais).
    const coordenadoras = db.get('users').value().filter((u) => u.cargo === 'coordenador').map((u) => u.id);
    const recipientIds = Array.from(new Set([inf.createdBy, ...coordenadoras].filter(Boolean)));
    if (recipientIds.length === 0) return;
    const marca = BRAND_LABEL_PT[inf.brand] || inf.brand;
    createAutoRecado({
      recipientIds,
      text: `Aniversário chegando: ${inf.name} (influencer ${marca}) faz aniversário em ${DAYS_BEFORE} dias.`
    });
    markFired(inf.id, year);
  });
}

let started = false;
function startInfluencerBirthdayScheduler() {
  if (started) return; // idempotente -- evita 2 intervalos se for chamado 2x por engano
  started = true;
  setInterval(checkAndFireInfluencerBirthdayReminders, CHECK_INTERVAL_MS);
}

module.exports = {
  startInfluencerBirthdayScheduler,
  // Exportado só pra teste automatizado poder chamar a checagem sob
  // demanda, sem precisar esperar 1h de verdade (mesmo padrão de
  // utils/pontoReminders.js).
  checkAndFireInfluencerBirthdayReminders
};
