// 100ª rodada -- as planilhas de Pagamentos usam o nome do mês em português
// ("Abril", "Julho"...) em vez de um número -- esta tabela só serve pra
// conseguir casar um lançamento com mês/ano numérico quando for lançar
// automaticamente no Budget (que já usa number 1-12, ver routes/budget.js).
// O campo `mes` em texto continua sendo o valor de verdade mostrado na tela
// -- isto é só uma conversão auxiliar, nunca substitui o texto original.
const MES_LABEL_TO_NUM = {
  janeiro: 1, fevereiro: 2, março: 3, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12
};

function mesLabelToNum(label) {
  const key = String(label || '').trim().toLowerCase();
  return MES_LABEL_TO_NUM[key] || null;
}

module.exports = { MES_LABEL_TO_NUM, mesLabelToNum };
