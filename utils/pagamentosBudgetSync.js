const db = require('../db');
const { nanoid } = require('./id');
const { logAudit } = require('./audit');
const { mesLabelToNum } = require('./mesLabel');

// 100ª rodada, pedido explícito da Raquel: "cada lançamento concluido em
// pagamento, deve automaticamente se comunicar com budget e lançar lá na
// planilha de budget, de acordo com o mês, marca e o fluxo." + "o que ja
// esta na planilha, voce n deve colocar no budget... essa regra de
// comunicação só deve valer a partir de hoje, das informações que eu
// adicionar a partir de hoje" (22/10/2026).
//
// Interpretação adotada (documentada aqui pra confirmar com a Raquel,
// mesmo espírito de outras decisões de leitura registradas nesta base):
// "lançamento concluído" = campo `pago` virou true (é exatamente o nome
// da coluna "Pago" que já existia na planilha dela). Só dispara:
//   1. pra lançamento NÃO histórico (`historicalImport: false` -- todo
//      lançamento importado da planilha nasce com essa flag true e NUNCA
//      entra aqui, não importa quantas vezes `pago` for editado depois);
//   2. uma única vez por lançamento (`budgetSynced` vira true depois do
//      1º lançamento no Budget -- editar outros campos depois, ou
//      desmarcar e marcar "Pago" de novo, não duplica o lançamento no
//      Budget);
//   3. só pra marca(s) que o Budget reconhece (ghelplus/debacco -- a
//      planilha de Pagamentos também cita "Duranox" e outras entidades
//      que não têm aba de Budget na Plataforma; essas ficam de fora do
//      lançamento automático, mas o Pagamento em si não é bloqueado por
//      isso);
//   4. só quando dá pra reconhecer o mês (nome do mês em português -- ver
//      utils/mesLabel.js) e existe um valor numérico.
// Quando o lançamento cita mais de uma marca reconhecida (ex. "De Bacco,
// GhelPlus"), o valor é dividido em partes iguais entre as marcas -- a
// planilha não guarda quanto cabe a cada marca separadamente, só o total
// + a lista de marcas, então dividir igualmente é a leitura mais direta
// de "Dividir Fluxo".
function syncPagamentoParaBudget(pagamento, req) {
  if (!pagamento || pagamento.historicalImport || pagamento.budgetSynced) return [];
  if (!pagamento.valor) return [];
  const marcasValidas = (pagamento.marcas || []).filter((m) => m === 'ghelplus' || m === 'debacco');
  if (marcasValidas.length === 0) return [];
  const mesNum = mesLabelToNum(pagamento.mes);
  if (!mesNum) return [];
  const ano = pagamento.ano || new Date().getFullYear();
  const valorPorMarca = Number(pagamento.valor) / marcasValidas.length;
  const ABA_LABEL = { cartao: 'Cartão', mensal: 'Mensal', extras: 'Extras' };
  const now = new Date().toISOString();
  const createdIds = [];
  marcasValidas.forEach((brand) => {
    const entry = {
      id: nanoid(),
      brand,
      category: pagamento.fluxoGerencial || `Pagamentos · ${ABA_LABEL[pagamento.aba] || pagamento.aba}`,
      year: ano,
      month: mesNum,
      planejado: null,
      realizado: valorPorMarca,
      notes: `Lançado automaticamente a partir de Pagamentos (${ABA_LABEL[pagamento.aba] || pagamento.aba}) — ${pagamento.fornecedor || ''}`.trim(),
      fornecedor: pagamento.fornecedor || '',
      tituloCompra: pagamento.fornecedor || '',
      quantidade: null,
      createdAt: now,
      updatedAt: now,
      updatedBy: (req && req.user && req.user.name) || 'Sistema (sincronização automática Pagamentos → Budget)',
      updatedById: (req && req.user && req.user.id) || null,
      sourcePagamentoId: pagamento.id
    };
    db.get('budgetEntries').push(entry).write();
    createdIds.push(entry.id);
  });
  if (createdIds.length > 0) {
    db.get('pagamentos').find({ id: pagamento.id }).assign({ budgetSynced: true, budgetEntryIds: createdIds, updatedAt: now }).write();
    logAudit({
      user: (req && req.user) || { id: null, name: 'Sistema (sincronização automática Pagamentos → Budget)' },
      entityType: 'pagamento',
      entityId: pagamento.id,
      entityLabel: pagamento.fornecedor || '',
      action: 'update',
      details: `Lançado automaticamente no Budget (${marcasValidas.join(', ')}), mês ${mesNum}/${ano}.`
    });
  }
  return createdIds;
}

module.exports = { syncPagamentoParaBudget };
