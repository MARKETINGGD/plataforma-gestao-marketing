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
// GhelPlus"), o campo `dividirFluxo` (ver routes/pagamentos.js) decide a
// divisão: true = divide o valor em partes iguais entre as marcas; false
// (ou ausente) = cada marca recebe o valor CHEIO do pagamento, sem ratear
// -- é o próprio campo que a Raquel usa pra essa decisão na planilha.
function syncPagamentoParaBudget(pagamento, req) {
  if (!pagamento || pagamento.historicalImport || pagamento.budgetSynced) return [];
  if (!pagamento.valor) {
    console.warn(`Pagamento ${pagamento.id} marcado como pago mas sem valor numérico reconhecido — não sincronizado ao Budget.`);
    return [];
  }
  const marcasValidas = (pagamento.marcas || []).filter((m) => m === 'ghelplus' || m === 'debacco');
  if (marcasValidas.length === 0) return [];
  const mesNum = mesLabelToNum(pagamento.mes);
  if (!mesNum) return [];
  const ano = pagamento.ano || new Date().getFullYear();
  const valorPorMarca = pagamento.dividirFluxo === true
    ? Number(pagamento.valor) / marcasValidas.length
    : Number(pagamento.valor);
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

// Correção (110ª rodada): desmarcar "Pago" de um lançamento que já tinha
// sido sincronizado precisa desfazer o que foi criado no Budget -- senão o
// Budget fica com um lançamento "fantasma" que não existe mais do lado de
// Pagamentos. Localiza pelos ids guardados em `budgetEntryIds` e remove
// cada um, do mesmo jeito que routes/budget.js remove um lançamento normal
// (`db.get('budgetEntries').remove({ id }).write()`).
function removeBudgetEntriesForPagamento(pagamento, req) {
  const ids = (pagamento && pagamento.budgetEntryIds) || [];
  if (ids.length === 0) return [];
  const removedIds = [];
  ids.forEach((id) => {
    const entry = db.get('budgetEntries').find({ id }).value();
    if (!entry) return;
    db.get('budgetEntries').remove({ id }).write();
    removedIds.push(id);
  });
  if (removedIds.length > 0) {
    logAudit({
      user: (req && req.user) || { id: null, name: 'Sistema (sincronização automática Pagamentos → Budget)' },
      entityType: 'pagamento',
      entityId: pagamento.id,
      entityLabel: pagamento.fornecedor || '',
      action: 'update',
      details: `Lançamento(s) de Budget desfeito(s) (${removedIds.length}) ao desmarcar "Pago".`
    });
  }
  return removedIds;
}

// Correção (110ª rodada): editar o `valor` de um pagamento já sincronizado
// precisa atualizar o(s) lançamento(s) já criados no Budget, senão eles
// ficam com o valor antigo pra sempre. Abordagem escolhida (mais segura
// dado que a estrutura gravada em `budgetEntryIds` é só uma lista de ids,
// sem guardar a fração/rateio de cada um separadamente):
//   - 1 único lançamento vinculado -> atualiza ele direto pro valor novo
//     (não tem rateio pra preservar -- é o caso mais comum: pagamento com
//     uma marca só, ou dividirFluxo:false com 1 marca válida).
//   - vários lançamentos vinculados -> aplica a MESMA proporção que cada um
//     já tinha em relação ao valor antigo do pagamento (ratio = valorNovo /
//     valorAntigo, aplicado a cada `realizado` existente), preservando o
//     rateio que já estava em uso (igual ou cheio, não importa) sem
//     precisar recalcular do zero.
//   - se o valor antigo for inválido (0/null) e houver mais de 1
//     lançamento, não dá pra inferir a proporção com segurança -- avisa e
//     não mexe nos lançamentos (evita piorar o dado existente).
function updateBudgetEntriesValorPagamento(pagamento, valorAntigo, valorNovo, req) {
  const ids = (pagamento && pagamento.budgetEntryIds) || [];
  if (ids.length === 0) return [];
  const novo = Number(valorNovo);
  if (!Number.isFinite(novo)) return [];
  const now = new Date().toISOString();
  const updatedIds = [];
  if (ids.length === 1) {
    const entry = db.get('budgetEntries').find({ id: ids[0] }).value();
    if (entry) {
      db.get('budgetEntries').find({ id: ids[0] }).assign({ realizado: novo, updatedAt: now }).write();
      updatedIds.push(ids[0]);
    }
  } else if (Number.isFinite(Number(valorAntigo)) && Number(valorAntigo) !== 0) {
    const ratio = novo / Number(valorAntigo);
    ids.forEach((id) => {
      const entry = db.get('budgetEntries').find({ id }).value();
      if (!entry) return;
      const novoRealizado = Number(entry.realizado || 0) * ratio;
      db.get('budgetEntries').find({ id }).assign({ realizado: novoRealizado, updatedAt: now }).write();
      updatedIds.push(id);
    });
  } else {
    console.warn(`Pagamento ${pagamento.id}: valor editado mas não foi possível recalcular proporcionalmente os ${ids.length} lançamento(s) de Budget vinculados (valor antigo inválido) -- ficaram com o valor antigo.`);
    return [];
  }
  if (updatedIds.length > 0) {
    logAudit({
      user: (req && req.user) || { id: null, name: 'Sistema (sincronização automática Pagamentos → Budget)' },
      entityType: 'pagamento',
      entityId: pagamento.id,
      entityLabel: pagamento.fornecedor || '',
      action: 'update',
      details: `Valor atualizado no Budget (${updatedIds.length} lançamento(s)) após edição do valor do pagamento.`
    });
  }
  return updatedIds;
}

module.exports = { syncPagamentoParaBudget, removeBudgetEntriesForPagamento, updateBudgetEntriesValorPagamento };
