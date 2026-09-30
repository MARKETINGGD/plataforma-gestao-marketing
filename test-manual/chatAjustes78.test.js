// Teste de integração (servidor de verdade) da 78ª rodada -- pedidos
// explícitos da Raquel sobre o Chat da Equipe:
//
//   1. "Aviso de menção direcionado" -- ao marcar "@Fulano" numa mensagem
//      (Geral, grupo ou DM), só quem foi de fato mencionado recebe um
//      recado avisando; ninguém mais na conversa recebe nada, e quem
//      mandou a mensagem não recebe aviso de ter se mencionado.
//   2. "Apagar mensagem com rastro 'mensagem apagada'" -- apagar não
//      remove a mensagem de vez (antes sumia sem deixar rastro); ela
//      continua na lista marcada como `deleted`, sem o texto original.
//   3. "Buscar mensagem dentro da conversa" -- nova rota
//      GET /conversations/:id/search, restrita a quem participa da
//      conversa, ignorando mensagens apagadas e "chamar atenção".
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-chat-ajustes-78';
process.env.PORT = '4340';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4340';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-chat-ajustes-78-test');
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

  const BASE = 'http://localhost:4340';

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
  async function createUser(username, name) {
    const res = await fetch(`${BASE}/api/auth/users`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ username, password: '123456', name, cargo: 'analista' })
    }).then((r) => r.json());
    return res.user;
  }
  const ana = await createUser('anachat78', 'Ana Chat78');
  const bia = await createUser('biachat78', 'Bia Chat78');
  const cau = await createUser('cauchat78', 'Cau Chat78');
  check('3 usuários de teste criados', !!(ana && bia && cau));

  const adminId = (await fetch(`${BASE}/api/auth/me`, { headers: h(adminToken) }).then((r) => r.json())).user.id;
  const anaToken = await login('anachat78', '123456');
  const biaToken = await login('biachat78', '123456');
  const cauToken = await login('cauchat78', '123456');

  function recadosFor(token) {
    return fetch(`${BASE}/api/recados/for-me`, { headers: h(token) }).then((r) => r.json()).then((d) => d.recados);
  }

  // Cria um grupo com admin + ana + bia + cau, pra testar menção e busca
  // fora do mural Geral (mais fiel ao pedido: menção deve funcionar em
  // qualquer conversa, não só no mural principal).
  const groupRes = await fetch(`${BASE}/api/chat/conversations`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ type: 'group', name: 'Grupo Teste 78', participantIds: [ana.id, bia.id, cau.id] })
  }).then((r) => r.json());
  const groupId = groupRes.conversation && groupRes.conversation.id;
  check('grupo de teste criado', !!groupId);

  // ---------- 1. Aviso de menção direcionado ----------
  const beforeAna = await recadosFor(anaToken);
  const beforeBia = await recadosFor(biaToken);
  const beforeCau = await recadosFor(cauToken);
  const beforeAdmin = await recadosFor(adminToken);

  const mentionMsg = await fetch(`${BASE}/api/chat/conversations/${groupId}/messages`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ text: `Bom dia @${ana.name}, dá uma olhada nisso` })
  }).then((r) => r.json()).then((d) => d.message);
  check('mensagem com menção reconheceu a Ana', (mentionMsg.mentionedUserIds || []).includes(ana.id));

  await new Promise((r) => setTimeout(r, 150));
  const afterAna = await recadosFor(anaToken);
  const afterBia = await recadosFor(biaToken);
  const afterCau = await recadosFor(cauToken);
  const afterAdmin = await recadosFor(adminToken);

  check('Ana (mencionada) recebeu um recado novo de menção', afterAna.length === beforeAna.length + 1 && /mencionou/.test(afterAna[afterAna.length - 1].text));
  check('Bia (não mencionada, só participa do grupo) NÃO recebeu recado nenhum', afterBia.length === beforeBia.length);
  check('Cau (não mencionado) NÃO recebeu recado nenhum', afterCau.length === beforeCau.length);
  check('Admin (quem mandou a mensagem) não recebeu recado por ter mencionado alguém', afterAdmin.length === beforeAdmin.length);
  check('texto do recado de menção cita o grupo certo', afterAna[afterAna.length - 1].text.includes('Grupo Teste 78'));

  // Mensagem sem menção nenhuma não deve gerar recado pra ninguém.
  await fetch(`${BASE}/api/chat/conversations/${groupId}/messages`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ text: 'Mensagem qualquer, sem marcar ninguém' })
  });
  await new Promise((r) => setTimeout(r, 150));
  const afterPlain = await recadosFor(anaToken);
  check('mensagem sem @menção não gera recado novo', afterPlain.length === afterAna.length);

  // ---------- 2. Apagar mensagem com rastro "mensagem apagada" ----------
  const toDelete = await fetch(`${BASE}/api/chat/conversations/${groupId}/messages`, {
    method: 'POST', headers: hj(biaToken), body: JSON.stringify({ text: 'Mensagem que vou apagar em seguida' })
  }).then((r) => r.json()).then((d) => d.message);

  const deleteForbidden = await fetch(`${BASE}/api/chat/messages/${toDelete.id}`, { method: 'DELETE', headers: h(cauToken) });
  check('quem NÃO escreveu a mensagem (e não é admin) não consegue apagar (403)', deleteForbidden.status === 403);

  const deleteRes = await fetch(`${BASE}/api/chat/messages/${toDelete.id}`, { method: 'DELETE', headers: h(biaToken) });
  check('dona da mensagem consegue apagar (200)', deleteRes.status === 200);

  const afterDeleteList = await fetch(`${BASE}/api/chat/conversations/${groupId}/messages`, { headers: h(adminToken) }).then((r) => r.json());
  const deletedMsg = afterDeleteList.messages.find((m) => m.id === toDelete.id);
  check('mensagem apagada continua na lista (não sumiu sem rastro)', !!deletedMsg);
  check('mensagem apagada vem marcada como deleted:true', !!(deletedMsg && deletedMsg.deleted === true));
  check('texto original não aparece mais pra ninguém (nem pro admin)', !!(deletedMsg && deletedMsg.text === ''));

  // ---------- 3. Buscar mensagem dentro da conversa ----------
  await fetch(`${BASE}/api/chat/conversations/${groupId}/messages`, {
    method: 'POST', headers: hj(cauToken), body: JSON.stringify({ text: 'Onde está o relatório de outubro?' })
  });
  await fetch(`${BASE}/api/chat/conversations/${groupId}/messages`, {
    method: 'POST', headers: hj(anaToken), body: JSON.stringify({ text: 'Já mandei o relatório por email' })
  });

  const searchRes = await fetch(`${BASE}/api/chat/conversations/${groupId}/search?q=relatório`, { headers: h(adminToken) }).then((r) => r.json());
  check('busca por "relatório" achou as 2 mensagens que citam a palavra', (searchRes.messages || []).length === 2);

  const searchNoMatch = await fetch(`${BASE}/api/chat/conversations/${groupId}/search?q=xyzxyznaoexiste`, { headers: h(adminToken) }).then((r) => r.json());
  check('busca sem resultado devolve lista vazia (não erro)', Array.isArray(searchNoMatch.messages) && searchNoMatch.messages.length === 0);

  const searchDeleted = await fetch(`${BASE}/api/chat/conversations/${groupId}/search?q=apagar em seguida`, { headers: h(adminToken) }).then((r) => r.json());
  check('busca não acha texto de mensagem já apagada', (searchDeleted.messages || []).length === 0);

  const searchForbidden = await fetch(`${BASE}/api/chat/conversations/${groupId}/search?q=relatório`, {});
  check('busca exige login (401 sem token)', searchForbidden.status === 401);

  // Quem NÃO participa do grupo não pode buscar dentro dele.
  const outsider = await createUser('foraddogrupo78', 'Fora Do Grupo 78');
  const outsiderToken = await login('foraddogrupo78', '123456');
  const searchOutsider = await fetch(`${BASE}/api/chat/conversations/${groupId}/search?q=relatório`, { headers: h(outsiderToken) });
  check('quem não participa do grupo não pode buscar nele (403)', searchOutsider.status === 403);

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
