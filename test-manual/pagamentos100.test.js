// Teste de integração (servidor de verdade, mesmo padrão dos demais
// test-manual/*.test.js) da 100ª rodada -- novo menu Pagamentos (Controle
// de Assinaturas, Controle de Pagamentos com abas Cartão/Mensal/Extras,
// Terceirizados) + importação histórica das planilhas que a Raquel colou
// no chat + sincronização automática Pagamentos -> Budget.
//
// Cobre:
//   1. Importação histórica rodou (assinaturas + pagamentos das 3 abas),
//      e TODO registro importado nasce com historicalImport:true e
//      budgetSynced:false.
//   2. CRUD de Assinaturas (criar/editar/anexar arquivo/remover arquivo).
//   3. CRUD de Pagamentos (criar numa aba, editar, anexar/remover arquivo).
//   4. Regra de ouro: marcar "Pago" num lançamento HISTÓRICO nunca lança
//      nada no Budget (não importa quantas vezes).
//   5. Marcar "Pago" num lançamento NOVO (criado pela tela) com marca(s)
//      reconhecida(s) pelo Budget lança automaticamente lá, dividindo o
//      valor igualmente quando há mais de uma marca -- e só lança 1 vez
//      (editar de novo não duplica).
//   6. Terceirizados: criar, checklist (add/marcar feito/remover), e
//      arquivo em cada uma das 3 seções de "documentos necessários".
//   7. Permissão: quem não tem 'pagamentos' editor/admin pode VER mas não
//      EDITAR (403), super admin sempre pode.
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-pagamentos-100';
process.env.PORT = '4363';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4363';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-pagamentos-100-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

