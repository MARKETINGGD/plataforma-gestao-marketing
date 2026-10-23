// Teste de integração das 2 migrações novas da 107ª rodada:
//  1. utils/migrateConvertJornadaIncompleta107.js -- converte qualquer
//     ausência antiga que por acaso exista com o tipo extinto
//     `jornada_incompleta` pro novo `saida`, preservando os horários.
//  2. utils/migrateFixAusenciaTense107.js -- pedido literal da Raquel,
//     no meio da 107ª rodada: "ajuste os avisos que já sairam para: Se
//     ainda esta afastada, de ferias ou ainda n chegou a data, mantenha
//     estará. Se já passou, ajuste para esteve." -- corrige o TEXTO de
//     comunicados de ausência já enviados, de futuro pra passado, só
//     quando a data já passou.
//
// Semeia DIRETO no banco (antes de subir o server, igual
// migrateReconcileSiblingDemandas99.test.js) ausências/recados já
// "antigos" como ficariam antes das correções existirem, sobe o servidor
// (que roda as 2 migrações sozinho, igual em produção) e confere o
// resultado.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-migrate-tense-jornada-107';
process.env.PORT = '4381';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4381';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-migrate-tense-jornada-107-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

function addDays(base, n) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
function fmtDDMM(d) {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

async function run() {
  let failures = 0;
  function check(label, cond) {
    console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
    if (!cond) failures++;
  }

  const db = require('../db');
  const agora = new Date();

  // ---------- 1) Ausência antiga com o tipo extinto `jornada_incompleta` ----------
  const ausenciaJornadaAntiga = {
    id: 'migrate107-aus-jornada', userId: 'migrate107-u1', userName: 'SeedJornada107 Pessoa',
    tipo: 'jornada_incompleta', dataInicio: '2026-09-01', dataFim: '2026-09-01',
    horaChegada: '09:15', horaSaida: '11:00', horaRetorno: '13:45',
    observacoes: '', createdAt: agora.toISOString(), createdBy: 'migrate107-admin', createdByName: 'Admin'
  };
  db.get('ausencias').push(ausenciaJornadaAntiga).write();

  // ---------- 2) Recados de ausência "antigos" (de antes do estará/esteve existir) ----------

  // 2a) Férias já ACABADAS (25 a 20 dias atrás) -> precisa virar "esteve"
  const feriasIni = addDays(agora, -25);
  const feriasFim = addDays(agora, -20);
  const recFeriasPassada = {
    id: 'migrate107-rec-ferias-passada', text: `🏖️ SeedFeriasPassada107 estará de férias de ${fmtDDMM(feriasIni)} a ${fmtDDMM(feriasFim)}.`,
    color: '#6D63E0', targetUserIds: ['migrate107-u1'], readBy: [], archived: false,
    createdAt: addDays(agora, -25).toISOString(), createdBy: null, createdByName: 'Papoi', system: true, kind: 'ausencia_anunciada'
  };

  // 2b) Afastamento ainda EM ANDAMENTO (começou, não acabou) -> mantém "estará"
  const afastIni = addDays(agora, -3);
  const afastFim = addDays(agora, 10);
  const recAfastamentoAndamento = {
    id: 'migrate107-rec-afastamento-andamento', text: `😷 SeedAfastamentoAndamento107 estará afastado(a) de ${fmtDDMM(afastIni)} a ${fmtDDMM(afastFim)}.`,
    color: '#6D63E0', targetUserIds: ['migrate107-u1'], readBy: [], archived: false,
    createdAt: addDays(agora, -3).toISOString(), createdBy: null, createdByName: 'Papoi', system: true, kind: 'ausencia_anunciada'
  };

  // 2c) Viagem FUTURA (nem começou) -> mantém "estará"
  const viagemIni = addDays(agora, 30);
  const viagemFim = addDays(agora, 35);
  const recViagemFutura = {
    id: 'migrate107-rec-viagem-futura', text: `✈️ SeedViagemFutura107 estará em viagem a trabalho de ${fmtDDMM(viagemIni)} a ${fmtDDMM(viagemFim)}.`,
    color: '#6D63E0', targetUserIds: ['migrate107-u1'], readBy: [], archived: false,
    createdAt: agora.toISOString(), createdBy: null, createdByName: 'Papoi', system: true, kind: 'ausencia_anunciada'
  };

  // 2d) Chegada fora do horário, já no PASSADO -> precisa virar "chegou"
  const chegadaDia = addDays(agora, -10);
  const recChegadaPassada = {
    id: 'migrate107-rec-chegada-passada', text: `🕐 SeedChegadaPassada107 vai chegar mais tarde / fora do horário no dia ${fmtDDMM(chegadaDia)} (chegou às 08:00).`,
    color: '#6D63E0', targetUserIds: ['migrate107-u1'], readBy: [], archived: false,
    createdAt: addDays(agora, -10).toISOString(), createdBy: null, createdByName: 'Papoi', system: true, kind: 'ausencia_anunciada'
  };

  // 2e) Saída fora do horário, frase ANTIGA (sem detalhe de horário, de
  // antes da 106ª/107ª existir), já no PASSADO -> precisa virar "saiu"
  const saidaAntigaDia = addDays(agora, -15);
  const recSaidaAntigaPassada = {
    id: 'migrate107-rec-saida-antiga-passada', text: `🕐 SeedSaidaAntigaPassada107 vai sair fora do horário no dia ${fmtDDMM(saidaAntigaDia)}.`,
    color: '#6D63E0', targetUserIds: ['migrate107-u1'], readBy: [], archived: false,
    createdAt: addDays(agora, -15).toISOString(), createdBy: null, createdByName: 'Papoi', system: true, kind: 'ausencia_anunciada'
  };

  // 2f) Saída fora do horário, frase NOVA (107ª, com detalhe de horário),
  // ainda no FUTURO -> mantém "vai sair"
  const saidaFuturaDia = addDays(agora, 7);
  const recSaidaFutura = {
    id: 'migrate107-rec-saida-futura', text: `🕐 SeedSaidaFutura107 vai sair mais cedo / fora do horário no dia ${fmtDDMM(saidaFuturaDia)} (saiu às 15:00).`,
    color: '#6D63E0', targetUserIds: ['migrate107-u1'], readBy: [], archived: false,
    createdAt: agora.toISOString(), createdBy: null, createdByName: 'Papoi', system: true, kind: 'ausencia_anunciada'
  };

  [recFeriasPassada, recAfastamentoAndamento, recViagemFutura, recChegadaPassada, recSaidaAntigaPassada, recSaidaFutura]
    .forEach((r) => db.get('recados').push(r).write());

  require('../server'); // as 2 migrações rodam sozinhas aqui, igual no boot de produção
  await new Promise((r) => setTimeout(r, 1000));

  const db2 = require('../db');

  // ---------- Verifica a conversão jornada_incompleta -> saida ----------
  const ausenciaDepois = db2.get('ausencias').find({ id: 'migrate107-aus-jornada' }).value();
  check('ausência antiga do tipo extinto foi convertida pra "saida"', !!ausenciaDepois && ausenciaDepois.tipo === 'saida');
  check('horários (chegada/saída/retorno) foram preservados na conversão', ausenciaDepois.horaChegada === '09:15' && ausenciaDepois.horaSaida === '11:00' && ausenciaDepois.horaRetorno === '13:45');
  const auditConversao = db2.get('auditLog').value().some((e) => e.entityId === 'migrate107-aus-jornada' && (e.details || '').includes('Jornada Incompleta'));
  check('conversão ficou registrada no Histórico', auditConversao);

  // ---------- Verifica a correção de tempo (estará/esteve) ----------
  const textoFerias = db2.get('recados').find({ id: 'migrate107-rec-ferias-passada' }).value().text;
  check('férias já acabadas: "estará" foi corrigido pra "esteve"', textoFerias.includes('esteve de férias') && !textoFerias.includes('estará'));

  const textoAfastamento = db2.get('recados').find({ id: 'migrate107-rec-afastamento-andamento' }).value().text;
  check('afastamento ainda em andamento: "estará" NÃO foi tocado', textoAfastamento.includes('estará afastado(a)'));

  const textoViagem = db2.get('recados').find({ id: 'migrate107-rec-viagem-futura' }).value().text;
  check('viagem futura: "estará" NÃO foi tocado', textoViagem.includes('estará em viagem'));

  const textoChegada = db2.get('recados').find({ id: 'migrate107-rec-chegada-passada' }).value().text;
  check('chegada fora do horário já passada: "vai chegar" foi corrigido pra "chegou"', textoChegada.includes('chegou mais tarde / fora do horário') && !textoChegada.includes('vai chegar'));

  const textoSaidaAntiga = db2.get('recados').find({ id: 'migrate107-rec-saida-antiga-passada' }).value().text;
  check('saída fora do horário (frase antiga) já passada: "vai sair" foi corrigido pra "saiu"', textoSaidaAntiga.includes('saiu fora do horário') && !textoSaidaAntiga.includes('vai sair'));

  const textoSaidaFutura = db2.get('recados').find({ id: 'migrate107-rec-saida-futura' }).value().text;
  check('saída fora do horário futura: "vai sair" NÃO foi tocado', textoSaidaFutura.includes('vai sair mais cedo / fora do horário'));

  // ---------- Idempotência: rodar as 2 migrações de novo não muda nada e não duplica log ----------
  const auditCountAntes = db2.get('auditLog').value().filter((e) => e.entityId === 'migrate107-aus-jornada').length;
  require('../utils/migrateConvertJornadaIncompleta107').migrateConvertJornadaIncompleta107();
  require('../utils/migrateFixAusenciaTense107').migrateFixAusenciaTense107();
  const auditCountDepois = db2.get('auditLog').value().filter((e) => e.entityId === 'migrate107-aus-jornada').length;
  check('migração de conversão é idempotente -- rodar de novo não grava nada extra', auditCountDepois === auditCountAntes);
  const textoFeriasDepoisDeNovo = db2.get('recados').find({ id: 'migrate107-rec-ferias-passada' }).value().text;
  check('migração de tempo é idempotente -- rodar de novo não muda o texto já corrigido', textoFeriasDepoisDeNovo === textoFerias);

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(() => {
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(process.exitCode);
});
