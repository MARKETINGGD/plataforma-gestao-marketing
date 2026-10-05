// Teste de integração (servidor de verdade, mesmo padrão de
// espelhamentoFacebookEReprovacao79.test.js) da 86ª rodada, pedido
// direto da Raquel:
//
//   "ainda esta sendo postado apenas no insta, o facebook n se marca
//   automaticamente. Ajuste para que o face e insta fiquem juntos no
//   agendamento, assim n se perde." -- print anexado mostrava um post
//   de Instagram (De Bacco) na tela "Editar agendamento" sem NENHUMA
//   faixa de espelhamento, confirmando que esse post específico não
//   tinha `mirroredToPostId`.
//
// O espelhamento automático (79ª rodada) só acontece no momento da
// CRIAÇÃO de um post novo de Instagram (POST /api/social-posts) -- um
// post de Instagram criado ANTES dessa rodada existir em produção (ou
// por qualquer caminho que não passe por ali) nunca ganha o espelho
// depois, nem editando. Esta rodada testa a SAÍDA MANUAL nova: endpoint
// POST /:id/espelhar-facebook, que cria o espelho sob demanda pra um
// post de Instagram já existente que ainda não tem um -- reaproveitando
// createFacebookMirror/copyFileToMirror (mesmas funções da criação
// automática).
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-espelhar-facebook-manual-86';
process.env.PORT = '4336';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4336';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-espelhar-facebook-manual-86-test');
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

  const analista = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'analista86', password: '123456', name: 'Analista Espelho Manual', cargo: 'analista' })
  }).then((r) => r.json()).then((d) => d.user);
  const analistaToken = await login('analista86', '123456');

  // ---------- Simula um post "legado" de Instagram sem espelho ----------
  // Cria direto como Facebook (nunca dispara espelho) e depois PUT troca
  // a rede pra Instagram -- PUT nunca cria espelho (só o POST de criação
  // faz isso), então vira exatamente o cenário real que a Raquel bateu:
  // um post de Instagram, numa marca com Facebook conectado, sem
  // NENHUM dos dois lados do espelho.
  const legadoCriado = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({
      brand: 'debacco', platform: 'facebook', postType: 'estatico', status: 'rascunho',
      scheduledDate: '2026-10-20', scheduledTime: '15:00', caption: 'Legenda do post legado',
      subject: 'Torneira 250 com Ímã', involvedUserIds: [analista.id], responsibleId: analista.id
    })
  }).then((r) => r.json());
  check('post "legado" criado (ainda como Facebook, de propósito)', !!(legadoCriado.post && legadoCriado.post.id));
  check('criar direto como Facebook não dispara espelho nenhum (comportamento de sempre, 79ª rodada)', !legadoCriado.mirrorPost);

  const legadoId = legadoCriado.post.id;
  const putRes = await fetch(`${BASE}/api/social-posts/${legadoId}`, {
    method: 'PUT', headers: hj(analistaToken), body: JSON.stringify({ platform: 'instagram' })
  }).then((r) => r.json());
  check('PUT trocando a rede pra Instagram funcionou (simula o post legado)', putRes.post && putRes.post.platform === 'instagram');
  check('depois do PUT, o post continua SEM mirroredToPostId (PUT nunca cria espelho -- é exatamente o bug relatado)', !putRes.post.mirroredToPostId);

  // Sobe um criativo ANTES de espelhar -- confirma que o endpoint novo
  // também copia o que já tiver sido enviado, não só os campos de texto.
  const FormData = globalThis.FormData;
  const Blob = globalThis.Blob;
  const fakeImageBytes = Buffer.from('fake-jpeg-bytes-legado-86');
  const form = new FormData();
  form.append('file', new Blob([fakeImageBytes], { type: 'image/jpeg' }), 'arte-legado-86.jpg');
  const uploadRes = await fetch(`${BASE}/api/social-posts/${legadoId}/files`, {
    method: 'POST', headers: { Authorization: `Bearer ${analistaToken}` }, body: form
  }).then((r) => r.json());
  check('upload do criativo no post legado (já como Instagram) funcionou', !!(uploadRes.post && uploadRes.post.files && uploadRes.post.files.length === 1));

  // ---------- 1. Espelhar manualmente (caminho feliz) ----------
  const espelharRes = await fetch(`${BASE}/api/social-posts/${legadoId}/espelhar-facebook`, {
    method: 'POST', headers: hj(analistaToken)
  });
  const espelharBody = await espelharRes.json();
  check('POST /:id/espelhar-facebook responde 200', espelharRes.status === 200);
  check('devolveu o mirrorPost criado', !!(espelharBody.mirrorPost && espelharBody.mirrorPost.id));
  const mirror = espelharBody.mirrorPost;
  if (mirror) {
    check('espelho nasceu como platform:"facebook"', mirror.platform === 'facebook');
    check('espelho nasceu com a mesma marca (De Bacco)', mirror.brand === 'debacco');
    check('espelho nasceu com a mesma data/hora do post original', mirror.scheduledDate === '2026-10-20' && mirror.scheduledTime === '15:00');
    check('espelho nasceu com a mesma legenda/assunto', mirror.caption === 'Legenda do post legado' && mirror.subject === 'Torneira 250 com Ímã');
    check('espelho nasceu com o mesmo responsável (estrelinha)', mirror.responsibleId === analista.id);
    check('espelho aponta de volta pro post de origem (mirroredFromPostId)', mirror.mirroredFromPostId === legadoId);
    // Diferente do espelhamento automático (que sempre nasce sem
    // arquivo, já que o post de origem também nasce sem arquivo), aqui
    // o criativo que já tinha sido enviado precisa vir copiado junto --
    // sem isso a Raquel teria que reenviar a arte duas vezes à toa.
    check('o criativo que já estava no post legado foi copiado pro espelho (sem precisar reenviar)', !!(mirror.files && mirror.files.length === 1));
  }

  const legadoFresh = await fetch(`${BASE}/api/social-posts`, { headers: hj(analistaToken) })
    .then((r) => r.json()).then((d) => d.posts.find((p) => p.id === legadoId));
  check('post original ganhou mirroredToPostId apontando pro espelho', legadoFresh && mirror && legadoFresh.mirroredToPostId === mirror.id);

  // ---------- 2. Não deixa espelhar de novo (já tem) ----------
  const denovoRes = await fetch(`${BASE}/api/social-posts/${legadoId}/espelhar-facebook`, {
    method: 'POST', headers: hj(analistaToken)
  });
  check('tentar espelhar de novo o mesmo post (já tem espelho) dá erro 400', denovoRes.status === 400);

  // ---------- 3. Validações de quando NÃO faz sentido espelhar ----------
  // 3a. Post de Facebook (não Instagram).
  const postFacebook = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({ brand: 'ghelplus', platform: 'facebook', postType: 'estatico', status: 'rascunho', scheduledDate: '2026-10-21', involvedUserIds: [analista.id], responsibleId: analista.id })
  }).then((r) => r.json());
  const espelharFacebookRes = await fetch(`${BASE}/api/social-posts/${postFacebook.post.id}/espelhar-facebook`, { method: 'POST', headers: hj(analistaToken) });
  check('espelhar um post que já é Facebook (não Instagram) dá erro 400', espelharFacebookRes.status === 400);

  // 3b. Instagram + Duranox (marca sem Facebook conectado).
  const postDuranox = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({ brand: 'duranox', platform: 'instagram', postType: 'estatico', status: 'rascunho', scheduledDate: '2026-10-22', involvedUserIds: [analista.id], responsibleId: analista.id })
  }).then((r) => r.json());
  const espelharDuranoxRes = await fetch(`${BASE}/api/social-posts/${postDuranox.post.id}/espelhar-facebook`, { method: 'POST', headers: hj(analistaToken) });
  check('espelhar um post de Instagram da Duranox (sem Facebook conectado) dá erro 400', espelharDuranoxRes.status === 400);

  // 3c. Post inexistente.
  const espelharInexistenteRes = await fetch(`${BASE}/api/social-posts/id-que-nao-existe/espelhar-facebook`, { method: 'POST', headers: hj(analistaToken) });
  check('espelhar um post que não existe dá 404', espelharInexistenteRes.status === 404);

  // 3d. Sem login.
  const espelharSemLoginRes = await fetch(`${BASE}/api/social-posts/${legadoId}/espelhar-facebook`, { method: 'POST' });
  check('espelhar sem estar logado dá 401', espelharSemLoginRes.status === 401);

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;

  // Limpa os uploads criados neste teste antes de restaurar o banco (mesmo
  // padrão de espelhamentoFacebookEReprovacao79.test.js) -- o restore do
  // db.json já cobre os registros, mas os arquivos físicos de upload
  // ficam soltos em data/uploads/social se não apagar.
  [legadoId, mirror && mirror.id, postFacebook.post && postFacebook.post.id, postDuranox.post && postDuranox.post.id].filter(Boolean).forEach((id) => {
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