async function run() {
  let failures = 0;
  function check(label, cond) {
    console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
    if (!cond) failures++;
  }

  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const BASE = 'http://localhost:4363';
  const db = require('../db');

  async function login(username, password) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then((r) => r.json());
    return res.token;
  }
  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }

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

  // ---------- 1. Importação histórica ----------
  const assinaturasRes = await fetch(`${BASE}/api/pagamentos/assinaturas`, { headers: hj(adminToken) }).then((r) => r.json());
  check('[100ª rodada] importou as 26 linhas de CONTROLE DE ASSINATURAS MKT', assinaturasRes.items.length === 26);
  check('[100ª rodada] toda assinatura importada nasce historicalImport:true', assinaturasRes.items.every((a) => a.historicalImport === true));
  check('[100ª rodada] Claude (assinatura) importado com valor e fluxo certos', assinaturasRes.items.some((a) => a.nome === 'Claude' && a.preco === 1100 && a.fluxo === '2.5.1.1'));

  const cartaoRes = await fetch(`${BASE}/api/pagamentos/pagamentos?aba=cartao`, { headers: hj(adminToken) }).then((r) => r.json());
  const mensalRes = await fetch(`${BASE}/api/pagamentos/pagamentos?aba=mensal`, { headers: hj(adminToken) }).then((r) => r.json());
  const extrasRes = await fetch(`${BASE}/api/pagamentos/pagamentos?aba=extras`, { headers: hj(adminToken) }).then((r) => r.json());
  check('[100ª rodada] importou a aba Cartão (18 linhas)', cartaoRes.items.length === 18);
  check('[100ª rodada] importou a aba Mensal (11 linhas)', mensalRes.items.length === 11);
  check('[100ª rodada] importou a aba Extras (17 linhas)', extrasRes.items.length === 17);
  check('[100ª rodada] toda linha importada nasce historicalImport:true e budgetSynced:false',
    cartaoRes.items.concat(mensalRes.items, extrasRes.items).every((p) => p.historicalImport === true && p.budgetSynced === false));
  const freepik = cartaoRes.items.find((p) => p.fornecedor === 'Freepik');
  check('[100ª rodada] Freepik (Cartão) importado com valor e marcas certas', !!freepik && freepik.valor === 104.58 && freepik.marcas.includes('debacco') && freepik.marcas.includes('ghelplus'));
  const ramper = mensalRes.items.find((p) => p.fornecedor === 'RAMPER');
  check('[100ª rodada] RAMPER (Mensal) tem 3 marcas no texto bruto, mas só 2 reconhecidas pelo Budget (De Bacco/GhelPlus)',
    !!ramper && ramper.marcaRaw.includes('Duranox') && ramper.marcas.filter(Boolean).length === 2);

  // Rodar a importação de novo (reiniciar o server simula isso no boot) não duplica nada.
  require('../utils/seedPagamentosImport2026').seedPagamentosImport2026();
  const cartaoDepois = await fetch(`${BASE}/api/pagamentos/pagamentos?aba=cartao`, { headers: hj(adminToken) }).then((r) => r.json());
  check('[100ª rodada] importação é idempotente -- rodar de novo não duplica', cartaoDepois.items.length === 18);

  // ---------- 2. CRUD de Assinaturas ----------
  const novaAssinatura = await fetch(`${BASE}/api/pagamentos/assinaturas`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ nome: 'Figma', preco: 'R$ 150,00', tipo: 'Mensal', fluxo: '2.5.3.5', pagamento: 'Cartão Raquel' })
  }).then((r) => r.json()).then((d) => d.item);
  check('[100ª rodada] criar assinatura nova (não histórica)', !!novaAssinatura.id && novaAssinatura.historicalImport === false && novaAssinatura.preco === 150);
  const assinaturaEditada = await fetch(`${BASE}/api/pagamentos/assinaturas/${novaAssinatura.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ status: 'Renovar' })
  }).then((r) => r.json()).then((d) => d.item);
  check('[100ª rodada] editar assinatura', assinaturaEditada.status === 'Renovar');
  const FormData = globalThis.FormData;
  const form1 = new FormData();
  form1.append('files', new Blob(['contrato figma'], { type: 'text/plain' }), 'figma.txt');
  const assinaturaComArquivo = await fetch(`${BASE}/api/pagamentos/assinaturas/${novaAssinatura.id}/arquivos`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: form1
  }).then((r) => r.json()).then((d) => d.item);
  check('[100ª rodada] anexar arquivo na assinatura', assinaturaComArquivo.arquivos.length === 1 && assinaturaComArquivo.arquivos[0].name === 'figma.txt');
  await fetch(`${BASE}/api/pagamentos/assinaturas/${novaAssinatura.id}/arquivos/${assinaturaComArquivo.arquivos[0].id}`, { method: 'DELETE', headers: hj(adminToken) });
  const assinaturaSemArquivo = db.get('assinaturas').find({ id: novaAssinatura.id }).value();
  check('[100ª rodada] remover arquivo da assinatura', assinaturaSemArquivo.arquivos.length === 0);

  // ---------- 3/4/5. Pagamentos novos + sincronização com o Budget ----------
  const budgetAntes = db.get('budgetEntries').value().length;
  const pagamentoHistorico = freepik; // já existe, historicalImport:true
  await fetch(`${BASE}/api/pagamentos/pagamentos/${pagamentoHistorico.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ pago: true })
  });
  const budgetDepoisHistorico = db.get('budgetEntries').value().length;
  check('[100ª rodada] REGRA DE OURO: marcar "Pago" num lançamento HISTÓRICO não lança nada no Budget',
    budgetDepoisHistorico === budgetAntes);
  const freepikDepois = db.get('pagamentos').find({ id: pagamentoHistorico.id }).value();
  check('[100ª rodada] lançamento histórico continua budgetSynced:false mesmo marcado como pago', freepikDepois.budgetSynced === false);

  const pagamentoNovo = await fetch(`${BASE}/api/pagamentos/pagamentos`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({
      aba: 'mensal', mes: 'Outubro', ano: 2026, fornecedor: 'Fornecedor Teste 100',
      valor: 'R$ 1.000,00', marca: 'De Bacco, GhelPlus', fluxoGerencial: '2.5.3.3', status: 'Mensal', pago: false
    })
  }).then((r) => r.json()).then((d) => d.item);
  check('[100ª rodada] criar lançamento novo (não histórico), ainda não pago -- não lança no Budget', !pagamentoNovo.budgetSynced);
  const budgetAntesDoNovo = db.get('budgetEntries').value().length;

  const pagamentoNovoPago = await fetch(`${BASE}/api/pagamentos/pagamentos/${pagamentoNovo.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ pago: true })
  }).then((r) => r.json()).then((d) => d.item);
  check('[100ª rodada] marcar "Pago" num lançamento NOVO com 2 marcas reconhecidas lança 2 entradas no Budget (uma por marca)',
    db.get('budgetEntries').value().length === budgetAntesDoNovo + 2);
  check('[100ª rodada] lançamento fica marcado budgetSynced:true com os 2 ids', pagamentoNovoPago.budgetSynced === true && pagamentoNovoPago.budgetEntryIds.length === 2);
  const entradasBudget = db.get('budgetEntries').value().filter((e) => e.sourcePagamentoId === pagamentoNovo.id);
  check('[100ª rodada] valor dividido igualmente entre as 2 marcas (R$500 cada)', entradasBudget.every((e) => e.realizado === 500));
  check('[100ª rodada] mês/ano/categoria certos em cada entrada do Budget', entradasBudget.every((e) => e.month === 10 && e.year === 2026 && e.category === '2.5.3.3'));
  check('[100ª rodada] uma entrada é GhelPlus e outra é De Bacco', entradasBudget.some((e) => e.brand === 'ghelplus') && entradasBudget.some((e) => e.brand === 'debacco'));

  // Editar de novo (já sincronizado) não duplica.
  await fetch(`${BASE}/api/pagamentos/pagamentos/${pagamentoNovo.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ observacoes: 'edição depois de sincronizado' })
  });
  check('[100ª rodada] editar um lançamento já sincronizado não duplica no Budget',
    db.get('budgetEntries').value().filter((e) => e.sourcePagamentoId === pagamentoNovo.id).length === 2);

  // ---------- 6. Terceirizados ----------
  const terceirizado = await fetch(`${BASE}/api/pagamentos/terceirizados`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ nome: 'Empresa Terceirizada Teste' })
  }).then((r) => r.json()).then((d) => d.item);
  check('[100ª rodada] criar terceirizado já nasce com as 3 seções de documentos vazias',
    Array.isArray(terceirizado.documentos.checklist.items) && terceirizado.documentos.contratos.files.length === 0 && terceirizado.documentos.pagamentos.files.length === 0);

  const checklistComItem = await fetch(`${BASE}/api/pagamentos/terceirizados/${terceirizado.id}/checklist`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ text: 'Assinar contrato' })
  }).then((r) => r.json()).then((d) => d.item);
  const itemId = checklistComItem.documentos.checklist.items[0].id;
  check('[100ª rodada] adicionar item no checklist', checklistComItem.documentos.checklist.items.length === 1);
  const checklistMarcado = await fetch(`${BASE}/api/pagamentos/terceirizados/${terceirizado.id}/checklist/${itemId}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ done: true })
  }).then((r) => r.json()).then((d) => d.item);
  check('[100ª rodada] marcar item do checklist como feito', checklistMarcado.documentos.checklist.items[0].done === true);

  for (const secao of ['contratos', 'checklist', 'pagamentos']) {
    const form = new FormData();
    form.append('files', new Blob(['doc ' + secao], { type: 'text/plain' }), `${secao}.txt`);
    const comArquivo = await fetch(`${BASE}/api/pagamentos/terceirizados/${terceirizado.id}/documentos/${secao}/arquivos`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: form
    }).then((r) => r.json()).then((d) => d.item);
    check(`[100ª rodada] anexar arquivo na seção "${secao}" de documentos necessários`, comArquivo.documentos[secao].files.length === 1);
  }
  await fetch(`${BASE}/api/pagamentos/terceirizados/${terceirizado.id}/checklist/${itemId}`, { method: 'DELETE', headers: hj(adminToken) });
  const terceirizadoFinal = db.get('terceirizados').find({ id: terceirizado.id }).value();
  check('[100ª rodada] remover item do checklist', terceirizadoFinal.documentos.checklist.items.length === 0);
  check('[100ª rodada] remover item do checklist não apaga os arquivos da seção checklist', terceirizadoFinal.documentos.checklist.files.length === 1);

  // ---------- 7. Permissão ----------
  const semPermissao = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'semPagamentos100', password: '123456', name: 'Sem Permissão Pagamentos' })
  }).then((r) => r.json()).then((d) => d.user);
  const tokenSemPermissao = await login('semPagamentos100', '123456');
  const verOk = await fetch(`${BASE}/api/pagamentos/assinaturas`, { headers: hj(tokenSemPermissao) });
  check('[100ª rodada] quem não tem permissão de edição ainda consegue VER', verOk.status === 200);
  const editBloqueado = await fetch(`${BASE}/api/pagamentos/assinaturas`, {
    method: 'POST', headers: hj(tokenSemPermissao), body: JSON.stringify({ nome: 'Não devia criar' })
  });
  check('[100ª rodada] quem não tem permissão de edição NÃO consegue criar (403)', editBloqueado.status === 403);

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(() => {
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(process.exitCode);
});
