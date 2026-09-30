// Teste de integração (servidor de verdade, mesmo padrão de
// agendamentoReformaAvisos.test.js) da 79ª rodada, pedido direto da
// Raquel: "Raquel, é admim, mas o cargo é coordenadora, use sempre o
// cargo para falar sobre as aprovações no lembretes. por que esta
// aparecendo admim".
//
// A 63ª rodada ("Rodada E") já tinha implementado "aprovado por (cargo)"
// nos avisos automáticos, mas quem aprovava logado com
// `role:'super_admin'` (a única conta com acesso total à Plataforma --
// no caso, a própria Raquel) sempre aparecia como "Administrador(a)" no
// aviso, ignorando o cargo de verdade cadastrado no perfil dela
// (coordenadora). `role` é o nível de acesso dentro da Papoi; `cargo` é
// a função da pessoa na empresa -- são coisas diferentes, e o aviso deve
// falar sempre do cargo. Este teste confirma que agora, mesmo logada
// como admin/super_admin, o aviso usa o cargo cadastrado no perfil.
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-aprovacao-cargo-admin';
process.env.PORT = '4328';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4328';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-aprovacao-cargo-admin-test');
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

  const BASE = 'http://localhost:4328';

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

  const me = await fetch(`${BASE}/api/auth/me`, { headers: hj(adminToken) }).then((r) => r.json());
  const adminUser = me.user;
  check('conta logada é super_admin (mesmo caso da Raquel na Papoi real)', adminUser && adminUser.isSuperAdmin === true);

  // Cadastra o cargo de verdade da Raquel no perfil -- exatamente o que
  // ela pediu: "é admim, mas o cargo é coordenadora".
  const cargoRes = await fetch(`${BASE}/api/auth/users/${adminUser.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ cargo: 'coordenador' })
  }).then((r) => r.json());
  check('cargo "coordenador" salvo no perfil do admin', cargoRes.user && cargoRes.user.cargo === 'coordenador');

  // Cria uma analista (dona do post) pra receber o aviso de aprovação.
  const analista = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'analista79', password: '123456', name: 'Analista Teste', cargo: 'analista' })
  }).then((r) => r.json()).then((d) => d.user);
  const analistaToken = await login('analista79', '123456');

  // Post pronto pra aprovação (Storie -- só precisa do arquivo, sem legenda).
  const post = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({
      brand: 'ghelplus', platform: 'instagram', postType: 'storie', status: 'rascunho',
      scheduledDate: '2020-01-01', scheduledTime: '08:00',
      involvedUserIds: [analista.id], responsibleId: analista.id
    })
  }).then((r) => r.json()).then((d) => d.post);
  const db = require('../db');
  db.get('socialPosts').find({ id: post.id }).assign({
    files: [{ id: 'f1', url: '/uploads/social/x/creative/foto-storie.jpg', name: 'foto-storie.jpg' }]
  }).write();
  // Reedita (PUT) pra disparar o aviso de "pronto pra aprovar" (mesmo
  // padrão do teste da 63ª rodada -- o aviso dispara na edição, não na
  // criação).
  await fetch(`${BASE}/api/social-posts/${post.id}`, {
    method: 'PUT', headers: hj(analistaToken), body: JSON.stringify({ scheduledTime: '09:00' })
  });

  // A PRÓPRIA RAQUEL (super_admin, cargo coordenador) aprova o post --
  // este é o cenário exato do print: ela loga como "admin" mas o cargo
  // dela é coordenadora.
  const approvalRes = await fetch(`${BASE}/api/social-posts/${post.id}/approval`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ approvalStatus: 'aprovado' })
  }).then((r) => r.json());
  check('aprovação processada com sucesso', approvalRes.post && approvalRes.post.status === 'agendado');

  // O texto "aprovado por (cargo)" atualiza o PRÓPRIO aviso de "aguardando
  // aprovação" -- que é endereçado a quem PODE aprovar (admin/gerente/
  // coordenador), não à dona do post (ver updateAutoRecadosForPost/
  // notifyReadyForApproval em routes/socialPosts.js). É exatamente o
  // cenário do print da Raquel: ela mesma, como aprovadora, vendo esse
  // aviso na própria lista de lembretes.
  const adminRecados = await fetch(`${BASE}/api/recados/for-me`, { headers: hj(adminToken) }).then((r) => r.json()).then((d) => d.recados);
  const approvedMsg = adminRecados.find((r) => r.sourceSocialPostId === post.id && /aprovado por/i.test(r.text || ''));
  check('quem aprova (a própria Raquel) recebeu o aviso atualizado de "aprovado por"', !!approvedMsg);
  if (approvedMsg) {
    check('aviso diz "aprovado por Coordenador(a)" (o CARGO de verdade)', /aprovado por coordenador\(a\)/i.test(approvedMsg.text));
    check('aviso NÃO diz mais "Administrador(a)" (o nível de acesso, não o cargo)', !/administrador/i.test(approvedMsg.text));
    check('aviso menciona o nome da pessoa que aprovou (Raquel)', approvedMsg.text.includes(adminUser.name));
  }

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
