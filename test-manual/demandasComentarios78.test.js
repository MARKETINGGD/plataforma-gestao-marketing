// Teste de integração (servidor de verdade) da 78ª rodada -- pedido da
// Raquel: "no card, deve ter a opção de por comentários que ficam no
// histórico dele". Implementado como só mais um tipo de entrada no MESMO
// histórico (auditLog) que já existia (ver GET /:id/history) -- sem
// coleção nova nem tela separada.
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-demandas-comentarios-78';
process.env.PORT = '4342';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4342';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-demandas-comentarios-78-test');
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

  const BASE = 'http://localhost:4342';

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
  const fora = await createUser('foracoment78', 'Fora Coment78');
  const foraToken = await login('foracoment78', '123456');

  const demanda = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ title: 'Card pra comentar', visibility: 'geral', assigneeIds: [], })
  }).then((r) => r.json()).then((d) => d.demanda);
  // Card do quadro geral sem ninguém marcado é rejeitado (responsável
  // obrigatório) -- ajusta pra ter um responsável válido.
  let demandaOk = demanda;
  if (!demanda.id) {
    demandaOk = await fetch(`${BASE}/api/demandas`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ title: 'Card pra comentar', visibility: 'geral', assigneeIds: [fora.id], responsibleId: fora.id })
    }).then((r) => r.json()).then((d) => d.demanda);
  }
  check('demanda de teste criada', !!demandaOk.id);

  const emptyComment = await fetch(`${BASE}/api/demandas/${demandaOk.id}/comments`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ text: '   ' })
  });
  check('comentário vazio é rejeitado (400)', emptyComment.status === 400);

  const c1 = await fetch(`${BASE}/api/demandas/${demandaOk.id}/comments`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ text: 'Primeiro comentário do admin' })
  });
  check('admin consegue comentar (200)', c1.status === 200);

  const c2 = await fetch(`${BASE}/api/demandas/${demandaOk.id}/comments`, {
    method: 'POST', headers: hj(foraToken), body: JSON.stringify({ text: 'Comentário de quem está marcado no card' })
  });
  check('quem está marcado no card também consegue comentar', c2.status === 200);

  const history = await fetch(`${BASE}/api/demandas/${demandaOk.id}/history`, { headers: h(adminToken) }).then((r) => r.json()).then((d) => d.history);
  const comments = history.filter((e) => e.action === 'comment');
  check('os 2 comentários aparecem no histórico do card', comments.length === 2);
  check('histórico guarda o texto certo do 1º comentário', comments.some((c) => c.details === 'Primeiro comentário do admin'));
  check('histórico guarda o texto certo do 2º comentário', comments.some((c) => c.details === 'Comentário de quem está marcado no card'));
  check('comentário do admin mostra o nome de quem comentou', comments.find((c) => c.details === 'Primeiro comentário do admin').userName === 'Admin Teste');

  // Quem não tem acesso ao card (demanda pessoal de outra pessoa) não pode comentar.
  const dono = await createUser('donopessoal78', 'Dono Pessoal 78');
  const donoToken = await login('donopessoal78', '123456');
  const pessoal = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(donoToken),
    body: JSON.stringify({ title: 'Card pessoal privado', visibility: 'pessoal' })
  }).then((r) => r.json()).then((d) => d.demanda);
  const comentarioAlheio = await fetch(`${BASE}/api/demandas/${pessoal.id}/comments`, {
    method: 'POST', headers: hj(foraToken), body: JSON.stringify({ text: 'Tentando comentar sem acesso' })
  });
  check('quem não tem acesso a um card pessoal não consegue comentar nele (403)', comentarioAlheio.status === 403);

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
