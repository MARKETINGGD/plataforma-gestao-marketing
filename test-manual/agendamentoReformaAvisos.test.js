// Teste de integração (servidor de verdade, mesmo padrão de
// publicarAgora.test.js/callback-endpoint.test.js) da 63ª rodada
// ("Rodada E" da Pendência 51) -- reforma dos avisos/status do
// Agendamento de Redes Sociais, pedido grande da Raquel dentro da lista
// de 13 itens da 58ª rodada:
//
//   1. Posts agendados/aprovados notificam só a dona do post (estrelinha).
//   2. Posts publicados notificam dona do post + coordenadora + gerente,
//      com o link (quando existir).
//   3. Posts com legenda+arquivo final (ou só arquivo final pra Storie)
//      notificam só coordenadora/gerente, pedindo aprovação.
//   4. Ao aprovar, esse aviso de pedido de aprovação ATUALIZA pra
//      "aprovado por (cargo)", visível só pra coordenadora/gerente (não
//      cria um aviso solto novo).
//   5. Status sobe sozinho de Rascunho pra Agendado ao aprovar (a ponta
//      Agendado→Publicado na hora certa já existia desde a 55ª rodada,
//      só pras combinações que a Papoi publica sozinha).
//   6. Publicar (manual ou automático) continua completando/arquivando a
//      Demanda ligada pra todo mundo envolvido (já existia, só confirma
//      que não quebrou).
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-agendamento-reforma-avisos';
process.env.PORT = '4327';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4327';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-agendamento-reforma-avisos-test');
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

  const BASE = 'http://localhost:4327';

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

  async function createUser(username, name, cargo) {
    const res = await fetch(`${BASE}/api/auth/users`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ username, password: '123456', name, cargo })
    }).then((r) => r.json());
    return res.user;
  }
  const gerente = await createUser('gerenteteste', 'Gerente Teste', 'gerente');
  const coord = await createUser('coordteste', 'Coordenadora Teste', 'coordenador');
  const analista = await createUser('analistateste', 'Analista Teste', 'analista');
  check('3 usuários de teste criados (gerente/coordenador/analista)', !!(gerente && coord && analista));

  const gerenteToken = await login('gerenteteste', '123456');
  const coordToken = await login('coordteste', '123456');
  const analistaToken = await login('analistateste', '123456');

  function h(token) { return { Authorization: `Bearer ${token}` }; }
  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }
  function recadosFor(token) {
    return fetch(`${BASE}/api/recados/for-me`, { headers: h(token) }).then((r) => r.json()).then((d) => d.recados);
  }

  // ---------- 1, 3, 4, 5: Storie (só precisa de arquivo, sem legenda),
  // dono = analista, envolve gerente também. ----------
  const post1 = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({
      platform: 'instagram', brand: 'debacco', scheduledDate: '2026-12-31',
      postType: 'storie', status: 'rascunho',
      involvedUserIds: [analista.id, gerente.id], responsibleId: analista.id,
      link: 'https://example.com/promo', subject: 'Teste Storie Rodada E'
    })
  }).then((r) => r.json()).then((d) => d.post);
  check('post 1 (Storie) criado como rascunho', post1.status === 'rascunho');

  const db = require('../db');
  db.get('socialPosts').find({ id: post1.id }).assign({
    files: [{ id: 'f1', url: '/uploads/social/x/creative/story.jpg', name: 'story.jpg', uploadedBy: analista.id }]
  }).write();
  // Dispara notifyReadyForApproval de novo com um PUT qualquer (mesmo
  // gatilho usado sempre que o post é editado com legenda+arte prontos).
  await fetch(`${BASE}/api/social-posts/${post1.id}`, { method: 'PUT', headers: hj(analistaToken), body: JSON.stringify({}) });

  const gerenteRecados1 = await recadosFor(gerenteToken);
  const coordRecados1 = await recadosFor(coordToken);
  const analistaRecados1 = await recadosFor(analistaToken);
  const readyGerente = gerenteRecados1.filter((r) => r.sourceSocialPostId === post1.id && r.kind === 'post_ready_for_approval');
  const readyCoord = coordRecados1.filter((r) => r.sourceSocialPostId === post1.id && r.kind === 'post_ready_for_approval');
  check('gerente avisada de "pronto pra aprovar" (Storie, só com arquivo, sem legenda)', readyGerente.length === 1);
  check('aviso de Storie fala em "Story", não exige legenda', readyGerente[0] && /story/i.test(readyGerente[0].text));
  check('coordenadora também avisada', readyCoord.length === 1);
  check('dona do post (analista) NÃO recebe nada antes da aprovação', analistaRecados1.filter((r) => r.sourceSocialPostId === post1.id).length === 0);

  const approvalRes = await fetch(`${BASE}/api/social-posts/${post1.id}/approval`, {
    method: 'PUT', headers: hj(gerenteToken), body: JSON.stringify({ approvalStatus: 'aprovado' })
  }).then((r) => r.json());
  check('status sobe sozinho de Rascunho pra Agendado ao aprovar', approvalRes.post.status === 'agendado');

  const gerenteRecados2 = await recadosFor(gerenteToken);
  const updatedReady = gerenteRecados2.filter((r) => r.sourceSocialPostId === post1.id && r.kind === 'post_ready_for_approval');
  check('o MESMO aviso de "pronto pra aprovar" foi atualizado (não duplicado)', updatedReady.length === 1);
  check('texto atualizado diz "aprovado por" com o cargo (Gerente)', updatedReady[0] && /aprovado por gerente/i.test(updatedReady[0].text));

  const analistaRecados2 = await recadosFor(analistaToken);
  const approvedForOwner = analistaRecados2.filter((r) => r.sourceSocialPostId === post1.id && r.kind === 'post_approved');
  check('dona do post (analista) recebeu o aviso de aprovado', approvedForOwner.length === 1);
  check('aviso de aprovado menciona que já está agendado', approvedForOwner[0] && /agendado/i.test(approvedForOwner[0].text));

  const gerenteRecadosCheck = gerenteRecados2.filter((r) => r.sourceSocialPostId === post1.id && r.kind === 'post_approved');
  check('gerente (não é a dona do post) NÃO recebe o aviso de "seu post foi aprovado"', gerenteRecadosCheck.length === 0);

  // ---------- 2, 6: publicação manual (TikTok, fora do escopo da Meta)
  // notifica dona do post + coordenadora + gerente, e ainda arquiva a
  // Demanda ligada pra todo mundo envolvido. ----------
  const post2 = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({
      platform: 'tiktok', brand: 'debacco', scheduledDate: '2026-12-31',
      postType: 'video_tiktok', status: 'agendado',
      involvedUserIds: [analista.id], responsibleId: analista.id,
      subject: 'Teste TikTok Rodada E'
    })
  }).then((r) => r.json()).then((d) => d.post);
  db.get('socialPosts').find({ id: post2.id }).assign({
    files: [{ id: 'f1', url: '/uploads/social/x/creative/video.mp4', name: 'video.mp4', uploadedBy: analista.id }]
  }).write();
  const publishRes = await fetch(`${BASE}/api/social-posts/${post2.id}`, {
    method: 'PUT', headers: hj(analistaToken), body: JSON.stringify({ status: 'publicado' })
  }).then((r) => r.json());
  check('TikTok marcado como publicado manualmente (fora do escopo da Meta, continua manual)', publishRes.post.status === 'publicado');

  const gerentePub = (await recadosFor(gerenteToken)).filter((r) => r.sourceSocialPostId === post2.id && r.kind === 'post_published');
  const coordPub = (await recadosFor(coordToken)).filter((r) => r.sourceSocialPostId === post2.id && r.kind === 'post_published');
  const analistaPub = (await recadosFor(analistaToken)).filter((r) => r.sourceSocialPostId === post2.id && r.kind === 'post_published');
  check('gerente notificada na publicação', gerentePub.length === 1);
  check('coordenadora notificada na publicação', coordPub.length === 1);
  check('dona do post notificada na publicação', analistaPub.length === 1);

  const demandas = await fetch(`${BASE}/api/demandas?archived=true`, { headers: h(adminToken) }).then((r) => r.json()).then((d) => d.demandas);
  const linkedDemanda = demandas.find((d) => d.title && d.title.includes('Teste TikTok Rodada E'));
  check('Demanda ligada ao post publicado foi concluída/arquivada automaticamente', !!linkedDemanda && linkedDemanda.status === 'concluida' && linkedDemanda.archived === true);

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
