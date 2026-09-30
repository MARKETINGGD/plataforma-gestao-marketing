// Teste de integração (servidor de verdade, mesmo padrão de
// publicarAgora.test.js) da 79ª rodada, pedido da Raquel: "o status de
// postagem, deve ter a opção de mudar manualmente (em casos que ainda n
// tem integração ou em casos que acontece algum problema, deixe essa
// possibilidade)".
//
// A 11ª melhoria (ver publicarAgora.test.js) passou a EXIGIR que marcar
// "Publicado" numa rede/tipo com auto-publish (Instagram/Facebook/
// LinkedIn/YouTube/Pinterest/TikTok) publicasse de verdade -- o que
// travava a pessoa sem nenhuma saída quando a integração ainda não
// existia, ou quando a tentativa automática falhava por algum motivo
// alheio (conta desconectada, arquivo rejeitado, instabilidade da API
// etc.). Este teste confirma que `manualOverride:true` (mandado pela
// tela só depois que a pessoa vê o erro e confirma que quer mesmo assim)
// agora libera confirmar "Publicado" na mão nos dois casos, sem chamar a
// API de verdade, e que fica registrado (`publishStatus:'manual'`) pra
// não entrar de novo no ciclo automático depois.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-status-postagem-manual';
process.env.PORT = '4327';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4327';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-status-postagem-manual-test');
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
  let shouldFail = false;
  metaGraph.createInstagramMediaContainer = async (args) => {
    calls.push({ fn: 'createInstagramMediaContainer', args });
    if (shouldFail) throw new metaGraph.MetaGraphError('Falha simulada de propósito.');
    return { id: 'container-fake' };
  };
  metaGraph.waitForMediaContainerReady = async (args) => { calls.push({ fn: 'waitForMediaContainerReady', args }); };
  metaGraph.publishInstagramMediaContainer = async (args) => { calls.push({ fn: 'publishInstagramMediaContainer', args }); return { id: 'ig-post-fake' }; };
  metaGraph.getPermalink = async () => 'https://instagram.com/p/fake/';

  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const BASE = 'http://localhost:4327';
  const db = require('../db');

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  let token, userId;
  if (statusRes.needsSetup) {
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin Teste', username: 'admin-status-manual', password: '123456' })
    }).then((r) => r.json());
    token = setupRes.token; userId = setupRes.user && setupRes.user.id;
  } else {
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456' })
    }).then((r) => r.json());
    token = loginRes.token; userId = loginRes.user && loginRes.user.id;
  }
  check('login/setup do admin devolveu token', !!token);

  // Conta Meta conectada só pra GhelPlus -- De Bacco fica sem integração
  // de propósito, pro cenário "ainda não tem integração".
  db.get('socialAccounts').push({
    id: 'acc-ghelplus-teste', brand: 'ghelplus', platform: 'meta',
    igUserId: 'ig-ghelplus', igUsername: 'ghelplus_oficial',
    pageId: 'page-ghelplus', pageAccessToken: 'page-token-fake',
    connectedAt: new Date().toISOString()
  }).write();

  async function createPost(body) {
    const res = await fetch(`${BASE}/api/social-posts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(Object.assign({
        brand: 'ghelplus', platform: 'instagram', status: 'agendado',
        scheduledDate: '2020-01-01', scheduledTime: '08:00', caption: 'Legenda de teste',
        involvedUserIds: [userId], responsibleId: userId
      }, body))
    }).then((r) => r.json());
    return res.post;
  }
  function setFiles(id, files, extra) {
    db.get('socialPosts').find({ id }).assign(Object.assign({ files }, extra || {})).write();
  }
  function putPost(id, body) {
    return fetch(`${BASE}/api/social-posts/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
  }

  // ---------- 1. Marca SEM integração conectada (De Bacco): sem
  // manualOverride, continua bloqueando com erro claro (comportamento de
  // sempre, não pode ter regredido) -- E o erro agora vem com
  // `canOverrideManually:true`, pra tela saber que pode oferecer a saída. ----------
  calls = [];
  const post1 = await createPost({ postType: 'estatico', brand: 'debacco', status: 'agendado' });
  setFiles(post1.id, [{ id: 'f1', url: '/uploads/social/x/creative/foto.jpg', name: 'foto.jpg' }]);
  const put1 = await putPost(post1.id, { status: 'publicado' });
  const put1Body = await put1.json();
  check('sem integração + sem override: continua bloqueando (não regrediu)', put1.status !== 200);
  check('erro vem com canOverrideManually:true (tela sabe que pode oferecer confirmar na mão)', put1Body.canOverrideManually === true);
  check('nenhuma chamada de verdade à Graph API', calls.length === 0);

  // ---------- 2. Mesmo post, agora COM manualOverride:true (like a
  // pessoa confirmando o diálogo "quer marcar manualmente mesmo assim?")
  // -- deve aceitar, sem chamar a Meta, e marcar publishStatus:'manual'. ----------
  calls = [];
  const put1b = await putPost(post1.id, { status: 'publicado', manualOverride: true });
  const put1bBody = await put1b.json();
  check('com manualOverride: aceita marcar Publicado mesmo sem integração (200)', put1b.status === 200);
  check('status vira "publicado"', put1bBody.post && put1bBody.post.status === 'publicado');
  check('publishStatus vira "manual" (não "published" -- não foi publicação de verdade)', put1bBody.post && put1bBody.post.publishStatus === 'manual');
  check('continua sem nenhuma chamada de verdade à Graph API', calls.length === 0);

  // ---------- 3. Integração conectada (GhelPlus), mas a tentativa REAL
  // falha (ex.: instabilidade da Meta) -- sem override, continua
  // bloqueando com o erro de verdade. ----------
  calls = [];
  shouldFail = true;
  const post2 = await createPost({ postType: 'estatico', brand: 'ghelplus', status: 'agendado' });
  setFiles(post2.id, [{ id: 'f1', url: '/uploads/social/x/creative/foto2.jpg', name: 'foto2.jpg' }]);
  const put2 = await putPost(post2.id, { status: 'publicado' });
  const put2Body = await put2.json();
  check('falha real na Meta + sem override: continua bloqueando (não regrediu)', put2.status !== 200);
  check('mensagem de erro real chega pra tela', put2Body.error && put2Body.error.includes('Falha simulada de propósito'));
  check('erro de falha real também vem com canOverrideManually:true', put2Body.canOverrideManually === true);
  const post2AfterFail = db.get('socialPosts').find({ id: post2.id }).value();
  check('publishStatus fica "failed" depois da tentativa real', post2AfterFail.publishStatus === 'failed');

  // ---------- 4. Mesmo post (que JÁ falhou de verdade), agora com
  // manualOverride:true -- "algo aconteceu, deixe confirmar manualmente"
  // -- deve aceitar sem tentar publicar de novo. ----------
  calls = [];
  const put2b = await putPost(post2.id, { status: 'publicado', manualOverride: true });
  const put2bBody = await put2b.json();
  check('com manualOverride depois de uma falha real: aceita marcar Publicado (200)', put2b.status === 200);
  check('status vira "publicado"', put2bBody.post && put2bBody.post.status === 'publicado');
  check('publishStatus vira "manual" (sobrescreve o "failed" anterior)', put2bBody.post && put2bBody.post.publishStatus === 'manual');
  check('não tentou publicar de novo pela API (nenhuma chamada à Graph API)', calls.length === 0);
  shouldFail = false;

  // ---------- 5. Regressão: publicação automática de verdade continua
  // funcionando normalmente quando NENHUM override é usado (não quebrou o
  // caminho feliz da 11ª melhoria). ----------
  calls = [];
  const post3 = await createPost({ postType: 'estatico', brand: 'ghelplus', status: 'agendado' });
  setFiles(post3.id, [{ id: 'f1', url: '/uploads/social/x/creative/foto3.jpg', name: 'foto3.jpg' }]);
  const put3 = await putPost(post3.id, { status: 'publicado' });
  const put3Body = await put3.json();
  check('caminho feliz sem override: publica de verdade normalmente (200)', put3.status === 200);
  check('publishStatus vira "published" de verdade (não "manual")', put3Body.post && put3Body.post.publishStatus === 'published');
  check('chamou a Graph API de verdade', calls.some((c) => c.fn === 'createInstagramMediaContainer'));

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
