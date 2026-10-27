// 112ª rodada, pedido da Raquel sobre o Budget recorrente (ver
// routes/budget.js, POST /api/budget/pull-recurring): "prefiro que o
// planejado mostre os recorrentes e o realizado puxe eles quando mes
// chegar, ate por que os valores estarao certos, são contratos fechados
// e se mudarem, eu posso editar não é?"
//
// Quarto recurso baseado em temporizador de verdade da Papoi (mesmo
// padrão de utils/pontoReminders.js, utils/demandaAtrasadaReminders.js e
// utils/aprovacaoPendenteReminders.js) -- mas aqui não é lembrete por
// e-mail, é um preenchimento automático de dado: todo lançamento do
// Budget marcado `recorrente: true` com Realizado ainda vazio, assim que
// o mês dele chega (ou já passou), tem o Realizado preenchido sozinho
// com o mesmo valor do Planejado (ponto de partida -- contrato fechado,
// valor já sabido). A Raquel pode editar o Realizado normalmente depois,
// se o valor mudar de verdade -- isso não é revertido nem sobrescrito de
// volta: só mexe em lançamentos com Realizado ainda `null`/vazio.
//
// Idempotente por natureza (diferente dos lembretes por e-mail, que
// precisam de uma coleção própria de dedup): uma vez preenchido, o
// Realizado deixa de ser `null`, então a checagem seguinte já não bate
// mais nele -- não precisa de nenhuma coleção de "já disparei".
const db = require('../db');

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1x por hora -- não precisa de precisão ao minuto, só rodar pelo menos 1x por dia desde a virada do mês.

function isEmpty(v) {
  return v === null || v === undefined || v === '';
}

function checkAndFillRecurringRealizado() {
  const now = new Date();
  const entries = db.get('budgetEntries').value();
  entries.forEach((e) => {
    if (!e.recorrente) return;
    if (!isEmpty(e.realizado)) return; // já tem Realizado (manual ou já preenchido antes) -- nunca sobrescreve
    if (isEmpty(e.planejado)) return; // nada pra copiar
    const mes = Number(e.month) || 1;
    const entryDate = new Date(Number(e.year), mes - 1, 1);
    if (entryDate > now) return; // mês ainda não chegou
    db.get('budgetEntries').find({ id: e.id }).assign({
      realizado: Number(e.planejado),
      updatedAt: new Date().toISOString(),
      updatedBy: 'Sincronização automática (Budget recorrente)',
      updatedById: null
    }).write();
  });
}

let started = false;
function startBudgetRecorrenteRealizadoScheduler() {
  if (started) return; // idempotente -- evita 2 intervalos se for chamado 2x por engano
  started = true;
  setInterval(checkAndFillRecurringRealizado, CHECK_INTERVAL_MS);
}

module.exports = {
  startBudgetRecorrenteRealizadoScheduler,
  // Exportado só pra teste automatizado poder chamar a checagem sob
  // demanda (em vez de esperar o setInterval de verdade rodar).
  checkAndFillRecurringRealizado
};
