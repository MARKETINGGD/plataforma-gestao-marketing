// Teste de integração (servidor de verdade) da 78ª rodada -- pedidos
// explícitos da Raquel sobre avisos do Agendamento, feitos depois da
// reforma da 63ª rodada:
//
//   1. "Ao reprovar um post, deve vir um aviso para a dona ou dono da
//      demanda, dizendo que o post foi reprovado." (antes: reprovar não
//      disparava nenhum recado).
//   2. "O aviso de pedido de aprovação deve vir apenas para quem vai
//      aprovar (admin, gerente e coordenador)." (antes: só cargo
//      gerente/coordenador, sem incluir o admin da Plataforma).
//   3. "Avisa quem é o responsável marcado com estrela, não avisa nenhum
//      envolvido além do responsável geral, que o post foi aprovado."
//      (antes: sem responsável marcado, caía num fallback que avisava
//      quem criou + todo mundo envolvido -- removido, já que responsável
//      é obrigatório em todo post novo desde esta mesma rodada).
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-agendamento-avisos-responsavel';
process.env.PORT = '4336';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4336';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-agendamento-avisos-responsavel-test');
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

  const BASE = 'http://localhost:4336';

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
  async function createUser(username, name, cargo) {
    const res = await fetch(`${BASE}/api/auth/users`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ username, password: '123456', name, cargo })
    }).then((r) => r.json());
    return res.user;
  }
  const gerente = await createUser('gerenteavr', 'Gerente AVR', 'gerente');
  const coord = await createUser('coordavr', 'Coordenadora AVR', 'coordenador');
  const dona = await createUser('donaavr', 'Dona Do Post AVR', 'analista');
  const outraEnvolvida = await createUser('outraavr', 'Outra Envolvida AVR', 'analista');
  check('4 usuários de teste criados', !!(gerente && coord && dona && outraEnvolvida));

  const gerenteToken = await login('gerenteavr', '123456');
  const coordToken = await login('coordavr', '123456');
  const donaToken = await login('donaavr', '123456');
  const outraToken = await login('outraavr', '123456');

  function h(token) { return { Authorization: `Bearer ${token}` }; }
  function recadosFor(token) {
    return fetch(`${BASE}/api/recados/for-me`, { headers: h(token) }).then((r) => r.json()).then((d) => d.recados);
  }

  const db = require('../db');

  // ---------- Post 1: aprovação ----------
  const post1 = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(donaToken),
    body: JSON.stringify({
      platform: 'blog', brand: 'debacco', scheduledDate: '2026-12-31', postType: 'estatico',
      status: 'rascunho', involvedUserIds: [dona.id, outraEnvolvida.id], responsibleId: dona.id,
      subject: 'Post Teste Avisos Responsável'
    })
  }).then((r) => r.json()).then((d) => d.post);
  check('post 1 criado com responsável = dona', post1 && post1.responsibleId === dona.id);

  // Deixa "pronto pra aprovar" (legenda + arte).
  db.get('socialPosts').find({ id: post1.id }).assign({
    caption: 'Legenda pronta', files: [{ id: 'f1', url: '/uploads/x/creative/foto.jpg', name: 'foto.jpg', uploadedBy: dona.id }]
  }).write();
  await fetch(`${BASE}/api/social-posts/${post1.id}`, { method: 'PUT', headers: hj(donaToken), body: JSON.stringify({}) });

  const gerenteReady = (await recadosFor(gerenteToken)).filter((r) => r.sourceSocialPostId === post1.id && r.kind === 'post_ready_for_approval');
  const coordReady = (await recadosFor(coordToken)).filter((r) => r.sourceSocialPostId === post1.id && r.kind === 'post_ready_for_approval');
  const adminReady = (await recadosFor(adminToken)).filter((r) => r.sourceSocialPostId === post1.id && r.kind === 'post_ready_for_approval');
  check('gerente avisada de "pronto pra aprovar"', gerenteReady.length === 1);
  check('coordenadora avisada de "pronto pra aprovar"', coordReady.length === 1);
  check('78ª rodada: admin da Plataforma TAMBÉM avisado de "pronto pra aprovar" (antes não era)', adminReady.length === 1);

  // Aprova.
  await fetch(`${BASE}/api/social-posts/${post1.id}/approval`, {
    method: 'PUT', headers: hj(gerenteToken), body: JSON.stringify({ approvalStatus: 'aprovado' })
  });
  const donaApproved = (await recadosFor(donaToken)).filter((r) => r.sourceSocialPostId === post1.id && r.kind === 'post_approved');
  const outraApproved = (await recadosFor(outraToken)).filter((r) => r.sourceSocialPostId === post1.id && r.kind === 'post_approved');
  check('responsável (dona) recebe o aviso de "post aprovado"', donaApproved.length === 1);
  check('78ª rodada: outra pessoa envolvida (não-responsável) NÃO recebe o aviso de aprovado', outraApproved.length === 0);

  // ---------- Post 2: reprovação ----------
  const post2 = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(donaToken),
    body: JSON.stringify({
      platform: 'blog', brand: 'debacco', scheduledDate: '2026-12-31', postType: 'estatico',
      status: 'rascunho', involvedUserIds: [dona.id, outraEnvolvida.id], responsibleId: dona.id,
      subject: 'Post Teste Reprovação'
    })
  }).then((r) => r.json()).then((d) => d.post);

  await fetch(`${BASE}/api/social-posts/${post2.id}/approval`, {
    method: 'PUT', headers: hj(coordToken),
    body: JSON.stringify({ approvalStatus: 'reprovado', approvalNotes: 'Trocar a foto de capa' })
  });
  const donaRejected = (await recadosFor(donaToken)).filter((r) => r.sourceSocialPostId === post2.id && r.kind === 'post_rejected');
  const outraRejected = (await recadosFor(outraToken)).filter((r) => r.sourceSocialPostId === post2.id && r.kind === 'post_rejected');
  check('78ª rodada: reprovar agora avisa o responsável (antes não avisava ninguém)', donaRejected.length === 1);
  check('aviso de reprovação inclui as alterações pedidas', donaRejected[0] && donaRejected[0].text.includes('Trocar a foto de capa'));
  check('outra pessoa envolvida (não-responsável) não recebe o aviso de reprovação', outraRejected.length === 0);

  // ---------- Post 3: "pronto pra aprovar" usa o critério de CADA REDE ----------
  // YouTube/Pinterest usam Assunto (não Legenda) como confirmação de
  // pronto -- diferente da regra genérica (legenda+arte) usada antes.
  const post3 = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(donaToken),
    body: JSON.stringify({
      platform: 'youtube', brand: 'ghelplus', scheduledDate: '2026-12-31', postType: 'video_youtube',
      status: 'rascunho', involvedUserIds: [dona.id], responsibleId: dona.id,
      caption: 'Legenda preenchida, mas isso não é o que conta pro YouTube'
    })
  }).then((r) => r.json()).then((d) => d.post);
  // Só legenda + arquivo, SEM assunto -- não deve disparar "pronto pra aprovar".
  db.get('socialPosts').find({ id: post3.id }).assign({
    files: [{ id: 'f1', url: '/uploads/x/creative/video.mp4', name: 'video.mp4', uploadedBy: dona.id }]
  }).write();
  await fetch(`${BASE}/api/social-posts/${post3.id}`, { method: 'PUT', headers: hj(donaToken), body: JSON.stringify({}) });
  const gerenteReadyPost3Antes = (await recadosFor(gerenteToken)).filter((r) => r.sourceSocialPostId === post3.id && r.kind === 'post_ready_for_approval');
  check('78ª rodada: YouTube com legenda+arquivo mas SEM assunto NÃO dispara "pronto pra aprovar"', gerenteReadyPost3Antes.length === 0);

  // Preenche o Assunto -- agora sim deve disparar.
  await fetch(`${BASE}/api/social-posts/${post3.id}`, { method: 'PUT', headers: hj(donaToken), body: JSON.stringify({ subject: 'Vídeo institucional' }) });
  const gerenteReadyPost3Depois = (await recadosFor(gerenteToken)).filter((r) => r.sourceSocialPostId === post3.id && r.kind === 'post_ready_for_approval');
  check('78ª rodada: YouTube com Assunto preenchido (+arquivo) dispara "pronto pra aprovar"', gerenteReadyPost3Depois.length === 1);

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
