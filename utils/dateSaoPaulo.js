// Utilitário simples de data no fuso de Brasília (America/Sao_Paulo,
// UTC-3 o ano todo -- sem horário de verão atualmente no Brasil).
//
// Motivo de existir: vários pontos da Papoi precisavam saber "qual é o
// dia de hoje" pra comparar com uma data gravada (ex.: "essa demanda já
// venceu?", "essa ausência já acabou?") e usavam `new Date().toISOString()
// .slice(0, 10)`, que devolve a data em UTC, não no fuso de Brasília. Como
// o servidor roda em UTC (Railway), isso faz o "dia de hoje" virar o dia
// seguinte 3 horas mais cedo do que deveria (a partir das 21h, horário de
// Brasília) -- ex.: um lembrete de "demanda atrasada" podia disparar ~3h
// antes do prazo realmente vencer no horário de Brasília.
//
// Usa só `Intl.DateTimeFormat` (nativo do Node, não precisa de nenhuma
// biblioteca externa) -- mesmo mecanismo já usado em `nowSaoPaulo()`
// (utils/pontoReminders.js), só que aqui devolvendo só a data (sem hora),
// no formato `YYYY-MM-DD` que o resto da base já usa pra comparar com
// `dueDate`/`dataInicio`/`dataFim`.
function todaySaoPauloStr(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return fmt.format(date); // 'en-CA' formata como YYYY-MM-DD
}

module.exports = { todaySaoPauloStr };
