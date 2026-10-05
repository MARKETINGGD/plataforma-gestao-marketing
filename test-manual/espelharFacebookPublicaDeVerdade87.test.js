// Teste de integração (servidor de verdade, mesmo padrão de
// publicarAgora.test.js e espelharFacebookManual86.test.js) da 87ª
// rodada, pedido direto da Raquel depois que expliquei que o botão
// "Espelhar no Facebook" (86ª rodada) nunca chamava a Meta de verdade --
// só copiava o `status` do post de Instagram pro espelho novo:
//
//   "se um post que ja foi postado no instagram e n foi espelhado, eu
//   clicar em espelhar, ele vai postar?" -> respondi que não.
//
//   "ajuste então para que, sempre que clicar em espelhar no facebook, se
//   ainda n foi postado no insta, que ele poste no face junto cm o
//   Insta. Caso ja tenha sido postado no insta, e ainda não no face, se
//   clicar em espelhar, ele deve postar."
//
// Agora POST /:id/espelhar-facebook tenta publicar de verdade na Meta
// (reaproveitando resolveAutoPublisher/publishOne -- mesma função usada
// em "marcar como Publicado" na mão, 11ª melhoria), tanto pro post de
// Instagram original (se ainda não tinha sido publicado) quanto pro
// espelho novo do Facebook (sempre).
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real, e monkeypatcha utils/metaGraphClient ANTES de
// subir o servidor pra não precisar de rede/credenciais reais (mesmo
// padrão de publicarAgora.test.js).
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-espelhar-facebook-publica-87';
process.env.PORT = '4347';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4347';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-espelhar-facebook-publica-87-test');
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

  const metaGraph = require('../utils/metaGraphClient');
  let calls = [];
  let shouldFailInstagram = false;
  let shouldFailFacebook = false;
  metaGraph.createInstagramMediaContainer = async (args) => {
    calls.push({ fn: 'createInstagramMediaContainer', args });
    if (shouldFailInstagram) throw new metaGraph.MetaGraphError('Falha simulada no Instagram.');
    return { id: 'container-ig-fake' };
  };
  metaGraph.waitForMediaContainerReady = async (args) => {
    calls.push({ fn: 'waitForMediaContainerReady', args });
  };
  metaGraph.publishInstagramMediaContainer = async (args) => {
    calls.push({ fn: 'publishInstagramMediaContainer', args });
    return { id: 'ig-post-fake' };
  };
  metaGraph.publishFacebookPagePost = async (args) => {
    calls.push({ fn: 'publishFacebookPagePost', args });
    if (shouldFailFacebook) throw new metaGraph.MetaGraphError('Falha simulada no Facebook.');
    return { post_id: 'fb-post-fake' };
  };
  metaGraph.getPermalink = async () => 'https://fake.example/permalink';

  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const BASE = 'http://localhost:4347';
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
  let adminId;
  if (statusRes.needsSetup) {
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Raquel', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
    adminId = setupRes.user && setupRes.user.id;
  } else {
    adminToken = await login('admin', '123456');
    const me = await fetch(`${BASE}/api/auth/me`, { headers: hj(adminToken) }).then((r) => r.json());
    adminId = me.user && me.user.id;
  }
  check('login/setup do admin devolveu token', !!adminToken);

  // Conta Meta conectada pra GhelPlus (igUserId + pageId juntos, como o
  // fluxo real de conexão grava), direto no banco -- bypassa OAuth de
  // verdade (já coberto em callback-endpoint.test.js).
  db.get('socialAccounts').push({
    id: 'acc-ghelplus-teste-87', brand: 'ghelplus', platform: 'meta',
    igUserId: 'ig-ghelplus-87', igUsername: 'ghelplus_oficial',
    pageId: 'page-ghelplus-87', pageAccessToken: 'page-token-fake-87',
    connectedAt: new Date().toISOString()
  }).write();

  function setFiles(id, files) {
    db.get('socialPosts').find({ id }).assign({ files }).write();
  }

  // Cria o post como "Instagram" só que SEM disparar o espelhamento
  // automático da criação (79ª rodada): cria direto como Facebook (nunca
  // espelha) e depois PUT troca a rede pra Instagram -- PUT nunca cria
  // espelho, só o POST de criação faz isso (mesmo truque usado em
  // espelharFacebookManual86.test.js). Sem isso, o post já nasceria com
  // mirroredToPostId preenchido e o endpoint /espelhar-facebook do teste
  // falharia com "já tem espelho".
  async function createIgPost(body) {
    const extra = Object.assign({}, body);
    const brand = extra.brand || 'ghelplus';
    delete extra.brand;
    const createRes = await fetch(`${BASE}/api/social-posts`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify(Object.assign({
        brand, platform: 'facebook', postType: 'estatico', status: 'agendado',
        scheduledDate: '2026-11-05', scheduledTime: '09:00', caption: 'Legenda de teste 87',
        involvedUserIds: [adminId], responsibleId: adminId
      }, extra))
    }).then((r) => r.json());
    const putRes = await fetch(`${BASE}/api/social-posts/${createRes.post.id}`, {
      method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ platform: 'instagram' })
    }).then((r) => r.json());
    return putRes.post;
  }

  // ---------- 1. Instagram AINDA não publicado -> espelhar deve publicar
  // os DOIS, juntos, de verdade. ----------
  calls = [];
  shouldFailInstagram = false;
  shouldFailFacebook = false;
  const post1 = await createIgPost({ subject: 'Caso 1 -- ainda não publicado' });
  setFiles(post1.id, [{ id: 'f1', url: '/uploads/social/x/creative/foto1.jpg', name: 'foto1.jpg' }]);
  const esp1Res = await fetch(`${BASE}/api/social-posts/${post1.id}/espelhar-facebook`, { method: 'POST', headers: hj(adminToken) });
  const esp1Body = await esp1Res.json();
  check('caso 1: responde 200', esp1Res.status === 200);
  check('caso 1: originalPublishResult.attempted = true (Instagram ainda não tinha sido publicado)', esp1Body.originalPublishResult && esp1Body.originalPublishResult.attempted === true);
  check('caso 1: originalPublishResult.published = true (publicou de verdade)', esp1Body.originalPublishResult && esp1Body.originalPublishResult.published === true);
  check('caso 1: mirrorPublishResult.published = true (o espelho também publicou de verdade)', esp1Body.mirrorPublishResult && esp1Body.mirrorPublishResult.published === true);
  check('caso 1: post original volta com status "publicado" de verdade', esp1Body.originalPost && esp1Body.originalPost.status === 'publicado');
  check('caso 1: espelho (Facebook) volta com status "publicado" de verdade', esp1Body.mirrorPost && esp1Body.mirrorPost.status === 'publicado');
  check('caso 1: chamou publishInstagramMediaContainer de verdade (Instagram realmente publicado)', calls.some((c) => c.fn === 'publishInstagramMediaContainer'));
  check('caso 1: chamou publishFacebookPagePost de verdade (Facebook realmente publicado)', calls.some((c) => c.fn === 'publishFacebookPagePost'));

  // ---------- 2. Instagram JÁ publicado antes, sem espelho -> espelhar
  // deve publicar SÓ o Facebook, sem tentar republicar o Instagram. ----------
  calls = [];
  shouldFailInstagram = false;
  shouldFailFacebook = false;
  const post2 = await createIgPost({ subject: 'Caso 2 -- Instagram já publicado' });
  setFiles(post2.id, [{ id: 'f1', url: '/uploads/social/x/creative/foto2.jpg', name: 'foto2.jpg' }]);
  // Marca como já publicado de verdade na mão (simula o cenário real: post
  // antigo que já saiu no Instagram antes do espelhamento existir).
  db.get('socialPosts').find({ id: post2.id }).assign({
    status: 'publicado', publishStatus: 'published', externalPostId: 'ig-post-ja-publicado'
  }).write();
  const esp2Res = await fetch(`${BASE}/api/social-posts/${post2.id}/espelhar-facebook`, { method: 'POST', headers: hj(adminToken) });
  const esp2Body = await esp2Res.json();
  check('caso 2: responde 200', esp2Res.status === 200);
  check('caso 2: originalPublishResult.attempted = false (Instagram já estava publicado, não tenta de novo)', esp2Body.originalPublishResult && esp2Body.originalPublishResult.attempted === false);
  check('caso 2: mirrorPublishResult.published = true (o Facebook publica agora, mesmo com o Instagram já no ar)', esp2Body.mirrorPublishResult && esp2Body.mirrorPublishResult.published === true);
  check('caso 2: NÃO chamou nenhuma função de publicar no Instagram (original não foi mexido)', !calls.some((c) => c.fn === 'createInstagramMediaContainer' || c.fn === 'publishInstagramMediaContainer'));
  check('caso 2: chamou publishFacebookPagePost de verdade', calls.some((c) => c.fn === 'publishFacebookPagePost'));
  check('caso 2: post original continua com o externalPostId de antes (não foi tocado)', esp2Body.originalPost && esp2Body.originalPost.externalPostId === 'ig-post-ja-publicado');

  // ---------- 3. Falha de verdade na Meta ao publicar o Facebook -> o
  // espelho continua existindo (não desfaz o espelhamento), mas fica sem
  // publicar, com o motivo do erro disponível pro aviso da tela. ----------
  calls = [];
  shouldFailInstagram = false;
  shouldFailFacebook = true;
  const post3 = await createIgPost({ subject: 'Caso 3 -- falha simulada no Facebook' });
  setFiles(post3.id, [{ id: 'f1', url: '/uploads/social/x/creative/foto3.jpg', name: 'foto3.jpg' }]);
  const esp3Res = await fetch(`${BASE}/api/social-posts/${post3.id}/espelhar-facebook`, { method: 'POST', headers: hj(adminToken) });
  const esp3Body = await esp3Res.json();
  check('caso 3: ainda responde 200 (espelhamento em si não falha por causa da Meta)', esp3Res.status === 200);
  check('caso 3: devolveu o mirrorPost mesmo com a publicação falhando', !!(esp3Body.mirrorPost && esp3Body.mirrorPost.id));
  check('caso 3: mirrorPublishResult.published = false', esp3Body.mirrorPublishResult && esp3Body.mirrorPublishResult.published === false);
  check('caso 3: mirrorPublishResult.reason tem a mensagem de erro da Meta', esp3Body.mirrorPublishResult && /Falha simulada no Facebook/.test(esp3Body.mirrorPublishResult.reason || ''));
  const mirror3InDb = db.get('socialPosts').find({ id: esp3Body.mirrorPost.id }).value();
  check('caso 3: espelho continua existindo no banco (não foi desfeito pela falha)', !!mirror3InDb);
  check('caso 3: espelho fica com publishStatus "failed" (não trava em "publishing")', mirror3InDb.publishStatus === 'failed');
  shouldFailFacebook = false;

  // ---------- 4. Marca sem conta Meta conectada (De Bacco, não conectado
  // neste teste) -> espelho criado, mas sem publicar (sem conta); cai no
  // aviso de "aguardando aprovação" de sempre. ----------
  calls = [];
  const post4 = await createIgPost({ subject: 'Caso 4 -- marca sem conta conectada', brand: 'debacco' });
  setFiles(post4.id, [{ id: 'f1', url: '/uploads/social/x/creative/foto4.jpg', name: 'foto4.jpg' }]);
  const esp4Res = await fetch(`${BASE}/api/social-posts/${post4.id}/espelhar-facebook`, { method: 'POST', headers: hj(adminToken) });
  const esp4Body = await esp4Res.json();
  check('caso 4: responde 200', esp4Res.status === 200);
  check('caso 4: originalPublishResult.published = false (De Bacco sem conta Meta conectada)', esp4Body.originalPublishResult && esp4Body.originalPublishResult.published === false);
  check('caso 4: mirrorPublishResult.published = false', esp4Body.mirrorPublishResult && esp4Body.mirrorPublishResult.published === false);
  check('caso 4: nenhuma chamada de verdade à Graph API (falhou antes, na checagem da conta)', calls.length === 0);

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;

  // Limpa os uploads criados neste teste antes de restaurar o banco (mesmo
  // padrão de espelharFacebookManual86.test.js).
  [post1.id, post2.id, post3.id, post4.id,
    esp1Body.mirrorPost && esp1Body.mirrorPost.id,
    esp2Body.mirrorPost && esp2Body.mirrorPost.id,
    esp3Body.mirrorPost && esp3Body.mirrorPost.id,
    esp4Body.mirrorPost && esp4Body.mirrorPost.id
  ].filter(Boolean).forEach((id) => {
    const dir = path.join(__dirname, '..', 'data', 'uploads', 'social', id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

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
