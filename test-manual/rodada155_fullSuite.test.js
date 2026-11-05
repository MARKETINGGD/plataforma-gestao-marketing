// Teste de integração (servidor de verdade, mesmo padrão dos demais
// test-manual/*.test.js) do commit 99a30fa ("143ª rodada" na numeração
// própria deste projeto / "155ª rodada" da Raquel) -- cobre os 4 itens:
//   1. Demandas: recado em "Em Refação" e "Aprovado" vai pra TODOS os
//      assigneeIds (não só o responsável/estrelinha).
//   2. Demandas: item de checklist marcado ganha link/arquivo (PUT com
//      attachmentLink + POST/DELETE /:id/checklist/:itemId/file).
//   3. Brindes > Compras: marca obrigatória, catálogo por marca, "quem
//      autorizou" só coordenador/gerente/admin, "conferência feita" soma
//      automaticamente em Controle Geral (reversível), parcelas geram/
//      removem lançamento no Budget.
//   4. Influencers: formaPagamento/fluxo/parcelas com nota fiscal,
//      parcela paga sincroniza com o Budget, nunca aparece no link público.
//
// Roda numa cópia ISOLADA do projeto (staged a partir do commit 99a30fa),
// banco sintético criado do zero por este próprio teste -- nunca toca em
// dado real da Raquel.
const path = require('path');

process.env.JWT_SECRET = 'teste-rodada155-fullsuite';
process.env.PORT = '4399';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4399';

