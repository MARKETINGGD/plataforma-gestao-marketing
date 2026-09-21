// Importação única dos horários de ponto que a Raquel mandou por print
// (47ª rodada) — roda uma vez no boot do servidor (mesmo padrão dos outros
// seeds/migrações já existentes), casando pelo NOME já cadastrado na
// Plataforma (confirmado com a Raquel: "sim, batem certinho"). Só
// preenche `pontoSchedule` de quem ainda não tem esse campo — não
// sobrescreve um horário que já tenha sido ajustado manualmente na tela
// de Usuários depois desta rodada. Raquel e Melissa NÃO entram nesta
// lista — confirmado com a Raquel: "Eu e a Melissa, não batemos ponto".
const db = require('../db');

const HORARIOS_INICIAIS = {
  'gessé': { entradaManha: '07:15', saidaAlmoco: '11:45', voltaAlmoco: '13:15', saidaFinal: '17:33' },
  'felipe': { entradaManha: '07:30', saidaAlmoco: '11:45', voltaAlmoco: '13:00', saidaFinal: '17:33' },
  'erika': { entradaManha: '07:15', saidaAlmoco: '11:25', voltaAlmoco: '13:10', saidaFinal: '17:48' },
  'miguel': { entradaManha: '07:00', saidaAlmoco: '11:30', voltaAlmoco: '12:45', saidaFinal: '17:03' },
  'kauê': { entradaManha: '07:00', saidaAlmoco: '11:30', voltaAlmoco: '13:00', saidaFinal: '17:18' },
  'eduarda': { entradaManha: '07:30', saidaAlmoco: '11:45', voltaAlmoco: '13:00', saidaFinal: '17:33' },
  'gwilbert': { entradaManha: '07:30', saidaAlmoco: '11:45', voltaAlmoco: '13:00', saidaFinal: '17:33' }
};

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

function migratePontoScheduleInicial() {
  const users = db.get('users').filter((u) => u.pontoSchedule === undefined).value();
  users.forEach((u) => {
    const horario = HORARIOS_INICIAIS[normalizeName(u.name)] || HORARIOS_INICIAIS[normalizeName(u.username)];
    if (horario) {
      db.get('users').find({ id: u.id }).assign({ pontoSchedule: { ...horario } }).write();
      console.log(`[migratePontoScheduleInicial] Horário de ponto cadastrado pra ${u.name}.`);
    } else {
      // Ninguém encontrado pra esse nome na lista inicial (inclui Raquel/
      // Melissa, de propósito) — grava null pra não ficar reprocessando
      // esse usuário sozinho a cada boot (a checagem acima é por
      // `undefined`, não por `null`).
      db.get('users').find({ id: u.id }).assign({ pontoSchedule: null }).write();
    }
  });
}

module.exports = { migratePontoScheduleInicial };
