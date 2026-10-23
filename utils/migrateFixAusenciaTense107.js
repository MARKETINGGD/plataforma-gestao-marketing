const db = require('../db');

// 107ª rodada, pedido literal da Raquel (interrupção no meio da rodada):
// "ajuste os avisos que já sairam para: Se ainda esta afastada, de ferias
// ou ainda n chegou a data, mantenha estará. Se já passou, ajuste para
// esteve."
//
// A 106ª rodada já corrigiu isso PRA FRENTE -- toda ausência nova, a
// partir dela, já nasce com o tempo certo (ver `jaAcabou()`/`acabou` em
// routes/ausencias.js: "estará"/"vai sair"/"vai chegar" quando a ausência
// ainda não acabou, "esteve"/"saiu"/"chegou" quando já acabou). Mas os
// comunicados que JÁ tinham sido enviados ANTES dessa correção existir
// ficaram com o texto errado pra sempre (sempre no futuro, mesmo quando a
// ausência cadastrada já tinha acabado -- ex.: lançar um período antigo
// só pra manter o histórico). Esta migração corrige RETROATIVAMENTE o
// TEXTO desses recados antigos, sem tocar em mais nenhum dado.
//
// Não existe (e nunca existiu) nenhum campo ligando um recado de volta à
// ausência que o gerou -- por isso a correção é feita por padrão de
// texto: reconhece as frases que usam tempo futuro ("estará"/"vai sair"/
// "vai chegar"), reconstrói a data final (ou única) embutida no próprio
// texto (o texto só grava dia/mês -- o ano é reconstruído a partir do
// `createdAt` do recado, com uma margem de +-183 dias pra cobrir período
// que atravessa a virada do ano) e só troca pro passado se essa data já
// tiver passado, na data de HOJE (quando a migração roda -- não na data
// em que o recado foi criado). Idempotente: só reconhece os marcadores de
// futuro -- um recado que já esteja no passado ("esteve"/"saiu"/
// "chegou"/"teve") nunca é tocado de novo, mesmo rodando de novo.

function reconstruirData(dia, mes, dataReferencia) {
  const anoBase = dataReferencia.getUTCFullYear();
  let data = new Date(Date.UTC(anoBase, mes - 1, dia));
  const diffDias = (data - dataReferencia) / (1000 * 60 * 60 * 24);
  if (diffDias < -183) data = new Date(Date.UTC(anoBase + 1, mes - 1, dia));
  else if (diffDias > 183) data = new Date(Date.UTC(anoBase - 1, mes - 1, dia));
  return data;
}

function jaPassou(dia, mes, createdAtDate) {
  const data = reconstruirData(dia, mes, createdAtDate);
  const hoje = new Date();
  hoje.setUTCHours(0, 0, 0, 0);
  return data < hoje;
}

// Período (férias/afastamento/viagem): compara contra a data FINAL do
// período (2º par dia/mês capturado). Dia único (saída/chegada fora do
// horário): compara contra a data única (1º par capturado).
const PADROES = [
  { re: /estará de férias de (\d{2})\/(\d{2}) a (\d{2})\/(\d{2})\./, tipo: 'periodo', de: 'estará', para: 'esteve' },
  { re: /estará afastado\(a\) de (\d{2})\/(\d{2}) a (\d{2})\/(\d{2})\./, tipo: 'periodo', de: 'estará', para: 'esteve' },
  { re: /estará em viagem a trabalho de (\d{2})\/(\d{2}) a (\d{2})\/(\d{2})\./, tipo: 'periodo', de: 'estará', para: 'esteve' },
  { re: /vai sair mais cedo \/ fora do horário no dia (\d{2})\/(\d{2})/, tipo: 'diaUnico', de: 'vai sair mais cedo / fora do horário', para: 'saiu mais cedo / fora do horário' },
  { re: /vai chegar mais tarde \/ fora do horário no dia (\d{2})\/(\d{2})/, tipo: 'diaUnico', de: 'vai chegar mais tarde / fora do horário', para: 'chegou mais tarde / fora do horário' },
  // Frase mais antiga ainda, de antes de existir o detalhe de horário na
  // "Saída fora do horário" -- defensiva, não é mais gerada por nenhum
  // código atual, mas pode existir em recados bem antigos.
  { re: /vai sair fora do horário no dia (\d{2})\/(\d{2})/, tipo: 'diaUnico', de: 'vai sair fora do horário', para: 'saiu fora do horário' },
];

function migrateFixAusenciaTense107() {
  const recados = db.get('recados').value().filter((r) => r.kind === 'ausencia_anunciada');
  let corrigidos = 0;

  recados.forEach((r) => {
    const texto = r.text || '';
    const createdAtDate = r.createdAt ? new Date(r.createdAt) : new Date();

    for (const padrao of PADROES) {
      const m = texto.match(padrao.re);
      if (!m) continue;
      const passou = padrao.tipo === 'periodo'
        ? jaPassou(Number(m[3]), Number(m[4]), createdAtDate)
        : jaPassou(Number(m[1]), Number(m[2]), createdAtDate);
      if (passou) {
        const novoTexto = texto.replace(padrao.de, padrao.para);
        if (novoTexto !== texto) {
          db.get('recados').find({ id: r.id }).assign({ text: novoTexto }).write();
          corrigidos += 1;
        }
      }
      // Combinou com um padrão (passou ou não) -- não tenta os outros.
      break;
    }
  });

  if (corrigidos > 0) {
    console.log(`[migrateFixAusenciaTense107] ${corrigidos} comunicado(s) de ausência já enviados tiveram o texto corrigido de futuro ("estará"/"vai sair"/"vai chegar") pra passado ("esteve"/"saiu"/"chegou"), porque a data já tinha passado.`);
  }
}

module.exports = { migrateFixAusenciaTense107 };
