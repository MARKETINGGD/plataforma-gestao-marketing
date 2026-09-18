const db = require('../db');
const { nanoid } = require('./id');
const { ITENS_CONCORRENCIA_GHELPLUS_2026 } = require('./concorrenciaGhelplusData');

// 42ª rodada — importação única (roda automaticamente ao iniciar o servidor,
// mas só faz alguma coisa da primeira vez) da planilha "PRODUTOS GHELPLUS"
// que a Raquel mandou, comparando cada produto GhelPlus com o equivalente
// (quando existe) da Tramontina, Forminox e Fabrinox — pedido da Raquel:
// "em analise de concorrencia, coloque os dados dessa analise de
// concorrencia [...], deve ter tbm a opção de colocar varias marcas na
// analise, e não apenas 1 versus a outra".
//
// Produto GhelPlus sem NENHUM concorrente equivalente cadastrado na
// planilha (14 dos 52 itens) não vira análise — não tem o que comparar.
// Os demais viram uma análise por produto, com um `concorrentes[]` só com
// as marcas que realmente tinham produto equivalente na planilha.
const IMPORT_BATCH = 'concorrencia-ghelplus-tramontina-forminox-fabrinox-2026-v1';

function seedConcorrenciaGhelplusImport2026() {
  const already = db.get('concorrencia').filter({ importBatch: IMPORT_BATCH }).value();
  if (already.length > 0) {
    console.log(`[seedConcorrenciaGhelplusImport2026] Pulado: já existem ${already.length} análise(s) importada(s) desse lote.`);
    return;
  }
  const now = new Date().toISOString();
  let count = 0;
  ITENS_CONCORRENCIA_GHELPLUS_2026.forEach((it) => {
    const comProduto = it.concorrentes.filter((c) => c.produto);
    if (comProduto.length === 0) return;
    const concorrentesList = comProduto.map((c) => ({
      id: nanoid(),
      nome: c.marca,
      produto: c.produto,
      preco: c.preco,
      diferenciais: '',
      observacoes: c.observacoes || '',
      link: null
    }));
    const item = {
      id: nanoid(),
      brand: 'ghelplus',
      titulo: it.nossoProduto,
      data: '2026-09-18',
      concorrentes: concorrentesList,
      // campos soltos mantidos por compatibilidade com qualquer tela/relatório
      // antigo que ainda leia o 1º concorrente direto desses campos.
      concorrente: concorrentesList[0].nome,
      produto: concorrentesList[0].produto,
      preco: concorrentesList[0].preco,
      diferenciais: '',
      observacoes: concorrentesList[0].observacoes,
      link: null,
      nossoProduto: it.nossoProduto,
      nossoPreco: it.nossoPreco,
      nossoDiferenciais: '',
      nossasObservacoes: '',
      nossoLink: null,
      importBatch: IMPORT_BATCH,
      createdAt: now,
      createdBy: null,
      updatedAt: now,
      updatedBy: 'Importação automática'
    };
    db.get('concorrencia').push(item).write();
    count++;
  });
  console.log(`[seedConcorrenciaGhelplusImport2026] Importadas ${count} análises de concorrência (GhelPlus x Tramontina/Forminox/Fabrinox).`);
}

module.exports = { seedConcorrenciaGhelplusImport2026 };