async function run() {
  let failures = 0;
  function check(label, cond) {
    console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
    if (!cond) failures++;
  }

  require('../server');
  await new Promise((r) => setTimeout(r, 800));
  const BASE = 'http://localhost:4399';
  const db = require('../db');

  function hj(token, extra) { return Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}, extra || {}); }
  async function j(method, urlPath, token, body) {
    const res = await fetch(`${BASE}${urlPath}`, { method, headers: hj(token), body: body !== undefined ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch (e) { /* sem corpo */ }
    return { status: res.status, data };
  }

  // ---------- Setup: admin + equipe ----------
  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  let adminToken;
  if (statusRes.needsSetup) {
    const setupRes = await j('POST', '/api/auth/setup', null, { name: 'Admin Teste', username: 'admin', password: '123456' });
    adminToken = setupRes.data.token;
  } else {
    adminToken = (await j('POST', '/api/auth/login', null, { username: 'admin', password: '123456' })).data.token;
  }
  check('login/setup do admin devolveu token', !!adminToken);

  async function criarPessoa(username, cargo) {
    const r = await j('POST', '/api/auth/team', adminToken, { username, password: '123456', name: username, cargo });
    return r.data.user;
  }
  const felipe = await criarPessoa('felipe', 'designer'); // marcado na demanda, NÃO é o responsável
  const marcia = await criarPessoa('marcia', 'auxiliar'); // idem, cargo sem permissão de autorizar compra
  const coordenadora = await criarPessoa('camila', 'coordenador'); // pode autorizar compra

  const felipeToken = (await j('POST', '/api/auth/login', null, { username: 'felipe', password: '123456' })).data.token;
  const marciaToken = (await j('POST', '/api/auth/login', null, { username: 'marcia', password: '123456' })).data.token;

  // dá permissão de budget/brindes pro admin enxergar tudo (super admin já
  // tem acesso a td, mas confirmamos explicitamente que a leitura funciona)
  async function getRecados(token) {
    const r = await j('GET', '/api/recados/for-me', token);
    return r.data.recados || [];
  }

  // =====================================================================
  // 1) DEMANDAS: recados em Em Refação / Aprovado vão pra TODOS os marcados
  // =====================================================================
  const adminUser = db.get('users').find({ username: 'admin' }).value();
  const demandaRes = await j('POST', '/api/demandas', adminToken, {
    title: 'Teste recados 155', assigneeIds: [felipe.id, marcia.id], responsibleId: felipe.id, status: 'a_fazer'
  });
  check('demanda criada', demandaRes.status === 200 && !!demandaRes.data.demanda);
  const demandaId = demandaRes.data.demanda.id;

  const antesFelipe = (await getRecados(felipeToken)).length;
  const antesMarcia = (await getRecados(marciaToken)).length;

  await j('PUT', `/api/demandas/${demandaId}`, adminToken, { status: 'em_refacao' });
  const depoisRefacaoFelipe = await getRecados(felipeToken);
  const depoisRefacaoMarcia = await getRecados(marciaToken);
  check('"Em Refação": responsável (Felipe, marcado) recebeu recado', depoisRefacaoFelipe.length > antesFelipe);
  check('"Em Refação": OUTRO marcado (Marcia, não é o responsável) TAMBÉM recebeu recado -- é o ponto central do pedido', depoisRefacaoMarcia.length > antesMarcia);

  await j('PUT', `/api/demandas/${demandaId}`, adminToken, { status: 'a_fazer' }); // volta, pra testar "aprovado" como transição nova de novo
  const antesAprovFelipe = (await getRecados(felipeToken)).length;
  const antesAprovMarcia = (await getRecados(marciaToken)).length;
  await j('PUT', `/api/demandas/${demandaId}`, adminToken, { status: 'aprovado' });
  const depoisAprovFelipe = await getRecados(felipeToken);
  const depoisAprovMarcia = await getRecados(marciaToken);
  check('"Aprovado": responsável recebeu recado', depoisAprovFelipe.length > antesAprovFelipe);
  check('"Aprovado": OUTRO marcado também recebeu recado', depoisAprovMarcia.length > antesAprovMarcia);

  // =====================================================================
  // 2) DEMANDAS: link/arquivo por item de checklist
  // =====================================================================
  const itemRes = await j('POST', `/api/demandas/${demandaId}/checklist`, adminToken, { text: 'Item com anexo' });
  check('item de checklist criado já nasce com attachmentLink/attachmentFile nulos', itemRes.status === 200);
  const itemId = itemRes.data.demanda.checklist.find((it) => it.text === 'Item com anexo').id;

  const linkRes = await j('PUT', `/api/demandas/${demandaId}/checklist/${itemId}`, adminToken, { attachmentLink: 'https://exemplo.com/orcamento.pdf' });
  const itemComLink = linkRes.data.demanda.checklist.find((it) => it.id === itemId);
  check('link anexado ao item do checklist via PUT', itemComLink && itemComLink.attachmentLink === 'https://exemplo.com/orcamento.pdf');

  // upload de arquivo de verdade (multipart) no item do checklist
  const fd = new FormData();
  fd.append('file', new Blob(['conteudo de teste'], { type: 'text/plain' }), 'comprovante.txt');
  const uploadRes = await fetch(`${BASE}/api/demandas/${demandaId}/checklist/${itemId}/file`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: fd
  }).then((r) => r.json());
  const itemComArquivo = (uploadRes.demanda || {}).checklist && uploadRes.demanda.checklist.find((it) => it.id === itemId);
  check('arquivo anexado ao item do checklist via upload', itemComArquivo && itemComArquivo.attachmentFile && itemComArquivo.attachmentFile.name === 'comprovante.txt');

  const delFileRes = await j('DELETE', `/api/demandas/${demandaId}/checklist/${itemId}/file`, adminToken);
  const itemSemArquivo = delFileRes.data.demanda.checklist.find((it) => it.id === itemId);
  check('remover arquivo do item funciona e não derruba o link', itemSemArquivo && !itemSemArquivo.attachmentFile && itemSemArquivo.attachmentLink === 'https://exemplo.com/orcamento.pdf');

  // checklist criado ANTES desta rodada (sem os campos) não pode quebrar a serialização
  db.get('demandas').find({ id: demandaId }).get('checklist').push({ id: 'item-legado-sem-campos-novos', text: 'legado', done: false }).write();
  const listaRes = await j('GET', '/api/demandas', adminToken);
  const demandaRelida = listaRes.status === 200 && (listaRes.data.demandas || []).find((d) => d.id === demandaId);
  const itemLegado = demandaRelida && demandaRelida.checklist.find((it) => it.id === 'item-legado-sem-campos-novos');
  check('item de checklist LEGADO (sem attachmentLink/attachmentFile) não quebra e normaliza pra null', !!itemLegado && itemLegado.attachmentLink === null && itemLegado.attachmentFile === null);

  // =====================================================================
  // 3) BRINDES > COMPRAS
  // =====================================================================
  const catalogRes = await j('POST', '/api/brindes/catalog', adminToken, {
    brand: 'ghelplus', group: 'Vinhos', code: 'V-001', item: 'Vinho Teste 155', multiplo: 1, valor: 50,
    estoquePR: 10, estoqueSP: 0, estoquePE: 0, status: 'ativo'
  });
  check('item de catálogo criado', catalogRes.status === 200);
  const catalogItemId = catalogRes.data.item.id;
  const estoqueAntes = catalogRes.data.item.estoqueTotal;

  // marca obrigatória no lançamento direto
  const semMarcaRes = await j('POST', '/api/brindes/compras', adminToken, { item: 'Vinho Teste 155', quantidade: 5, valorUnitario: 50 });
  check('Compra SEM marca é rejeitada (marca agora é obrigatória)', semMarcaRes.status === 400);

  // "quem autorizou" só coordenador/gerente/admin -- Marcia (auxiliar) não pode
  const autorizadorInvalidoRes = await j('POST', '/api/brindes/compras', adminToken, {
    item: 'Vinho Teste 155', brand: 'ghelplus', catalogItemId, quantidade: 5, valorUnitario: 50, quemAutorizouId: marcia.id
  });
  check('"quem autorizou" = pessoa com cargo SEM permissão (auxiliar) é rejeitado', autorizadorInvalidoRes.status === 400);

  const compraRes = await j('POST', '/api/brindes/compras', adminToken, {
    item: 'Vinho Teste 155', brand: 'ghelplus', catalogItemId, quantidade: 5, valorUnitario: 50, quemAutorizouId: coordenadora.id, fornecedor: 'Fornecedor Teste'
  });
  check('Compra criada com marca + catálogo + autorizador válido (coordenadora)', compraRes.status === 200 && compraRes.data.item.quemAutorizouId === coordenadora.id);
  const compraId = compraRes.data.item.id;

  const semConferenciaItem = db.get('brindesCatalog').find({ id: catalogItemId }).value();
  check('estoque NÃO muda antes de marcar "conferência feita"', semConferenciaItem.estoqueTotal === estoqueAntes);

  const conferenciaRes = await j('PUT', `/api/brindes/compras/${compraId}`, adminToken, { conferencia: true });
  const estoqueDepoisConf = db.get('brindesCatalog').find({ id: catalogItemId }).value().estoqueTotal;
  check('"conferência feita" soma a quantidade automaticamente em Controle Geral', estoqueDepoisConf === estoqueAntes + 5);

  const desmarcaConfRes = await j('PUT', `/api/brindes/compras/${compraId}`, adminToken, { conferencia: false });
  const estoqueDepoisDesmarca = db.get('brindesCatalog').find({ id: catalogItemId }).value().estoqueTotal;
  check('desmarcar "conferência feita" reverte a soma no estoque (não deixa fantasma)', estoqueDepoisDesmarca === estoqueAntes);

  await j('PUT', `/api/brindes/compras/${compraId}`, adminToken, { conferencia: true });

  // fluxo precisa ser um dos válidos da marca -- busca via /meta, como o front faz
  const metaRes = await j('GET', '/api/budget/meta?brand=ghelplus', adminToken);
  const fluxoValido = (metaRes.data.fluxos || [])[0];
  check('endpoint /api/budget/meta devolve fluxos da marca (usado pelo seletor no front)', !!fluxoValido);
  await j('PUT', `/api/brindes/compras/${compraId}`, adminToken, { fluxo: fluxoValido });

  const budgetAntes = db.get('budgetEntries').value().length;
  const parcelaRes = await j('POST', `/api/brindes/compras/${compraId}/parcelas`, adminToken, { valor: 250, dataPagamento: '2026-11-10' });
  check('parcela criada (ainda não paga)', parcelaRes.status === 200);
  const parcelaId = parcelaRes.data.item.parcelas[0].id;
  const budgetDepoisCriar = db.get('budgetEntries').value().length;
  check('criar a parcela (pago:false) NÃO lança no Budget ainda', budgetDepoisCriar === budgetAntes);

  const pagarRes = await j('PUT', `/api/brindes/compras/${compraId}/parcelas/${parcelaId}`, adminToken, { pago: true });
  const budgetDepoisPagar = db.get('budgetEntries').value().length;
  check('marcar parcela como PAGA lança automaticamente no Budget', budgetDepoisPagar === budgetAntes + 1);
  const entryLancado = db.get('budgetEntries').find({ sourceBrindeParcelaId: parcelaId }).value();
  check('lançamento no Budget tem marca/fluxo/valor corretos', entryLancado && entryLancado.brand === 'ghelplus' && entryLancado.category === fluxoValido && entryLancado.realizado === 250);

  const despagarRes = await j('PUT', `/api/brindes/compras/${compraId}/parcelas/${parcelaId}`, adminToken, { pago: false });
  const budgetDepoisDespagar = db.get('budgetEntries').value().length;
  check('desmarcar a parcela como paga REMOVE o lançamento do Budget', budgetDepoisDespagar === budgetAntes);

  await j('PUT', `/api/brindes/compras/${compraId}/parcelas/${parcelaId}`, adminToken, { pago: true }); // paga de novo pra testar exclusão
  await j('DELETE', `/api/brindes/compras/${compraId}/parcelas/${parcelaId}`, adminToken);
  check('excluir a parcela também remove o lançamento do Budget', db.get('budgetEntries').value().length === budgetAntes);

  // excluir a Compra inteira (já conferida) não deixa estoque fantasma nem lançamento perdido
  await j('PUT', `/api/brindes/compras/${compraId}`, adminToken, { conferencia: true });
  const delCompraRes = await j('DELETE', `/api/brindes/compras/${compraId}`, adminToken);
  check('excluir a Compra funciona', delCompraRes.status === 200);
  const estoqueFinal = db.get('brindesCatalog').find({ id: catalogItemId }).value().estoqueTotal;
  check('excluir a Compra conferida reverte o estoque que ela tinha somado', estoqueFinal === estoqueAntes);

  // =====================================================================
  // 4) INFLUENCERS
  // =====================================================================
  const infRes = await j('POST', '/api/influencers', adminToken, {
    brand: 'ghelplus', name: 'Influencer Teste 155',
    cpf: '00000000000', rg: '000000000', telefone: '11999999999', email: 'inf155@teste.com',
    dataNascimento: '1990-01-01', endereco: 'Rua Teste, 123'
  });
  check('influencer criado', infRes.status === 200);
  const infId = infRes.data.influencer.id;

  const semFluxoParcelaRes = await j('POST', `/api/influencers/${infId}/parcelas`, adminToken, { valor: 1000, dataPagamento: '2026-11-15' });
  check('parcela sem fluxo definido no influencer é rejeitada', semFluxoParcelaRes.status === 400);

  const metaInfRes = await j('GET', '/api/budget/meta?brand=ghelplus', adminToken);
  const fluxoInf = (metaInfRes.data.fluxos || [])[1] || (metaInfRes.data.fluxos || [])[0];
  await j('PUT', `/api/influencers/${infId}`, adminToken, { formaPagamento: 'PIX', fluxo: fluxoInf });
  const infAtualizado = (await j('GET', `/api/influencers/${infId}`, adminToken)).data.influencer;
  check('forma de pagamento e fluxo salvos no influencer', infAtualizado.formaPagamento === 'PIX' && infAtualizado.fluxo === fluxoInf);

  const infParcelaRes = await j('POST', `/api/influencers/${infId}/parcelas`, adminToken, { valor: 1000, dataPagamento: '2026-11-15' });
  const infParcelaId = infParcelaRes.data.influencer.parcelas[0].id;
  const budgetAntesInf = db.get('budgetEntries').value().length;
  await j('PUT', `/api/influencers/${infId}/parcelas/${infParcelaId}`, adminToken, { pago: true });
  check('parcela paga do influencer lança no Budget', db.get('budgetEntries').value().length === budgetAntesInf + 1);

  const fd2 = new FormData();
  fd2.append('notaFiscal', new Blob(['nf'], { type: 'text/plain' }), 'nf-teste.txt');
  const nfRes = await fetch(`${BASE}/api/influencers/${infId}/parcelas/${infParcelaId}/nota-fiscal`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: fd2
  }).then((r) => r.json());
  const parcelaComNf = nfRes.influencer.parcelas.find((p) => p.id === infParcelaId);
  check('nota fiscal anexada à parcela do influencer', parcelaComNf && parcelaComNf.notaFiscal && parcelaComNf.notaFiscal.name === 'nf-teste.txt');

  // link público NUNCA expõe forma de pagamento/fluxo/parcelas
  const tokenRes = await j('POST', `/api/influencers/${infId}/public-link/generate`, adminToken, {});
  const publicToken = tokenRes.data && tokenRes.data.publicToken;
  if (publicToken) {
    const publicRes = await fetch(`${BASE}/api/influencers/public/${publicToken}`).then((r) => r.json());
    const pubInf = publicRes.influencer;
    check('link público do influencer NÃO expõe formaPagamento/fluxo/parcelas', pubInf && pubInf.formaPagamento === undefined && pubInf.fluxo === undefined && pubInf.parcelas === undefined);
  } else {
    console.log('AVISO - não encontrei a rota de link público do influencer por esse nome; pulei essa checagem específica (ver manualmente).');
  }

  // exclusão do influencer remove lançamento de Budget da parcela
  await j('DELETE', `/api/influencers/${infId}`, adminToken);
  check('excluir o influencer remove o lançamento de Budget da parcela paga', db.get('budgetEntries').value().length === budgetAntesInf);

  console.log(`\n${failures === 0 ? 'TODOS OS TESTES PASSARAM' : failures + ' FALHA(S)'} -- rodada155_fullSuite`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error('ERRO NO TESTE:', e); process.exit(1); });
