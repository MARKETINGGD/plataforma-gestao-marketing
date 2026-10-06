// Teste de integração (servidor de verdade, mesmo padrão de
// aprovacaoCargoAdmin79.test.js / espelharFacebookManual86.test.js) da
// 88ª rodada, pedido da Raquel:
//
//   "Em brindes- as retiradas internas podem aparecer p todos, mas só
//   podem ser editadas por quem p admin autorizar; Controle GERAL- o
//   registro de saidas deve ter link externo de visualização e de
//   ediçao; em registro de saida coloque a opção de adicionar mais itens
//   em um mesmo registro."
//
// Cobre, contra a API de verdade:
//   1) Retiradas Internas ganhou permissão própria ('retiradasInternas'),
//      separada da de Brindes ('brindes') -- dá pra autorizar editar uma
//      sem a outra.
//   2) Migração única: usuário que já existia ANTES desta rodada (com
//      `permissions.brindes` salvo, sem a chave nova) ganha, ao subir o
//      servidor, o mesmo nível de acesso em 'retiradasInternas' -- não
//      perde acesso que já tinha.
//   3) Registro de Saídas (Controle Geral) agora aceita vários itens no
//      mesmo registro, descontando do estoque item por item (cascata
//      PR/SP/PE), e desfazendo tudo certinho ao excluir.
//   4) Link externo do Registro de Saídas: leitura (só ver), edição
//      (registrar saída nova sem login), rejeitando modo errado e item
//      de marca errada.
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção. Pré-popula um
// usuário "legado" (sem a chave `retiradasInternas`) DIRETO no arquivo
// antes de subir o servidor, pra conseguir testar a migração que roda no
// boot (ver migrateRetiradasInternasPermission em routes/auth.js).
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-retiradas-permissao-log-multi-item-88';
process.env.PORT = '4350';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4350';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-retiradas-permissao-log-88-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

// Usuário "legado": já existia antes desta rodada, com permissão de
// Brindes = editor, mas SEM a chave `retiradasInternas` (exatamente a
// forma de antes desta rodada). Pré-insere no banco direto, antes do
// servidor subir, pra testar a migração automática.
const bcrypt = require('bcryptjs');
const LEGADO_ID = 'legado-retiradas-88-user';
const legacyDb = fs.existsSync(realDbPath) ? JSON.parse(fs.readFileSync(realDbPath, 'utf8')) : {};
legacyDb.users = legacyDb.users || [];
legacyDb.users.push({
  id: LEGADO_ID,
  username: 'legado88',
  passwordHash: bcrypt.hashSync('123456', 10),
  name: 'Usuário Legado 88',
  isSuperAdmin: false,
  // Sem 'retiradasInternas' aqui de propósito -- é exatamente o shape de
  // antes desta rodada.
  permissions: { trafegoPago: 'none', acoesSazonais: 'none', redesSociais: 'none', budget: 'none', brindes: 'editor', produtos: 'none', expositores: 'none', campanhaCooperada: 'none' },
  cargo: '',
  createdAt: new Date().toISOString()
});
fs.writeFileSync(realDbPath, JSON.stringify(legacyDb, null, 2));

