// Teste manual (Node puro, sem servidor HTTP) da correção do bug real
// reportado pela Raquel (70ª rodada, depois de comparar a tela com a
// planilha original): "a planilha do papoi deve ser exatamente igual a
// essa que te enviei... quando o codigo esta como no print, o valor não
// deve ser somado a mais, deve ser considerado uma única vez, exatamente
// como na planilha". Célula mesclada na planilha original fez o seed de
// `expositoresEstoque` (68ª rodada) importar a MESMA combinação
// brand+código de entrada+código de saída duplicada (2x/3x) em vez de 1
// vez só.
//
// Cobre as 2 pontas da correção:
//   1. `seedIfEmpty()` (routes/expositores.js) nunca mais duplica numa
//      instalação NOVA (coleção vazia).
//   2. A migração nova em `db.js` corrige um banco que JÁ tinha rodado o
//      seed antigo (com a duplicata) -- como isso roda no `require('../db')`
//      (só 1x por processo), o teste da migração sobe um processo Node
//      NOVO contra um `data/db.json` com duplicatas injetadas de propósito
//      (backup/restauração do banco real, mesmo padrão dos outros testes
//      de integração) -- sem isso, o `require` cacheado do teste 1 já
//      teria rodado a migração e o teste 2 não provaria nada de verdade.
process.env.PAPOI_BASE_URL = 'http://localhost:4123';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-expositores-dedup-test');
let hadOriginal = false;
if (fs.existsSync(dbPath)) {
  fs.copyFileSync(dbPath, backupPath);
  hadOriginal = true;
}

let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

function readRawDb() {
  return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}
