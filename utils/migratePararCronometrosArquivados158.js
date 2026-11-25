const db = require('../db');
const { pararCronometrosRodando } = require('./demandCascade');

// 158ª rodada, item #122, 5º ajuste (bug reportado pela Raquel: cronômetro
// de Anelize continuava contando em "Trabalhando agora" numa demanda já
// concluída/arquivada, MESMO depois da correção que faz
// concluir/arquivar parar o cronômetro -- ver pararCronometrosRodando()
// em utils/demandCascade.js). Causa: aquela correção só age na TRANSIÇÃO
// (no momento em que a demanda vira concluída/arquivada) -- qualquer
// demanda que já tivesse ficado concluída/arquivada ANTES da correção
// subir em produção continuava com o cronômetro preso, porque nada
// nunca ia reprocessá-la depois. Esta migração varre TODAS as demandas
// já concluídas/arquivadas e para qualquer cronômetro que ainda esteja
// rodando nelas, uma vez só, retroativamente. Idempotente (só grava
// quem realmente tinha algo rodando) e roda sozinha a cada início do
// servidor, então também cobre -- de graça -- qualquer caso futuro que a
// gente não tenha previsto nos 4 pontos de código já corrigidos.
function migratePararCronometrosArquivados158() {
  let total = 0;
  db.get('demandas').value().forEach((d) => {
    if (!(d.archived || d.status === 'concluida')) return;
    const novoTimeTracking = pararCronometrosRodando(d.timeTracking);
    if (novoTimeTracking !== d.timeTracking) {
      db.get('demandas').find({ id: d.id }).assign({ timeTracking: novoTimeTracking }).write();
      total += 1;
    }
  });
  if (total > 0) {
    console.log(`[migratePararCronometrosArquivados158] ${total} demanda(s) já concluída(s)/arquivada(s) tinham cronômetro preso rodando -- parado(s) retroativamente.`);
  }
}

module.exports = { migratePararCronometrosArquivados158 };
