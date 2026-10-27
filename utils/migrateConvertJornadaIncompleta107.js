const db = require('../db');
const { logAudit } = require('./audit');

// 107ª rodada: o tipo `jornada_incompleta`, criado na 106ª rodada e
// removido ainda na própria 107ª (fundido em "Saída fora do horário",
// tipo `saida` -- ver routes/ausencias.js), nunca chegou a ser publicado
// de verdade (a correção da Raquel veio antes do deploy). Mesmo assim --
// e pela regra permanente desta base de NUNCA perder dado nenhum -- esta
// migração converte qualquer registro antigo que por acaso já exista com
// `tipo: 'jornada_incompleta'` pro novo `tipo: 'saida'`, preservando os 3
// campos de horário (horaChegada/horaSaida/horaRetorno), que já usavam os
// MESMOS nomes de campo nos dois tipos -- não precisa transformar nada
// além do próprio `tipo`.
//
// Idempotente: só existe algo a fazer enquanto sobrar algum registro com
// o tipo extinto; depois da primeira execução (ou se nunca existiu
// nenhum), não encontra nada e não loga nada.
function migrateConvertJornadaIncompleta107() {
  const antigos = db.get('ausencias').filter({ tipo: 'jornada_incompleta' }).value();
  if (antigos.length === 0) return;

  antigos.forEach((a) => {
    db.get('ausencias').find({ id: a.id }).assign({ tipo: 'saida' }).write();
    logAudit({
      user: { id: 'system', name: 'Sistema (manutenção 107ª rodada)', username: 'sistema' },
      entityType: 'ausencia',
      entityId: a.id,
      entityLabel: `Saída fora do horário - ${a.userName || a.userId}`,
      action: 'update',
      details: 'Convertida automaticamente de "Jornada Incompleta" (tipo extinto na 107ª rodada, fundido em "Saída fora do horário") -- horário de chegada/saída/retorno já cadastrado foi preservado, nenhum dado perdido.'
    });
  });

  console.log(`[migrateConvertJornadaIncompleta107] ${antigos.length} ausência(s) do tipo extinto "Jornada Incompleta" foram convertidas pra "Saída fora do horário", preservando os horários já cadastrados.`);
}

module.exports = { migrateConvertJornadaIncompleta107 };