async function run() {
  let failures = 0;
  function check(label, cond) {
    console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
    if (!cond) failures++;
  }

  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const BASE = 'http://localhost:4350';

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
      body: JSON.stringify({ name: 'Raquel', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
  } else {
    adminToken = await login('admin', '123456');
  }
  check('login/setup do admin devolveu token', !!adminToken);

  // ---------- 1) Migração: usuário legado ganhou retiradasInternas = brindes ----------
  const usersAfterBoot = await fetch(`${BASE}/api/auth/users`, { headers: hj(adminToken) }).then((r) => r.json()).then((d) => d.users);
  const legado = usersAfterBoot.find((u) => u.id === LEGADO_ID);
  check('usuário legado (sem retiradasInternas salvo) existe depois do boot', !!legado);
  check('migração deu ao legado o MESMO nível que ele já tinha em Brindes (editor)', legado && legado.permissions.retiradasInternas === 'editor');
  check('a chave "brindes" do legado continua intacta (editor)', legado && legado.permissions.brindes === 'editor');

  // ---------- 2) Permissão separada: editor só de retiradasInternas, sem brindes ----------
  const soRetiradas = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({
      username: 'soretiradas88', password: '123456', name: 'Só Retiradas 88',
      permissions: { retiradasInternas: 'editor', brindes: 'none' }
    })
  }).then((r) => r.json()).then((d) => d.user);
  const soRetiradasToken = await login('soretiradas88', '123456');

  const soBrindes = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({
      username: 'sobrindes88', password: '123456', name: 'Só Brindes 88',
      permissions: { retiradasInternas: 'none', brindes: 'editor' }
    })
  }).then((r) => r.json()).then((d) => d.user);
  const soBrindesToken = await login('sobrindes88', '123456');

  // Item de catálogo pra testar tanto retiradas quanto saídas.
  const catalogItem = await fetch(`${BASE}/api/brindes/catalog`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ brand: 'debacco', item: 'Item Teste 88', estoquePR: 10, estoqueSP: 10, estoquePE: 10 })
  }).then((r) => r.json()).then((d) => d.item);

  const retiradaPorSoRetiradas = await fetch(`${BASE}/api/retiradas-internas`, {
    method: 'POST', headers: hj(soRetiradasToken),
    body: JSON.stringify({ brand: 'debacco', withdrawnByName: 'Fulano', items: [{ catalogItemId: catalogItem.id, item: catalogItem.item, quantidade: 1 }] })
  });
  check('quem só tem permissão de Retiradas Internas CONSEGUE criar uma retirada', retiradaPorSoRetiradas.status === 200);

  const retiradaPorSoBrindes = await fetch(`${BASE}/api/retiradas-internas`, {
    method: 'POST', headers: hj(soBrindesToken),
    body: JSON.stringify({ brand: 'debacco', withdrawnByName: 'Fulano', items: [{ catalogItemId: catalogItem.id, item: catalogItem.item, quantidade: 1 }] })
  });
  check('quem só tem permissão de Brindes (sem retiradasInternas) NÃO consegue criar retirada', retiradaPorSoBrindes.status === 403);

  const logPorSoBrindes = await fetch(`${BASE}/api/brindes/log`, {
    method: 'POST', headers: hj(soBrindesToken),
    body: JSON.stringify({ brand: 'debacco', items: [{ catalogItemId: catalogItem.id, quantidade: 1 }] })
  });
  check('quem só tem permissão de Brindes CONSEGUE registrar uma saída (Catálogo/Log continuam com a MESMA permissão de sempre)', logPorSoBrindes.status === 200);

  const logPorSoRetiradas = await fetch(`${BASE}/api/brindes/log`, {
    method: 'POST', headers: hj(soRetiradasToken),
    body: JSON.stringify({ brand: 'debacco', items: [{ catalogItemId: catalogItem.id, quantidade: 1 }] })
  });
  check('quem só tem permissão de Retiradas Internas (sem brindes) NÃO consegue registrar saída', logPorSoRetiradas.status === 403);

  // ---------- 3) Registro de Saída multi-item: desconto em cascata por item ----------
  const catalogA = await fetch(`${BASE}/api/brindes/catalog`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ brand: 'ghelplus', item: 'Caneta Multi 88', estoquePR: 5, estoqueSP: 5, estoquePE: 5 })
  }).then((r) => r.json()).then((d) => d.item);
  const catalogB = await fetch(`${BASE}/api/brindes/catalog`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ brand: 'ghelplus', item: 'Boné Multi 88', estoquePR: 2, estoqueSP: 0, estoquePE: 0 })
  }).then((r) => r.json()).then((d) => d.item);

  const saidaMulti = await fetch(`${BASE}/api/brindes/log`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({
      brand: 'ghelplus', date: '2026-10-05', representante: 'Rep Teste', cliente: 'Cliente Teste', motivo: 'Teste multi-item',
      items: [{ catalogItemId: catalogA.id, quantidade: 7 }, { catalogItemId: catalogB.id, quantidade: 2 }]
    })
  }).then((r) => r.json()).then((d) => d.item);
  check('saída com 2 itens foi criada com a lista "items" (não mais item único)', Array.isArray(saidaMulti.items) && saidaMulti.items.length === 2);

  const catalogAAposSaida = await fetch(`${BASE}/api/brindes/catalog?brand=ghelplus`, { headers: hj(adminToken) })
    .then((r) => r.json()).then((d) => d.items.find((it) => it.id === catalogA.id));
  // 5 PR + 5 SP + 5 PE = 15 no total; pediu 7 -> cascata PR(5) + SP(2), PE intacto.
  check('item A: cascata tirou PR inteiro (5->0) e parte do SP (5->3)', catalogAAposSaida.estoquePR === 0 && catalogAAposSaida.estoqueSP === 3 && catalogAAposSaida.estoquePE === 5);

  const catalogBAposSaida = await fetch(`${BASE}/api/brindes/catalog?brand=ghelplus`, { headers: hj(adminToken) })
    .then((r) => r.json()).then((d) => d.items.find((it) => it.id === catalogB.id));
  check('item B: só tinha 2 no PR, desconto exato (2->0)', catalogBAposSaida.estoquePR === 0);

  // Exclui o registro -> precisa devolver TUDO que foi descontado, item por item.
  const delRes = await fetch(`${BASE}/api/brindes/log/${saidaMulti.id}`, { method: 'DELETE', headers: hj(adminToken) });
  check('excluir a saída multi-item respondeu ok', delRes.status === 200);
  const catalogAApósExcluir = await fetch(`${BASE}/api/brindes/catalog?brand=ghelplus`, { headers: hj(adminToken) })
    .then((r) => r.json()).then((d) => d.items.find((it) => it.id === catalogA.id));
  check('excluir devolveu o estoque do item A por inteiro (PR=5, SP=5, PE=5)', catalogAApósExcluir.estoquePR === 5 && catalogAApósExcluir.estoqueSP === 5 && catalogAApósExcluir.estoquePE === 5);
  const catalogBApósExcluir = await fetch(`${BASE}/api/brindes/catalog?brand=ghelplus`, { headers: hj(adminToken) })
    .then((r) => r.json()).then((d) => d.items.find((it) => it.id === catalogB.id));
  check('excluir devolveu o estoque do item B por inteiro (PR=2)', catalogBApósExcluir.estoquePR === 2);

  // Edição: troca a lista de itens -> desfaz a antiga, aplica a nova do zero.
  const saidaParaEditar = await fetch(`${BASE}/api/brindes/log`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ brand: 'ghelplus', items: [{ catalogItemId: catalogA.id, quantidade: 3 }] })
  }).then((r) => r.json()).then((d) => d.item);
  const putRes = await fetch(`${BASE}/api/brindes/log/${saidaParaEditar.id}`, {
    method: 'PUT', headers: hj(adminToken),
    body: JSON.stringify({ items: [{ catalogItemId: catalogB.id, quantidade: 1 }] })
  });
  const saidaEditada = await putRes.json().then((d) => d.item);
  check('editar a saída trocou a lista de itens (agora só o item B)', Array.isArray(saidaEditada.items) && saidaEditada.items.length === 1 && saidaEditada.items[0].catalogItemId === catalogB.id);
  const catalogAAposEdicao = await fetch(`${BASE}/api/brindes/catalog?brand=ghelplus`, { headers: hj(adminToken) })
    .then((r) => r.json()).then((d) => d.items.find((it) => it.id === catalogA.id));
  check('editar devolveu o estoque do item A (não é mais usado nessa saída)', catalogAAposEdicao.estoquePR === 5);
  await fetch(`${BASE}/api/brindes/log/${saidaEditada.id}`, { method: 'DELETE', headers: hj(adminToken) }); // limpeza

  // ---------- 4) Link externo do Registro de Saídas ----------
  const linkLeitura = await fetch(`${BASE}/api/brindes/log/public-link/generate`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'debacco', mode: 'leitura' })
  }).then((r) => r.json());
  check('gerou link de leitura pro Registro de Saídas (De Bacco)', !!linkLeitura.publicToken);

  const resolveLeitura = await fetch(`${BASE}/api/share-links/resolve/${linkLeitura.publicToken}`).then((r) => r.json());
  check('resolver o link devolve resource "brindesSaidas" com rótulo em PT', resolveLeitura.resource === 'brindesSaidas' && resolveLeitura.resourceLabel === 'Registro de Saídas');

  const publicLeituraRes = await fetch(`${BASE}/api/brindes/log/public/${linkLeitura.publicToken}`);
  const publicLeituraBody = await publicLeituraRes.json();
  check('GET do link em modo leitura devolve a lista de saídas da marca', publicLeituraRes.status === 200 && Array.isArray(publicLeituraBody.items));

  const tentaCriarViaLeitura = await fetch(`${BASE}/api/brindes/log/public/${linkLeitura.publicToken}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'Visitante', items: [{ catalogItemId: catalogItem.id, quantidade: 1 }] })
  });
  check('tentar REGISTRAR via link de leitura é bloqueado (403)', tentaCriarViaLeitura.status === 403);

  const linkEdicao = await fetch(`${BASE}/api/brindes/log/public-link/generate`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'debacco', mode: 'edicao' })
  }).then((r) => r.json());
  check('gerou link de edição pro Registro de Saídas (De Bacco)', !!linkEdicao.publicToken);

  const semNome = await fetch(`${BASE}/api/brindes/log/public/${linkEdicao.publicToken}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ catalogItemId: catalogItem.id, quantidade: 1 }] })
  });
  check('registrar sem informar o nome é rejeitado', semNome.status === 400);

  const itemDaOutraMarca = await fetch(`${BASE}/api/brindes/catalog`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ brand: 'ghelplus', item: 'Item GhelPlus 88', estoquePR: 10, estoqueSP: 0, estoquePE: 0 })
  }).then((r) => r.json()).then((d) => d.item);
  const itemMarcaErrada = await fetch(`${BASE}/api/brindes/log/public/${linkEdicao.publicToken}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'Visitante Teste', items: [{ catalogItemId: itemDaOutraMarca.id, quantidade: 1 }] })
  });
  check('registrar com item de outra marca (via link de De Bacco) é rejeitado', itemMarcaErrada.status === 400);

  const estoqueAntesVisitante = await fetch(`${BASE}/api/brindes/catalog?brand=debacco`, { headers: hj(adminToken) })
    .then((r) => r.json()).then((d) => d.items.find((it) => it.id === catalogItem.id));
  const criaViaLinkEdicao = await fetch(`${BASE}/api/brindes/log/public/${linkEdicao.publicToken}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'Visitante Teste', representante: 'Rep Externo', cliente: 'Cliente Externo', items: [{ catalogItemId: catalogItem.id, quantidade: 2 }] })
  });
  const criaViaLinkEdicaoBody = await criaViaLinkEdicao.json();
  check('registrar saída pelo link de edição funciona (sem login)', criaViaLinkEdicao.status === 200);
  check('registro criado pelo link marca "(nome) via link externo"', criaViaLinkEdicaoBody.item && /Visitante Teste \(via link externo\)/.test(criaViaLinkEdicaoBody.item.createdByName));
  const estoqueDepoisVisitante = await fetch(`${BASE}/api/brindes/catalog?brand=debacco`, { headers: hj(adminToken) })
    .then((r) => r.json()).then((d) => d.items.find((it) => it.id === catalogItem.id));
  check('saída registrada pelo link de edição descontou do estoque de verdade', (estoqueAntesVisitante.estoqueTotal - estoqueDepoisVisitante.estoqueTotal) === 2);

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;

  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(process.exitCode);
}

run().catch((e) => {
  console.error(e);
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(1);
});
