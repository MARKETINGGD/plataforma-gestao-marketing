const fs = require('fs');
const path = require('path');
const db = require('../db');
const { logAudit } = require('./audit');
const migration = require('./acoesSazonaisHistoricoMigrationData129.json');

// Pasta com os 20 arquivos físicos (PDF/Excel) extraídos do volume Railway
// do app separado, com o MESMO nome (hex aleatório) que já está gravado em
// cada anexo das ações/showrooms acima -- copiados 1x só pra dentro de
// data/uploads/acoes-sazonais (mesma pasta que a rota de upload nativa usa),
// nunca sobrescrevendo um arquivo que já exista lá com esse nome.
const attachmentsBundleDir = path.join(__dirname, 'acoesSazonaisHistoricoAttachments129');
const acoesUploadsDir = path.join(__dirname, '..', 'data', 'uploads', 'acoes-sazonais');

function copiarAnexosHistoricos() {
  if (!fs.existsSync(attachmentsBundleDir)) {
    console.log('[migrateAcoesSazonaisHistorico129] Pasta de anexos históricos não encontrada, pulando cópia de arquivos.');
    return 0;
  }
  if (!fs.existsSync(acoesUploadsDir)) fs.mkdirSync(acoesUploadsDir, { recursive: true });
  let copiados = 0;
  fs.readdirSync(attachmentsBundleDir).forEach((filename) => {
    const origem = path.join(attachmentsBundleDir, filename);
    const destino = path.join(acoesUploadsDir, filename);
    if (fs.existsSync(destino)) return; // nunca sobrescreve
    fs.copyFileSync(origem, destino);
    copiados += 1;
  });
  return copiados;
}

// 158ª rodada, item #129 (pedido da Raquel: "eu preciso que vc migre ao
// papoi, tudo que ja estava cadastrado nas ações sazonais" + "quero pegar
// os arquivos anexados tbm") -- importação ÚNICA (idempotente, mesmo
// padrão de utils/seedTrafegoPagoMigration156.js) dos dados reais que
// ainda só existiam no volume persistente do Railway do app separado
// (dashboard-acoes-sazonais), de antes do módulo nativo (#124) existir.
//
// Os dados vieram de um `railway ssh "cat /app/data/db.json"` feito pela
// própria Raquel (nunca com login/senha da Papoi) -- exportado via
// PowerShell no Windows, o que corrompeu os acentos (dupla codificação
// cp850->UTF-8); já revertido antes de congelar
// acoesSazonaisHistoricoMigrationData129.json (todo o texto passou por
// `buffer.encode('cp850').decode('utf-8')`, validado contra várias
// amostras conhecidas antes de aplicar no arquivo inteiro).
//
// Ações (91) e Expositores Especiais/Showrooms (20): o schema do app
// separado (routes/actions.js e routes/showrooms.js de lá) é IDÊNTICO ao
// nativo (routes/acoesSazonais.js aqui, mesma sanitizeAction/
// sanitizeShowroom/listas de validação) -- confirmado lendo os dois lados
// linha a linha nesta mesma rodada -- por isso os registros são copiados
// como vieram, sem remapear nenhum campo.
//
// budgetSyncEligible: NUNCA forçado -- fica exatamente como veio no
// export (true só em 2 das 91 ações, as que já tinham sido criadas no app
// separado DEPOIS da 113ª/114ª rodada de lá, quando a sincronia automática
// com o Budget passou a existir e de fato funcionou via
// utils/plataformaSync.js -> POST /api/integrations/acoes-sazonais/sync;
// as outras 89 nunca tiveram essa marcação, exatamente a regra pedida pela
// Raquel desde sempre: "as açoes que ja estão cadastradas, não devem
// aparecer dnetro do budget, pq ja fiz isso manualmente"). Esta migração
// NUNCA chama syncActionToBudget() -- só grava direto na coleção -- então
// nenhuma ação, elegível ou não, cria/edita nada em `budgetEntries` nesta
// importação; o fluxo normal de sincronia só volta a valer se/quando a
// Raquel editar uma dessas ações já migradas pela tela, dali pra frente
// (aí sim, pra uma das 2 ações elegíveis, atualiza o lançamento que já
// existe em budgetEntries com esse sourceId -- sem duplicar).
//
// Orçamento anual por bucket (17): mesmo schema exato (VALID_BUCKETS
// idêntico nos dois lados, sem chave legada aqui). Fluxos do Budget
// (FLUXOS_GHELPLUS/FLUXOS_DEBACCO, routes/budget.js) conferidos contra a
// cópia manual que o app separado mantinha (routes/actions.js de lá,
// BUDGET_FLUXOS_BY_BRAND) -- IDÊNTICOS, nenhum fluxo dessincronizado.
//
// Catálogo de produtos: ao contrário de Ações/Showrooms/Budgets (coleções
// que nascem vazias), `acoesSazonaisProducts` já tem os 181 produtos do
// seed original (utils/acoesSazonaisProductCatalogSeed.js, rodada #124)
// quando esta migração roda. Por isso o catálogo exportado (202 produtos)
// NÃO é inserido em bloco por importBatch -- é deduplicado em tempo de
// execução contra o que já estiver na coleção, exatamente pela mesma
// chave (marca + nome normalizado) que a própria rota POST /products usa
// -- assim cobre tanto o catálogo recém-nascido quanto qualquer produto
// que a Raquel já tenha cadastrado manualmente nesse meio tempo, sem
// nunca duplicar. Conferido nesta rodada: dos 202 exportados, 181 já
// batem 1:1 com o seed (mesma marca+nome) e 21 são genuinamente novos
// (todos GhelPlus).
//
// Anexos (arquivo em PDF/Excel/Word): os arquivos físicos (extraídos do
// volume Railway do app separado, pasta data/uploads de lá) são copiados
// à parte, pelo nome ORIGINAL (hex aleatório, sem risco de colisão com os
// uploads nativos), pra dentro de data/uploads/acoes-sazonais -- ver
// utils/acoesSazonaisHistoricoAttachments129/ (pasta trazida junto desta
// mesma mudança) e o passo de cópia em server.js, logo depois desta
// chamada. As referências dentro de cada ação/showroom (permutaArquivo,
// documentoArquivo, arquivoProposta etc.) já apontam pro nome certo --
// nenhum campo precisou ser reescrito.
//
// auditLog (841 entradas) e usuários (8) do app separado NÃO são
// migrados: login/permissão já são unificados na Papoi desde a #124, e o
// histórico de auditoria aqui conta como "secundário" (não é dado de
// cadastro em si) -- fica só no export congelado, caso precise consultar
// depois.
function dedupKey(brand, nome) {
  return brand + '|' + String(nome || '').trim().toLowerCase();
}

