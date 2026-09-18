const db = require('../db');
const { nanoid } = require('./id');

// 42ª rodada — pedido da Raquel: "em analise de concorrencia [...] deve ter
// tbm a opção de colocar varias marcas na analise, e não apenas 1 versus a
// outra". A análise de concorrência ganhou um `concorrentes[]` (lista, 1 ou
// mais) no lugar dos campos soltos de um único concorrente
// (concorrente/produto/preco/diferenciais/observacoes/link).
//
// Registro criado antes desta rodada só tem os campos soltos — essa
// migração dá um `concorrentes[]` retroativo com esse único concorrente
// dentro, pra tela nova conseguir renderizar registro antigo sem precisar
// de nenhum "if" espalhado pelo front. Os campos soltos continuam sendo
// gravados/atualizados também (rota `routes/produtos.js` mantém os dois em
// sincronia com o 1º concorrente da lista), então nada que já dependia
// deles quebra.
function migrateConcorrenciaMultiMarca() {
  const items = db.get('concorrencia').filter((it) => !Array.isArray(it.concorrentes)).value();
  if (items.length === 0) return;
  items.forEach((it) => {
    const concorrentes = [{
      id: nanoid(),
      nome: it.concorrente || '',
      produto: it.produto || '',
      preco: it.preco === undefined ? null : it.preco,
      diferenciais: it.diferenciais || '',
      observacoes: it.observacoes || '',
      link: it.link || null
    }];
    db.get('concorrencia').find({ id: it.id }).assign({ concorrentes }).write();
  });
  console.log(`[migrateConcorrenciaMultiMarca] ${items.length} análise(s) de concorrência migrada(s) pra concorrentes[].`);
}

module.exports = { migrateConcorrenciaMultiMarca };
