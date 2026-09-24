// Teste de integração (servidor de verdade, mesmo padrão de
// callback-endpoint.test.js) do bug real achado ao vivo pela Raquel
// (11ª melhoria, 24/09/2026): "Testei storie e ele não foi postado.
// Coloquei para publicar e ele n publicou." -- marcar "Publicado" na mão
// (o campo `status` do formulário) numa rede/tipo que a Papoi já publica
// sozinha (Instagram/Facebook, Estático/Carrossel/Reels/Storie) NUNCA
// chamava a Meta de verdade: só trocava o rótulo e completava as demandas
// ligadas, dando a impressão de sucesso sem nada ter ido pro ar -- e SEM
// NENHUM aviso de erro. Ver comentário completo em routes/socialPosts.js
// (PUT /:id).
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real (mesmo padrão de callback-endpoint.test.js), e
// monkeypatcha utils/metaGraphClient ANTES de subir o servidor pra não
// precisar de rede/credenciais reais.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-publicar-agora';
process.env.PORT = '4326';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4326';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-publicar-agora-test');
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
  metaGraph.createInstagramStoryContainer = async (args) => {
    calls.push({ fn: 'createInstagramStoryContainer', args });
    if (shouldFail) throw new metaGraph.MetaGraphError('Falha simulada no Storie.');
    return { id: 'storie-container-fake' };
  };
  metaGraph.createInstagramReelsContainer = async (args) => {
    calls.push({ fn: 'createInstagramReelsContainer', args });
    if (shouldFail) throw new metaGraph.MetaGraphError('Falha simulada no Reels.');
    return { id: 'reels-container-fake' };
  };
  metaGraph.createInstagramMediaContainer = async (args) => {
    calls.push({ fn: 'createInstagramMediaContainer', args });
    if (shouldFail) throw new metaGraph.MetaGraphError('Falha simulada no container.');
    return { id: 'container-fake' };
  };
  metaGraph.waitForMediaContainerReady = async (args) => {
    calls.push({ fn: 'waitForMediaContainerReady', args });
  };
  metaGraph.publishInstagramMediaContainer = async (args) => {
    calls.push({ fn: 'publishInstagramMediaContainer', args });
    return { id: 'ig-post-fake' };
  };
  metaGraph.getPermalink = async () => 'https://instagram.com/p/fake/';

  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const BASE = 'http://localhost:4326';
  const db = require('../db');

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  let token;
  if (statusRes.needsSetup) {
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin Teste', username: 'admin-publicar-agora', password: '123456' })
    }).then((r) => r.json());
    token = setupRes.token;
  } else {
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456' })
    }).then((r) => r.json());
    token = loginRes.token;
  }
  check('login/setup do admin devolveu token', !!token);

  // Conta Meta conectada pra GhelPlus, direto no banco (bypassa o fluxo de
  // OAuth de verdade -- já testado em callback-endpoint.test.js).
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
        scheduledDate: '2020-01-01', scheduledTime: '08:00', caption: 'Legenda de teste'
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

  // ---------- 1. O BUG DE VERDADE: Storie SEM legenda, marcado como
  // "Publicado" na mão -- antes da correção isso só trocava o rótulo (ou,
  // pior ainda, um Storie sem legenda nem entrava na fila automática, ver
  // metaPublisher.test.js) sem publicar nada de verdade. Agora deve
  // disparar a publicação REAL e só confirmar "Publicado" quando ela
  // realmente funcionar. ----------
  calls = [];
  shouldFail = false;
  const post1 = await createPost({ postType: 'storie', caption: '', status: 'agendado' });
  setFiles(post1.id, [{ id: 'f1', url: '/uploads/social/x/creative/foto-storie.jpg', name: 'foto-storie.jpg' }]);
  const put1 = await putPost(post1.id, { status: 'publicado' });
  const put1Body = await put1.json();
  check('marcar Storie sem legenda como Publicado: responde 200 (publicou de verdade)', put1.status === 200);
  check('post volta com publishStatus published', put1Body.post && put1Body.post.publishStatus === 'published');
  check('post volta com status publicado (só porque publicou de verdade)', put1Body.post && put1Body.post.status === 'publicado');
  check('externalPostId gravado (veio da Meta de verdade, não só um rótulo)', put1Body.post && put1Body.post.externalPostId === 'ig-post-fake');
  check('chamou createInstagramStoryContainer de verdade (não ficou só na tela)', calls.some((c) => c.fn === 'createInstagramStoryContainer'));

  // ---------- 2. Falha real da Meta: a pessoa vê o ERRO na hora, e o post
  // NÃO fica marcado como "Publicado" (diferente do bug original, que
  // nunca avisava nada). ----------
  calls = [];
  shouldFail = true;
  const post2 = await createPost({ postType: 'storie', caption: '', status: 'agendado' });
  setFiles(post2.id, [{ id: 'f1', url: '/uploads/social/x/creative/foto-storie2.jpg', name: 'foto-storie2.jpg' }]);
  const put2 = await putPost(post2.id, { status: 'publicado' });
  const put2Body = await put2.json();
  check('falha de verdade na Meta: NÃO responde 200 (não finge sucesso)', put2.status !== 200);
  check('mensagem de erro clara devolvida pra tela', put2Body.error && put2Body.error.includes('Falha simulada no Storie'));
  const post2InDb = db.get('socialPosts').find({ id: post2.id }).value();
  check('post NÃO fica marcado como "publicado" de verdade (continua "agendado")', post2InDb.status === 'agendado');
  check('publishStatus fica "failed" (não null, não "published")', post2InDb.publishStatus === 'failed');
  shouldFail = false;

  // ---------- 3. Reels com arquivo inválido (0 arquivos): erro claro,
  // igual já acontecia no ciclo automático -- confirma que o "publicar
  // agora" manual reaproveita a MESMA validação (não duplicou a lógica). ----------
  calls = [];
  const post3 = await createPost({ postType: 'reels', status: 'agendado' });
  setFiles(post3.id, []);
  const put3 = await putPost(post3.id, { status: 'publicado' });
  const put3Body = await put3.json();
  check('reels sem nenhum arquivo: publicar agora falha com mensagem clara', put3.status !== 200 && /arquivo/i.test(put3Body.error || ''));

  // ---------- 4. Marca sem conta Meta conectada (De Bacco, não conectado
  // neste teste): erro amigável na hora, em vez de nada acontecer em
  // silêncio (o bug original também escondia esse caso). ----------
  calls = [];
  const post4 = await createPost({ postType: 'estatico', brand: 'debacco', status: 'agendado' });
  setFiles(post4.id, [{ id: 'f1', url: '/uploads/social/x/creative/foto.jpg', name: 'foto.jpg' }]);
  const put4 = await putPost(post4.id, { status: 'publicado' });
  const put4Body = await put4.json();
  check('marca sem conta Meta conectada: publicar agora falha (não fica em silêncio)', put4.status !== 200);
  check('mensagem explica que falta conectar em Integrações', /Integraç/i.test(put4Body.error || ''));
  check('nenhuma chamada de verdade à Graph API foi feita (falhou antes, na checagem da conta)', calls.length === 0);

  // ---------- 5. Rede/tipo fora do escopo da Meta (TikTok) continua com o
  // comportamento de SEMPRE: marcar "Publicado" é só uma confirmação
  // manual, sem chamar API nenhuma -- não pode quebrar esse fluxo, que
  // nunca teve nada de automático. ----------
  calls = [];
  const post5 = await createPost({ postType: 'video_tiktok', platform: 'tiktok', status: 'agendado' });
  setFiles(post5.id, [{ id: 'f1', url: '/uploads/social/x/creative/video.mp4', name: 'video.mp4' }]);
  const put5 = await putPost(post5.id, { status: 'publicado' });
  const put5Body = await put5.json();
  check('TikTok marcado como Publicado: continua funcionando (200)', put5.status === 200);
  check('TikTok: status realmente vira "publicado" (comportamento manual de sempre)', put5Body.post && put5Body.post.status === 'publicado');
  check('TikTok: NENHUMA chamada à Graph API da Meta (não é publicação automática, nunca foi)', calls.length === 0);

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
