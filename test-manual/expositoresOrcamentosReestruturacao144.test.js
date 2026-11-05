// Teste de integração (servidor de verdade) da 144ª rodada -- pedido
// detalhado da Raquel sobre Orçamentos de Expositores (ver comentário
// grande em routes/expositores.js antes do POST /orcamentos):
//   1) fluxo (puxado do Budget da marca);
//   2) fornecedor (texto livre, com sugestão vinda do cadastro de
//      Fornecedores -- GET /api/fornecedores);
//   3) "arquivo do orçamento" (upload no nível do orçamento, separado de
//      imagens/desenho técnico de cada expositor);
//   4) "mais de um tipo de expositor no mesmo orçamento" --
//      orc.expositores[] pode crescer, mas nunca fica vazio;
//   5) forma de pagamento + "datas" (parcelamento de verdade,
//      data+valor, mas SÓ INFORMATIVO -- nunca lança sozinho no Budget,
//      confirmado com a Raquel: "os pedidos de orçamentos fechados não
//      devem entrar automaticamente no budget. Eles só entram lá na
//      fase de controle");
//   6) aprovado/não aprovado + "data do primeiro pedido" (só deve fazer
//      sentido com aprovado=true, mas a API aceita de qualquer forma --
//      quem decide mostrar o campo é o front).
// Também confere a MIGRAÇÃO em db.js: um orçamento no formato ANTIGO
// (pré-144ª rodada, 1 expositor direto no documento, sem
// `expositores[]`) precisa continuar existindo, com todos os dados
// originais intactos, dentro de `expositores[0]` depois que o servidor
// sobe -- é o risco real dessa rodada (dado de verdade da Raquel já
// cadastrado).
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-expositores-144-reestruturacao';
process.env.PORT = '4346';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4346';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-expositores-144-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

// ---------- Monta um orçamento no formato ANTIGO (pré-144ª rodada) e
// injeta no db.json ANTES de subir o servidor, pra forçar a migração a
// rodar nele no boot. ----------
const LEGACY_ORC_ID = 'legacy-orc-144-teste';
const legacyOrcamento = {
  id: LEGACY_ORC_ID,
  brand: 'debacco',
  nome: 'Expositor Legado Pré-144',
  anoLancamento: 2025,
  imagens: [{ id: 'img-legado-1', name: 'legado.jpg', url: '/uploads/expositores-orcamentos/legacy-orc-144-teste/legado.jpg' }],
  desenhoTecnico: [{ id: 'desenho-legado-1', name: 'legado.pdf', url: '/uploads/expositores-orcamentos/legacy-orc-144-teste/legado.pdf' }],
  fornecedores: [{ id: 'fornecedor-legado-1', fornecedor: 'Fornecedor Legado', data: '2025-06-01', valor: 1234.5, material: 'Madeira', prazoEntrega: '30 dias', pedidoMinimo: '1 unidade', escolhido: true, createdAt: '2025-06-01T00:00:00.000Z' }],
  createdAt: '2025-05-01T00:00:00.000Z',
  createdBy: 'algum-usuario-antigo',
  updatedAt: '2025-05-01T00:00:00.000Z'
  // Sem `expositores` -- é exatamente isso que a migração em db.js
  // detecta (`o.expositores === undefined`).
};

(function injectLegacyRecordBeforeBoot() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(realDbPath, 'utf8'));
  } catch (e) {
    raw = {};
  }
  raw.expositoresOrcamentos = (raw.expositoresOrcamentos || []).filter((o) => o.id !== LEGACY_ORC_ID);
  raw.expositoresOrcamentos.push(legacyOrcamento);
  fs.writeFileSync(realDbPath, JSON.stringify(raw, null, 2));
})();

