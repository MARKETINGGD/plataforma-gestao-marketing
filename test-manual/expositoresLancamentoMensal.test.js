// Teste de integração (servidor de verdade, mesmo padrão de
// agendamentoReformaAvisos.test.js/publicarAgora.test.js) da 70ª rodada,
// pedido da Raquel:
//
//   1. "coloque o total de unidades/mês e o total em R$/mês" (por marca,
//      no Controle de Expositores) -- conferido aqui batendo a soma
//      devolvida por /estoque?brand= contra o total que a rota de
//      lançamento calcula/grava (a tabela usa a mesma soma no rodapé,
//      ver public/app.js).
//   2. "os lançamentos mensais, o total de cada marca no mês, deve ser
//      automaticamente adicionado ao budget. Se for De Bacco no fluxo:
//      2.5.3.14. Se for GhelPlus, no fluxo: 2.5.2.14. Sempre no mês em
//      que foi gasto e na marca em que foi gasto" -- o cerne desta
//      rodada: POST /lancamentos-mensais/lancar cria o lançamento
//      certo no Budget, no fluxo certo por marca, no mês/ano pedido, e
//      relançar o MESMO mês/ano/marca substitui (nunca duplica).
//   3. Aba "Total Mensal" (GET /lancamentos-mensais sem `brand`) devolve
//      os lançamentos das 2 marcas juntos, prontos pra soma no frontend.
//   4. Permissão: só quem tem acesso de edição a Expositores pode lançar.
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção. Usa um ano bem
// no futuro (2099) pra nunca colidir com um mês de verdade já lançado.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-expositores-lancamento-mensal';
process.env.PORT = '4329';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4329';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-expositores-lancamento-mensal-test');
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
  function close(a, b, eps) {
    return Math.abs(Number(a) - Number(b)) < (eps || 0.01);
  }

  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const BASE = 'http://localhost:4329';

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

  function h(token) { return { Authorization: `Bearer ${token}` }; }
  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }

  // ---------- 1. Total por marca bate com a soma dos itens ----------
  async function estoqueItems(brand) {
    return fetch(`${BASE}/api/expositores/estoque?brand=${brand}`, { headers: h(adminToken) })
      .then((r) => r.json()).then((d) => d.items || []);
  }
  const ghelItems = await estoqueItems('ghelplus');
  const debItems = await estoqueItems('debacco');
  check('itens de Expositores da GhelPlus existem (seed da 68ª rodada)', ghelItems.length > 0);
  check('itens de Expositores da De Bacco existem (seed da 68ª rodada)', debItems.length > 0);
  const expectedGhel = ghelItems.reduce((acc, it) => ({
    totalUnidades: acc.totalUnidades + (Number(it.consumoMensal) || 0),
    totalValor: acc.totalValor + (Number(it.valorTotalMensal) || 0)
  }), { totalUnidades: 0, totalValor: 0 });
  const expectedDeb = debItems.reduce((acc, it) => ({
    totalUnidades: acc.totalUnidades + (Number(it.consumoMensal) || 0),
    totalValor: acc.totalValor + (Number(it.valorTotalMensal) || 0)
  }), { totalUnidades: 0, totalValor: 0 });

  // ---------- 2. Lançar GhelPlus no mês 6/2099 -> fluxo 2.5.2.14 ----------
  const lancGhel = await fetch(`${BASE}/api/expositores/lancamentos-mensais/lancar`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'ghelplus', year: 2099, month: 6 })
  }).then((r) => r.json());
  check('lançamento da GhelPlus devolveu o total certo de unidades', close(lancGhel.launch.totalUnidades, expectedGhel.totalUnidades));
  check('lançamento da GhelPlus devolveu o total certo em R$', close(lancGhel.launch.totalValor, expectedGhel.totalValor));
  check('fluxo da GhelPlus é o "Expositores Padrão - 2.5.2.14" pedido pela Raquel', lancGhel.fluxo === 'Expositores Padrão - 2.5.2.14');
  check('lançamento gravou o brand certo (ghelplus)', lancGhel.budgetEntry.brand === 'ghelplus');
  check('lançamento gravou o mês/ano certos (6/2099)', lancGhel.budgetEntry.month === 6 && lancGhel.budgetEntry.year === 2099);
  check('valor "realizado" do Budget bate com o total em R$', close(lancGhel.budgetEntry.realizado, expectedGhel.totalValor));

  // ---------- 2. Lançar De Bacco no mês 6/2099 -> fluxo 2.5.3.14 ----------
  const lancDeb = await fetch(`${BASE}/api/expositores/lancamentos-mensais/lancar`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'debacco', year: 2099, month: 6 })
  }).then((r) => r.json());
  check('lançamento da De Bacco devolveu o total certo de unidades', close(lancDeb.launch.totalUnidades, expectedDeb.totalUnidades));
  check('lançamento da De Bacco devolveu o total certo em R$', close(lancDeb.launch.totalValor, expectedDeb.totalValor));
  check('fluxo da De Bacco é o "Expositores Padrão - 2.5.3.14" pedido pela Raquel', lancDeb.fluxo === 'Expositores Padrão - 2.5.3.14');
  check('lançamento gravou o brand certo (debacco)', lancDeb.budgetEntry.brand === 'debacco');

  // ---------- confere que os 2 lançamentos aparecem de verdade no Budget,
  // cada um na marca/fluxo certos, sem se misturar ----------
  const budgetGhel2099 = await fetch(`${BASE}/api/budget?brand=ghelplus&year=2099`, { headers: h(adminToken) }).then((r) => r.json()).then((d) => d.entries);
  const budgetDeb2099 = await fetch(`${BASE}/api/budget?brand=debacco&year=2099`, { headers: h(adminToken) }).then((r) => r.json()).then((d) => d.entries);
  const ghelEntry = budgetGhel2099.find((e) => e.id === lancGhel.budgetEntry.id);
  const debEntry = budgetDeb2099.find((e) => e.id === lancDeb.budgetEntry.id);
  check('lançamento da GhelPlus aparece de verdade na lista do Budget (marca certa)', !!ghelEntry && ghelEntry.category === 'Expositores Padrão - 2.5.2.14');
  check('lançamento da De Bacco aparece de verdade na lista do Budget (marca certa)', !!debEntry && debEntry.category === 'Expositores Padrão - 2.5.3.14');
  check('lançamento da GhelPlus NÃO aparece na lista da De Bacco (marcas não se misturam)', !budgetDeb2099.some((e) => e.id === lancGhel.budgetEntry.id));

  // ---------- 2b. Relançar o MESMO mês/ano/marca substitui, nunca duplica ----------
  const lancGhelDeNovo = await fetch(`${BASE}/api/expositores/lancamentos-mensais/lancar`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'ghelplus', year: 2099, month: 6 })
  }).then((r) => r.json());
  check('relançar o mesmo mês/marca continua com o mesmo id de lançamento (upsert, não duplica)', lancGhelDeNovo.launch.id === lancGhel.launch.id);
  check('relançar gera um NOVO id de lançamento no Budget (o antigo é removido)', lancGhelDeNovo.budgetEntry.id !== lancGhel.budgetEntry.id);
  const budgetGhel2099Depois = await fetch(`${BASE}/api/budget?brand=ghelplus&year=2099`, { headers: h(adminToken) }).then((r) => r.json()).then((d) => d.entries);
  const doMesmoLancamento = budgetGhel2099Depois.filter((e) => e.sourceExpositoresLancamentoId === lancGhel.launch.id);
  check('relançar não duplica -- só 1 lançamento de Expositores no Budget pra esse mês/marca', doMesmoLancamento.length === 1);
  check('o lançamento antigo no Budget foi removido de verdade (não sobra lixo)', !budgetGhel2099Depois.some((e) => e.id === lancGhel.budgetEntry.id));

  // ---------- 3. Aba "Total Mensal" -- GET sem `brand` devolve as 2 juntas ----------
  const todosLancamentos = await fetch(`${BASE}/api/expositores/lancamentos-mensais`, { headers: h(adminToken) }).then((r) => r.json()).then((d) => d.items);
  const ghelNaLista = todosLancamentos.find((l) => l.brand === 'ghelplus' && l.year === 2099 && l.month === 6);
  const debNaLista = todosLancamentos.find((l) => l.brand === 'debacco' && l.year === 2099 && l.month === 6);
  check('lançamento da GhelPlus aparece na lista agregada (sem filtro de marca)', !!ghelNaLista);
  check('lançamento da De Bacco aparece na lista agregada (sem filtro de marca)', !!debNaLista);
  check('soma das 2 marcas bate com o total combinado esperado (unidades)', close((ghelNaLista.totalUnidades + debNaLista.totalUnidades), (expectedGhel.totalUnidades + expectedDeb.totalUnidades)));
  check('soma das 2 marcas bate com o total combinado esperado (R$)', close((ghelNaLista.totalValor + debNaLista.totalValor), (expectedGhel.totalValor + expectedDeb.totalValor)));
  check('lançamento devolve quem lançou (updatedBy resolvido)', ghelNaLista.updatedBy === 'Admin Teste' || !!ghelNaLista.updatedBy);

  // ---------- 4. Validações e permissão ----------
  const semMarca = await fetch(`${BASE}/api/expositores/lancamentos-mensais/lancar`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'invalida', year: 2099, month: 6 })
  });
  check('marca inválida é rejeitada (400)', semMarca.status === 400);
  const semMes = await fetch(`${BASE}/api/expositores/lancamentos-mensais/lancar`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'ghelplus', year: 2099 })
  });
  check('sem mês é rejeitado (400)', semMes.status === 400);

  const semPermissaoRes = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'semexpositores70', password: '123456', name: 'Sem Permissão Expositores', cargo: 'analista' })
  }).then((r) => r.json());
  const semPermissaoToken = await login('semexpositores70', '123456');
  const negado = await fetch(`${BASE}/api/expositores/lancamentos-mensais/lancar`, {
    method: 'POST', headers: hj(semPermissaoToken), body: JSON.stringify({ brand: 'ghelplus', year: 2099, month: 7 })
  });
  check('usuário sem permissão de editar Expositores não consegue lançar (403)', negado.status === 403);
  check('mas consegue continuar VENDO a lista (GET sem restrição)', (await fetch(`${BASE}/api/expositores/lancamentos-mensais`, { headers: h(semPermissaoToken) })).status === 200);

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
