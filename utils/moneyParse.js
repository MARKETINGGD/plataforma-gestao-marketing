// 100ª rodada -- helper pra interpretar os valores em texto exatamente como
// vieram das planilhas que a Raquel colou no chat ("R$ 104,58", "US$ 25,06",
// "EUR 16,00", mas também célula vazia ou só o texto sem moeda). Nunca joga
// nada fora: o texto ORIGINAL sempre é preservado à parte (quem usa isso
// guarda o texto bruto num campo próprio, ex. `precoRaw`/`valorRaw`) --
// esta função só tenta extrair um número e a moeda, pra permitir soma/
// filtro/sincronização com o Budget; se não conseguir interpretar, devolve
// valor: null (nunca um número inventado).
function parseMoneyLabel(raw) {
  const text = String(raw || '').trim();
  if (!text) return { valor: null, moeda: null };
  let moeda = null;
  // Sinal de menos pode vir ANTES do prefixo de moeda (ex. "-R$ 104,58") --
  // aceita opcionalmente pra não perder a detecção da moeda nesse caso.
  if (/^-?\s*r\$/i.test(text)) moeda = 'BRL';
  else if (/^-?\s*us\$/i.test(text)) moeda = 'USD';
  else if (/^-?\s*eur\b/i.test(text)) moeda = 'EUR';
  // Remove o prefixo de moeda e qualquer coisa que não seja dígito, vírgula,
  // ponto ou sinal de menos.
  const numeric = text.replace(/^(r\$|us\$|eur)\s*/i, '').replace(/[^\d.,-]/g, '');
  if (!numeric) return { valor: null, moeda };
  // Formato BR: "1.234,56" -- ponto SEMPRE é separador de milhar (nunca
  // decimal), vírgula é que é decimal quando presente. Remove todos os
  // pontos primeiro -- independente de ter vírgula ou não -- e só depois
  // troca a vírgula (se houver) por ponto decimal. Sem isso, um valor
  // "fechado" sem vírgula (ex. "1.200") ficava 1000x menor, porque o ponto
  // de milhar sobrava e o Number() o lia como separador decimal.
  let normalized = numeric.replace(/\./g, '');
  if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }
  const n = Number(normalized);
  return { valor: Number.isFinite(n) ? n : null, moeda };
}

module.exports = { parseMoneyLabel };