function migrateAcoesSazonaisHistorico129() {
  const jaRodou = db.get('acoesSazonaisActions').filter({ importBatch: migration.importBatch }).value();
  if (jaRodou.length > 0) {
    console.log(`[migrateAcoesSazonaisHistorico129] Pulado: já existem ${jaRodou.length} ação(ões) importada(s) desse lote.`);
    return;
  }

  db.get('acoesSazonaisActions').push(...migration.actions).write();
  db.get('acoesSazonaisShowrooms').push(...migration.showrooms).write();
  db.get('acoesSazonaisBudgets').push(...migration.budgets).write();

  const arquivosCopiados = copiarAnexosHistoricos();

  // Catálogo de produtos -- dedup em tempo de execução (ver comentário
  // acima), mesma chave de routes/acoesSazonais.js (POST /products).
  const catalogoAtual = db.get('acoesSazonaisProducts').value();
  const existentes = new Set(catalogoAtual.map((p) => dedupKey(p.brand, p.nome)));
  const novosProdutos = migration.products.filter((p) => !existentes.has(dedupKey(p.brand, p.nome)));
  if (novosProdutos.length) {
    db.get('acoesSazonaisProducts').push(...novosProdutos).write();
  }

  logAudit({
    user: null, entityType: 'acoesSazonaisMigration', entityId: migration.importBatch,
    entityLabel: 'Migração do histórico de Ações Sazonais pra dentro da Papoi', action: 'import',
    meta: {},
    details: `${migration.actions.length} ações, ${migration.showrooms.length} expositores especiais, `
      + `${migration.budgets.length} orçamentos anuais, ${novosProdutos.length} produto(s) novo(s) no catálogo `
      + `(${migration.products.length - novosProdutos.length} já existiam), ${arquivosCopiados} arquivo(s) anexado(s) copiado(s). `
      + `Exportado do app separado em ${migration.exportedAt}.`
  });
  console.log(`[migrateAcoesSazonaisHistorico129] Importados: ${migration.actions.length} ações, ${migration.showrooms.length} expositores especiais, ${migration.budgets.length} orçamentos, ${novosProdutos.length} produto(s) novo(s) no catálogo, ${arquivosCopiados} arquivo(s) anexado(s).`);
}

module.exports = { migrateAcoesSazonaisHistorico129 };
