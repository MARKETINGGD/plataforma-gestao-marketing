const db = require('../db');
const { logAudit } = require('./audit');

// 158ª rodada, item #130 (pedido da Raquel: "agora revise cada lançamento
// do budget da GhelPlus... compare com essa planilha do drive" +
// "o budget GhelPlus do drive, deve ficar exatamente igual aos
// lançamentos do papoi") -- depois de uma auditoria linha a linha (todos
// os 490 lançamentos de budget da GhelPlus vs as abas PLANEJADO
// 2026/REALIZADO 2026 da planilha "2026- BUDGET GHELPLUS.xlsx" do Drive,
// ver RELATORIO-AUDITORIA-BUDGET-GHELPLUS.md), restaram só 3 ajustes
// pontuais -- todos confirmados pela Raquel depois do relatório (os
// outros ~17 "achados" da auditoria eram: valores em vermelho na aba
// Realizado da planilha -- que ela pediu pra ignorar, pois não foram
// realmente gastos --, ou lançamentos onde o Papoi já estava mais
// atualizado que a planilha -- que ela pediu pra MANTER como estão no
// Papoi, sem mexer):
//
// 1) "Outros" (fluxo Expositores Padrão - 2.5.2.14, Setembro/2026):
//    planejado no Papoi estava zerado, mas a planilha tem R$80.000.
//    Ajusta só o PLANEJADO -- a Raquel confirmou explicitamente pra não
//    lançar isso em realizado também (esse R$80.000 aparece em vermelho
//    na aba Realizado da planilha nesse mês, ou seja nunca foi de fato
//    gasto).
// 2) e 3) 2 lançamentos duplicados -- uma linha com dado de verdade +
//    uma linha-fantasma 100% vazia (sem planejado, sem realizado, sem
//    fornecedor), sobre a mesma linha da planilha (Sacolas Kraft -
//    Brindes - Outubro/2026, e Sal - Brindes - Julho/2026) -- parecem ter
//    sido criadas sem querer ao editar inline na planilha pivotada do
//    Budget (Delete/Backspace zera os 2 campos de um lançamento sem
//    apagar o registro, daí ficou um registro vazio do lado do que já
//    tinha dado real). Raquel confirmou apagar só a linha vazia.
//
// Todos os outros lançamentos de realizado divergentes (9 casos onde o
// Papoi já tinha valor e a planilha estava em branco, e 2 onde o Papoi
// tinha um valor diferente do da planilha) foram EXPLICITAMENTE
// confirmados pela Raquel como "lançado correto" no Papoi -- por isso
// esta migração não mexe em nenhum outro campo de `realizado`.
//
// Idempotente: cada um dos 3 ajustes confere o estado atual antes de
// aplicar (e confere id + categoria/ano/mês/título juntos, não só o id,
// por segurança) -- rodar de novo não faz nada se já estiver certo.
function migrateBudgetGhelplusReconciliacao130() {
  let planejadoAjustado = false;
  let duplicatasApagadas = 0;

  // 1) Ajuste de planejado do "Outros" (Expositores Padrão, Set/2026).
  const outros = db.get('budgetEntries').find({ id: 'rnfpYbxrVzQuOLbh7Kgn7' }).value();
  if (
    outros &&
    outros.brand === 'ghelplus' &&
    outros.category === 'Expositores Padrão - 2.5.2.14' &&
    outros.year === 2026 &&
    outros.month === 9 &&
    outros.tituloCompra === 'Outros' &&
    outros.planejado !== 80000
  ) {
    db.get('budgetEntries').find({ id: outros.id }).assign({
      planejado: 80000,
      updatedAt: new Date().toISOString(),
      updatedBy: 'Migração automática (conferência planilha Drive)'
    }).write();
    planejadoAjustado = true;
  }

  // 2) e 3) Remove só as 2 linhas-fantasma (nunca a linha que tem dado
  // real do lado) -- confere categoria/ano/mês/título/marca iguais e os 2
  // campos de valor (planejado E realizado) vazios antes de apagar (o
  // fornecedor pode ter ficado preenchido na linha fantasma também, por
  // isso não entra nessa checagem -- o que importa é não ter nenhum valor
  // lançado).
  const duplicatasParaChecar = [
    { id: 'l4Xs5XxLorSCKHiLPAiTL', category: 'Brindes - 2.5.2.8', year: 2026, month: 10, tituloCompra: 'Sacolas Kraft' },
    { id: 'KtKlDzU2f77SeLhhJutyH', category: 'Brindes - 2.5.2.8', year: 2026, month: 7, tituloCompra: 'Sal' }
  ];
  duplicatasParaChecar.forEach((alvo) => {
    const e = db.get('budgetEntries').find({ id: alvo.id }).value();
    const vazio = e &&
      e.brand === 'ghelplus' &&
      e.category === alvo.category &&
      e.year === alvo.year &&
      e.month === alvo.month &&
      e.tituloCompra === alvo.tituloCompra &&
      (e.planejado === null || e.planejado === undefined) &&
      (e.realizado === null || e.realizado === undefined);
    if (vazio) {
      db.get('budgetEntries').remove({ id: alvo.id }).write();
      duplicatasApagadas += 1;
    }
  });

  if (planejadoAjustado || duplicatasApagadas > 0) {
    logAudit({
      user: null, entityType: 'budgetReconciliacao', entityId: 'ghelplus-drive-2026-158-130',
      entityLabel: 'Conferência Budget GhelPlus x planilha do Drive', action: 'fix', meta: {},
      details: `Ajustes confirmados pela Raquel após auditoria: `
        + `${planejadoAjustado ? '1 planejado corrigido (Outros / Expositores Padrão / Set-2026: R$0 -> R$80.000)' : '0 planejado corrigido'}, `
        + `${duplicatasApagadas} lançamento(s) duplicado(s) vazio(s) removido(s).`
    });
    console.log(`[migrateBudgetGhelplusReconciliacao130] planejado ajustado: ${planejadoAjustado}, duplicatas vazias removidas: ${duplicatasApagadas}.`);
  }
}

module.exports = { migrateBudgetGhelplusReconciliacao130 };
