const db = require('../db');

// 36ª rodada: dá um valor inicial de `lastCompletedAt` pra demandas que já
// estavam concluídas ANTES desse campo existir -- sem essa migração, elas
// deixariam de pontuar no REIS DO MARKETING assim que essa rodada subir em
// produção, já que a pontuação passa a olhar pra `lastCompletedAt` em vez
// de `status + updatedAt`. Usa `updatedAt` como aproximação, que é
// exatamente o valor que a fonte (1) já usava antes pra decidir o mês --
// então pra quem já estava concluída, o resultado da pontuação não muda,
// só passa a vir do campo novo. Idempotente (só mexe em quem ainda não tem
// o campo), roda sozinha a cada início do servidor.
function migrateLastCompletedAt() {
  let total = 0;
  db.get('demandas').value().forEach((d) => {
    if (d.status === 'concluida' && !d.lastCompletedAt) {
      db.get('demandas').find({ id: d.id }).assign({ lastCompletedAt: d.updatedAt || d.createdAt }).write();
      total += 1;
    }
  });
  if (total > 0) {
    console.log(`[migrateLastCompletedAt] ${total} demanda(s) receberam lastCompletedAt retroativo.`);
  }
}

module.exports = { migrateLastCompletedAt };