async function run() {
  let failures = 0;
  function check(label, cond) {
    console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
    if (!cond) failures++;
  }

  require('../server'); // migração de db.js roda aqui, no require
  await new Promise((r) => setTimeout(r, 800));

  const BASE = 'http://localhost:4346';

  async function login(username, password) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then((r) => r.json());
    return res.token;
  }

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  let adminToken;
  if (statusRes.needsSetup) {
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin Teste', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
  } else {
    adminToken = await login('admin', '123456');
  }
  check('login/setup do admin devolveu token', !!adminToken);

  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }
  function h(token) { return { Authorization: `Bearer ${token}` }; }
  async function createUser(username, name, permissions) {
    const res = await fetch(`${BASE}/api/auth/users`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ username, password: '123456', name, cargo: 'analista' })
    }).then((r) => r.json());
    if (permissions) {
      await fetch(`${BASE}/api/auth/users/${res.user.id}`, { method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ permissions }) });
    }
    return res.user;
  }
  const editor = await createUser('orceditor144', 'Orc Editor 144', { expositores: 'editor' });
  const editorToken = await login('orceditor144', '123456');
  check('usuário de teste criado', !!editor);

  // ========== PARTE 1: migração do orçamento legado ==========
  const listaDebacco = await fetch(`${BASE}/api/expositores/orcamentos?brand=debacco`, { headers: h(editorToken) }).then((r) => r.json());
  const migrado = listaDebacco.items.find((it) => it.id === LEGACY_ORC_ID);
  check('orçamento legado continua existindo depois do boot (migração não perdeu o registro)', !!migrado);
  if (migrado) {
    check('migração: ganhou expositores[] com exatamente 1 item', (migrado.expositores || []).length === 1);
    const expMigrado = migrado.expositores[0];
    check('migração: nome original preservado dentro de expositores[0]', expMigrado.nome === 'Expositor Legado Pré-144');
    check('migração: imagens originais preservadas', expMigrado.imagens.length === 1 && expMigrado.imagens[0].id === 'img-legado-1');
    check('migração: desenho técnico original preservado', expMigrado.desenhoTecnico.length === 1 && expMigrado.desenhoTecnico[0].id === 'desenho-legado-1');
    check('migração: fornecedor original preservado (inclusive "escolhido")', expMigrado.fornecedores.length === 1 && expMigrado.fornecedores[0].fornecedor === 'Fornecedor Legado' && expMigrado.fornecedores[0].escolhido === true);
    check('migração: ano de lançamento original preservado', migrado.anoLancamento === 2025);
    check('migração: campos novos vêm com default seguro (fluxo/formaPagamento/parcelas/arquivo/aprovado)', migrado.fluxo === null && migrado.formaPagamento === '' && Array.isArray(migrado.parcelas) && migrado.parcelas.length === 0 && Array.isArray(migrado.arquivoOrcamento) && migrado.arquivoOrcamento.length === 0 && migrado.aprovado === false && migrado.dataPrimeiroPedido === null);
  }

  // ========== PARTE 2: fluxo + forma de pagamento na criação ==========
  const FLUXO_VALIDO_DEBACCO = 'Institucional - 2.5.3.3';
  const orcComFluxoInvalido = await fetch(`${BASE}/api/expositores/orcamentos`, {
    method: 'POST', headers: hj(editorToken),
    body: JSON.stringify({ brand: 'debacco', nome: 'Expositor Multi 144', anoLancamento: 2027, fluxo: 'Fluxo Que Não Existe', formaPagamento: 'Boleto 30/60/90' })
  }).then((r) => r.json()).then((d) => d.item);
  check('fluxo inválido pra marca é silenciosamente ignorado (vira null, nunca quebra a criação)', orcComFluxoInvalido.fluxo === null);

  const orc = await fetch(`${BASE}/api/expositores/orcamentos`, {
    method: 'POST', headers: hj(editorToken),
    body: JSON.stringify({ brand: 'debacco', nome: 'Expositor Multi 144', anoLancamento: 2027, fluxo: FLUXO_VALIDO_DEBACCO, formaPagamento: 'Boleto 30/60/90' })
  }).then((r) => r.json()).then((d) => d.item);
  check('criar com fluxo válido + forma de pagamento funciona', orc.fluxo === FLUXO_VALIDO_DEBACCO && orc.formaPagamento === 'Boleto 30/60/90');
  const exp1Id = orc.expositores[0].id;

  const orcEditado = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}`, {
    method: 'PUT', headers: hj(editorToken), body: JSON.stringify({ anoLancamento: 2028, formaPagamento: 'PIX à vista' })
  }).then((r) => r.json()).then((d) => d.item);
  check('PUT no orçamento edita ano/forma de pagamento sem precisar de nome (nome não é mais campo do orçamento)', orcEditado.anoLancamento === 2028 && orcEditado.formaPagamento === 'PIX à vista');
  check('PUT no orçamento não altera o nome do expositor envolvido', orcEditado.expositores.find((e) => e.id === exp1Id).nome === 'Expositor Multi 144');

  // ========== PARTE 3: múltiplos expositores no mesmo orçamento ==========
  const semNomeNovoExpositor = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/expositores`, { method: 'POST', headers: hj(editorToken), body: JSON.stringify({}) });
  check('adicionar expositor sem nome é rejeitado (400)', semNomeNovoExpositor.status === 400);

  const comSegundoExpositor = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/expositores`, {
    method: 'POST', headers: hj(editorToken), body: JSON.stringify({ nome: 'Segundo Tipo de Expositor' })
  }).then((r) => r.json()).then((d) => d.item);
  check('"opção para colocar mais de um tipo de expositor no mesmo orçamento" -- 2º expositor adicionado', comSegundoExpositor.expositores.length === 2);
  const exp2Id = comSegundoExpositor.expositores.find((e) => e.nome === 'Segundo Tipo de Expositor').id;

  const tentaRemoverUltimoDepoisDoSegundo = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/expositores/${exp1Id}`, { method: 'DELETE', headers: h(editorToken) });
  check('remover o 1º expositor funciona normalmente enquanto sobra o 2º', tentaRemoverUltimoDepoisDoSegundo.status === 200);
  const apos1Remocao = await tentaRemoverUltimoDepoisDoSegundo.json().then((d) => d.item);
  check('sobra só o 2º expositor', apos1Remocao.expositores.length === 1 && apos1Remocao.expositores[0].id === exp2Id);

  const tentaRemoverUltimoDeTodos = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/expositores/${exp2Id}`, { method: 'DELETE', headers: h(editorToken) });
  check('NUNCA pode ficar sem nenhum expositor -- remover o último é rejeitado (400)', tentaRemoverUltimoDeTodos.status === 400);
  const listaAindaComExp2 = await fetch(`${BASE}/api/expositores/orcamentos?brand=debacco`, { headers: h(editorToken) }).then((r) => r.json());
  check('depois da rejeição, o único expositor restante continua lá (nada foi perdido)', listaAindaComExp2.items.find((it) => it.id === orc.id).expositores.length === 1);

  // Recoloca um 2º expositor pra seguir o teste com 2 (imagens/fornecedores
  // por expositor, já cobertos a fundo no teste da 78ª rodada -- aqui só
  // confirma que cada expositor tem sua PRÓPRIA lista, independente).
  const comExp2Denovo = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/expositores`, {
    method: 'POST', headers: hj(editorToken), body: JSON.stringify({ nome: 'Terceiro Tipo' })
  }).then((r) => r.json()).then((d) => d.item);
  const exp3Id = comExp2Denovo.expositores.find((e) => e.nome === 'Terceiro Tipo').id;
  await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/expositores/${exp2Id}/fornecedores`, {
    method: 'POST', headers: hj(editorToken), body: JSON.stringify({ fornecedor: 'Fornecedor do Expositor 2' })
  });
  const comFornecedorSoNoExp2 = await fetch(`${BASE}/api/expositores/orcamentos?brand=debacco`, { headers: h(editorToken) }).then((r) => r.json()).then((d) => d.items.find((it) => it.id === orc.id));
  const expositor2Final = comFornecedorSoNoExp2.expositores.find((e) => e.id === exp2Id);
  const expositor3Final = comFornecedorSoNoExp2.expositores.find((e) => e.id === exp3Id);
  check('comparação de fornecedores é POR expositor -- o fornecedor adicionado no 2º não aparece no 3º', expositor2Final.fornecedores.length === 1 && expositor3Final.fornecedores.length === 0);

  // ========== PARTE 4: arquivo do orçamento (nível do orçamento) ==========
  const fdArquivo = new FormData();
  fdArquivo.append('files', new Blob(['fake-pdf-orcamento']), 'cotacao-completa.pdf');
  const comArquivo = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/arquivo`, { method: 'POST', headers: h(editorToken), body: fdArquivo }).then((r) => r.json()).then((d) => d.item);
  check('"arquivo do orçamento" sobe no nível do orçamento (não em um expositor específico)', comArquivo.arquivoOrcamento.length === 1 && comArquivo.arquivoOrcamento[0].name === 'cotacao-completa.pdf');
  const arquivoFileId = comArquivo.arquivoOrcamento[0].id;
  const semArquivo = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/arquivo/${arquivoFileId}`, { method: 'DELETE', headers: h(editorToken) }).then((r) => r.json()).then((d) => d.item);
  check('excluir o arquivo do orçamento funciona', semArquivo.arquivoOrcamento.length === 0);

  // ========== PARTE 5: parcelamento -- SÓ INFORMATIVO, nunca sincroniza
  // com o Budget (diferente de Brindes Compras/Influencers, 155ª rodada) ==========
  // Budget tem permissão PRÓPRIA (não a de Expositores) -- usa o admin
  // (super admin) pra essa checagem ter valor de verdade, e o parâmetro
  // certo da API é `year` (não `ano`).
  const budgetAntes = await fetch(`${BASE}/api/budget?brand=debacco&year=2027`, { headers: h(adminToken) }).then((r) => (r.ok ? r.json() : { entries: [] })).catch(() => ({ entries: [] }));
  const semValorParcela = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/parcelas`, { method: 'POST', headers: hj(editorToken), body: JSON.stringify({ dataPagamento: '2027-03-01' }) });
  check('parcela sem valor é rejeitada (400)', semValorParcela.status === 400);

  const comParcela = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/parcelas`, {
    method: 'POST', headers: hj(editorToken), body: JSON.stringify({ valor: 5000, dataPagamento: '2027-03-01' })
  }).then((r) => r.json()).then((d) => d.item);
  check('parcela criada', comParcela.parcelas.length === 1 && comParcela.parcelas[0].valor === 5000);
  check('parcela nasce sem budgetEntryId (nunca sincroniza por si só)', comParcela.parcelas[0].budgetEntryId === undefined);
  const parcelaId = comParcela.parcelas[0].id;

  const parcelaMarcadaPaga = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/parcelas/${parcelaId}`, {
    method: 'PUT', headers: hj(editorToken), body: JSON.stringify({ pago: true })
  }).then((r) => r.json()).then((d) => d.item);
  check('"os pedidos de orçamentos fechados não devem entrar automaticamente no budget" -- marcar parcela como paga NÃO cria budgetEntryId', parcelaMarcadaPaga.parcelas[0].pago === true && parcelaMarcadaPaga.parcelas[0].budgetEntryId === undefined);

  const budgetDepois = await fetch(`${BASE}/api/budget?brand=debacco&year=2027`, { headers: h(adminToken) }).then((r) => (r.ok ? r.json() : { entries: [] })).catch(() => ({ entries: [] }));
  const qtdAntes = (budgetAntes.entries || []).length;
  const qtdDepois = (budgetDepois.entries || []).length;
  check('confirmado: nenhum lançamento novo apareceu no Budget por causa da parcela paga', qtdAntes === qtdDepois);

  const parcelaExcluida = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}/parcelas/${parcelaId}`, { method: 'DELETE', headers: h(editorToken) }).then((r) => r.json()).then((d) => d.item);
  check('excluir parcela funciona', parcelaExcluida.parcelas.length === 0);

  // ========== PARTE 6: aprovado + data do primeiro pedido ==========
  const orcAindaNaoAprovado = await fetch(`${BASE}/api/expositores/orcamentos?brand=debacco`, { headers: h(editorToken) }).then((r) => r.json()).then((d) => d.items.find((it) => it.id === orc.id));
  check('nasce não aprovado', orcAindaNaoAprovado.aprovado === false && orcAindaNaoAprovado.dataPrimeiroPedido === null);

  const aprovado = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}`, {
    method: 'PUT', headers: hj(editorToken), body: JSON.stringify({ aprovado: true })
  }).then((r) => r.json()).then((d) => d.item);
  check('marcar como aprovado funciona', aprovado.aprovado === true);

  const comDataPrimeiroPedido = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}`, {
    method: 'PUT', headers: hj(editorToken), body: JSON.stringify({ dataPrimeiroPedido: '2027-04-10' })
  }).then((r) => r.json()).then((d) => d.item);
  check('"aí aparece a opção de colocar data do primeiro pedido" -- funciona depois de aprovado', comDataPrimeiroPedido.dataPrimeiroPedido === '2027-04-10');

  const desaprovado = await fetch(`${BASE}/api/expositores/orcamentos/${orc.id}`, {
    method: 'PUT', headers: hj(editorToken), body: JSON.stringify({ aprovado: false })
  }).then((r) => r.json()).then((d) => d.item);
  check('desaprovar funciona (volta pra false, sem travar)', desaprovado.aprovado === false);

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;

  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(process.exitCode);
}

run().catch((e) => {
  console.error(e);
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  process.exit(1);
});