function writeRawDb(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

try {
  // ---------- 1. seedIfEmpty() nunca duplica numa instalação nova ----------
  writeRawDb({}); // db.defaults() preenche o resto na hora do require
  execFileSync('node', ['-e', "require('./routes/expositores');"], { cwd: path.join(__dirname, '..') });
  const afterFreshSeed = readRawDb();
  const itemsFresh = afterFreshSeed.expositoresEstoque || [];
  check('seed novo: 40 itens ao todo (23 GhelPlus + 17 De Bacco, sem duplicata)', itemsFresh.length === 40);
  const chaves = new Set();
  let duplicataNoSeedNovo = false;
  itemsFresh.forEach((it) => {
    const k = it.brand + '|' + it.codigoEntrada + '|' + it.codigoSaida;
    if (chaves.has(k)) duplicataNoSeedNovo = true;
    chaves.add(k);
  });
  check('seed novo: nenhuma combinação brand+entrada+saída duplicada', !duplicataNoSeedNovo);
  const item569Fresh = itemsFresh.filter((it) => it.codigoEntrada === '30.04.00569');
  check('seed novo: 30.04.00569 continua com as 2 linhas LEGÍTIMAS (uma por código de saída), não some', item569Fresh.length === 2 && new Set(item569Fresh.map((it) => it.codigoSaida)).size === 2);
  const item518Fresh = itemsFresh.filter((it) => it.codigoEntrada === '30.04.00518');
  check('seed novo: 30.04.00518 (era duplicado 2x) agora tem 1 linha só', item518Fresh.length === 1);

  // ---------- 2. migração corrige um banco que já tinha a duplicata antiga ----------
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 60000).toISOString(); // 1 min depois
  const dbComDuplicata = Object.assign({}, afterFreshSeed, {
    expositoresEstoque: [
      // grupo com 3 cópias -- a do meio foi "editada depois" (saldoPR
      // diferente, updatedAt mais recente) -- tem que sobreviver.
      { id: 'dup-a', brand: 'ghelplus', codigoEntrada: '99.99.00001', descricaoEntrada: 'Teste', codigoSaida: '10.00.00001', descricaoSaida: 'Teste saída', valorUnitario: 10, saldoPR: 5, saldoSP: 0, saldoNE: 0, saldoTotal: 5, segurancaPR: 0, pendenciaPR: 5, segurancaSP: 0, pendenciaSP: 0, segurancaNE: 0, pendenciaNE: 0, consumoMensal: 1, valorTotalMensal: 10, loteEconomico: null, loteMultiplo: null, ressuprimentoFornecedor: null, ressuprimentoCompras: null, estoqueSeguranca: null, nota: null, updatedAt: now },
      { id: 'dup-b-editada', brand: 'ghelplus', codigoEntrada: '99.99.00001', descricaoEntrada: 'Teste', codigoSaida: '10.00.00001', descricaoSaida: 'Teste saída', valorUnitario: 10, saldoPR: 777, saldoSP: 0, saldoNE: 0, saldoTotal: 777, segurancaPR: 0, pendenciaPR: 777, segurancaSP: 0, pendenciaSP: 0, segurancaNE: 0, pendenciaNE: 0, consumoMensal: 1, valorTotalMensal: 10, loteEconomico: null, loteMultiplo: null, ressuprimentoFornecedor: null, ressuprimentoCompras: null, estoqueSeguranca: null, nota: null, updatedAt: later },
      { id: 'dup-c', brand: 'ghelplus', codigoEntrada: '99.99.00001', descricaoEntrada: 'Teste', codigoSaida: '10.00.00001', descricaoSaida: 'Teste saída', valorUnitario: 10, saldoPR: 5, saldoSP: 0, saldoNE: 0, saldoTotal: 5, segurancaPR: 0, pendenciaPR: 5, segurancaSP: 0, pendenciaSP: 0, segurancaNE: 0, pendenciaNE: 0, consumoMensal: 1, valorTotalMensal: 10, loteEconomico: null, loteMultiplo: null, ressuprimentoFornecedor: null, ressuprimentoCompras: null, estoqueSeguranca: null, nota: null, updatedAt: now },
      // combinação com código de SAÍDA diferente -- não é duplicata,
      // tem que sobreviver intacta (nunca deduplicar só por entrada).
      { id: 'nao-duplicata', brand: 'ghelplus', codigoEntrada: '99.99.00001', descricaoEntrada: 'Teste', codigoSaida: '10.00.99999', descricaoSaida: 'Outro produto', valorUnitario: 10, saldoPR: 3, saldoSP: 0, saldoNE: 0, saldoTotal: 3, segurancaPR: 0, pendenciaPR: 3, segurancaSP: 0, pendenciaSP: 0, segurancaNE: 0, pendenciaNE: 0, consumoMensal: 1, valorTotalMensal: 10, loteEconomico: null, loteMultiplo: null, ressuprimentoFornecedor: null, ressuprimentoCompras: null, estoqueSeguranca: null, nota: null, updatedAt: now }
    ]
  });
  writeRawDb(dbComDuplicata);
  execFileSync('node', ['-e', "require('./db');"], { cwd: path.join(__dirname, '..') });
  const afterMigracao = readRawDb().expositoresEstoque;
  const grupo = afterMigracao.filter((it) => it.codigoEntrada === '99.99.00001' && it.codigoSaida === '10.00.00001');
  check('migração: grupo duplicado (3 cópias) vira 1 registro só', grupo.length === 1);
  check('migração: sobrevive a cópia EDITADA (updatedAt mais recente), não uma das antigas', grupo[0] && grupo[0].id === 'dup-b-editada' && grupo[0].saldoPR === 777);
  const naoDuplicata = afterMigracao.filter((it) => it.codigoEntrada === '99.99.00001' && it.codigoSaida === '10.00.99999');
  check('migração: combinação com código de saída diferente NUNCA é tocada (não é duplicata de verdade)', naoDuplicata.length === 1 && naoDuplicata[0].id === 'nao-duplicata');
  check('migração: só sobram os 2 registros certos (1 do grupo deduplicado + 1 que nunca foi duplicata)', afterMigracao.length === 2);

  // ---------- 3. migração é idempotente (rodar de novo não quebra nada) ----------
  execFileSync('node', ['-e', "require('./db');"], { cwd: path.join(__dirname, '..') });
  const afterSegundaRodada = readRawDb().expositoresEstoque;
  check('migração rodando 2x seguidas não muda mais nada (idempotente)', afterSegundaRodada.length === afterMigracao.length);

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  if (hadOriginal) fs.copyFileSync(backupPath, dbPath);
  else fs.rmSync(dbPath, { force: true });
  fs.rmSync(backupPath, { force: true });
}
process.exit(process.exitCode);
