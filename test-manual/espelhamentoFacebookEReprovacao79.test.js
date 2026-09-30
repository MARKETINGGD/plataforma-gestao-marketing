// Teste de integração (servidor de verdade, mesmo padrão de
// relatoriosEFiltros79.test.js) da 79ª rodada, pedido direto da Raquel:
//
//   "O agendamento do Instagram/facebook, esta postando apenas no
//   instagram, sempre que postar no insta, deve ir ao facebook tbm, nas
//   duas marcas. Deve ser padrão isso." -- testado aqui: criar um post de
//   Instagram para De Bacco/GhelPlus cria automaticamente uma cópia em
//   Facebook (mesmo conteúdo, mesma data), sem espelhar Duranox/Boutique
//   Inox nem posts que já nascem como Facebook/outra rede. Também testa
//   que o criativo enviado no Instagram é copiado pro espelho sozinho.
//
//   "Quando um post é rejeitado, o recado enviado deve ser avisando que
//   ele foi rejeitado, esse recado deve vir para quem é o responsável
//   pelo post (tem estrelinha), gerente e coordenador, deve mostrar quem
//   reprovou/rejeitou." -- testado aqui: reprovar um post avisa
//   responsável + gerente + coordenador (sem duplicar quem for as duas
//   coisas), e o texto mostra "reprovado por (cargo) (nome)" + o motivo.
//
//   "Quando ele é rejeitado, terá a sugestão de alteração. Quando a
//   pessoa responsável ajustar, dever ter a opção de dar um check/ok, na
//   sugestão, e ai o post deve voltar para aprovação." -- testado aqui: a
//   rota PUT /:id/resubmit só funciona em post reprovado, só pra quem é
//   responsável (ou aprovador), volta approvalStatus pra "pendente" sem
//   apagar o approvalNotes, e avisa quem aprova.
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-espelhamento-fb-reprovacao-79';
process.env.PORT = '4330';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4330';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-espelhamento-fb-reprovacao-79-test');
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

  const BASE = 'http://localhost:4330';
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
  const adminUser = await fetch(`${BASE}/api/auth/me`, { headers: hj(adminToken) }).then((r) => r.json()).then((d) => d.user);
  // Garante que o admin tem cargo de coordenador pra aparecer nos avisos
  // de reprovação como "gerência" também (mesmo espírito do teste da
  // aprovação -- cargo é o que importa pros avisos, não o role).
  await fetch(`${BASE}/api/auth/users/${adminUser.id}`, { method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ cargo: 'coordenador' }) });

  // Cria uma gerente separada (pra confirmar que TODO MUNDO com
  // gerente/coordenador recebe o aviso de reprovação, não só o admin).
  const gerente = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'gerente79b', password: '123456', name: 'Gerente Teste', cargo: 'gerente' })
  }).then((r) => r.json()).then((d) => d.user);

  // Cria a analista responsável (dona da estrelinha) pelos posts de teste.
  const analista = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'analista79b', password: '123456', name: 'Analista Espelho', cargo: 'analista' })
  }).then((r) => r.json()).then((d) => d.user);
  const analistaToken = await login('analista79b', '123456');

  // ---------- 1. Espelhamento automático Instagram -> Facebook ----------
  const createdIds = [];

  // 1a. Instagram + De Bacco -> DEVE espelhar.
  const igDebacco = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({
      brand: 'debacco', platform: 'instagram', postType: 'estatico', status: 'rascunho',
      scheduledDate: '2026-10-05', scheduledTime: '10:00', caption: 'Legenda do teste de espelho',
      subject: 'Assunto Espelho De Bacco',
      involvedUserIds: [analista.id], responsibleId: analista.id
    })
  }).then((r) => r.json());
  check('post de Instagram (De Bacco) criado com sucesso', !!(igDebacco.post && igDebacco.post.id));
  check('resposta já veio com o mirrorPost (espelho) do Facebook', !!(igDebacco.mirrorPost && igDebacco.mirrorPost.id));
  if (igDebacco.post) createdIds.push(igDebacco.post.id);
  if (igDebacco.mirrorPost) createdIds.push(igDebacco.mirrorPost.id);
  if (igDebacco.mirrorPost) {
    const mp = igDebacco.mirrorPost;
    check('espelho nasceu como platform:"facebook"', mp.platform === 'facebook');
    check('espelho nasceu com a mesma marca (De Bacco)', mp.brand === 'debacco');
    check('espelho nasceu com a mesma data/hora', mp.scheduledDate === '2026-10-05' && mp.scheduledTime === '10:00');
    check('espelho nasceu com a mesma legenda/assunto', mp.caption === 'Legenda do teste de espelho' && mp.subject === 'Assunto Espelho De Bacco');
    check('espelho nasceu com o mesmo responsável (estrelinha)', mp.responsibleId === analista.id);
    check('espelho aponta de volta pro post de origem (mirroredFromPostId)', mp.mirroredFromPostId === igDebacco.post.id);
  }
  const igDebaccoFresh = db.get('socialPosts').find({ id: igDebacco.post.id }).value();
  check('post original ganhou mirroredToPostId apontando pro espelho', igDebaccoFresh && igDebaccoFresh.mirroredToPostId === igDebacco.mirrorPost.id);

  // 1b. Instagram + GhelPlus -> DEVE espelhar (a outra marca pedida).
  const igGhelplus = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({
      brand: 'ghelplus', platform: 'instagram', postType: 'estatico', status: 'rascunho',
      scheduledDate: '2026-10-06', scheduledTime: '11:00', caption: 'Legenda GhelPlus',
      involvedUserIds: [analista.id], responsibleId: analista.id
    })
  }).then((r) => r.json());
  check('post de Instagram (GhelPlus) também ganhou espelho no Facebook', !!(igGhelplus.mirrorPost && igGhelplus.mirrorPost.platform === 'facebook' && igGhelplus.mirrorPost.brand === 'ghelplus'));
  if (igGhelplus.post) createdIds.push(igGhelplus.post.id);
  if (igGhelplus.mirrorPost) createdIds.push(igGhelplus.mirrorPost.id);

  // 1c. Instagram + Duranox -> NÃO deve espelhar (marca sem Facebook conectado).
  const igDuranox = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({
      brand: 'duranox', platform: 'instagram', postType: 'estatico', status: 'rascunho',
      scheduledDate: '2026-10-07', involvedUserIds: [analista.id], responsibleId: analista.id
    })
  }).then((r) => r.json());
  check('post de Instagram (Duranox) NÃO ganhou espelho (marca fora da lista)', igDuranox.mirrorPost === null || igDuranox.mirrorPost === undefined);
  if (igDuranox.post) createdIds.push(igDuranox.post.id);

  // 1d. Facebook direto (De Bacco) -> NÃO deve criar espelho nenhum (a
  // regra só dispara a partir do Instagram, senão viraria um loop).
  const fbDireto = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(analistaToken),
    body: JSON.stringify({
      brand: 'debacco', platform: 'facebook', postType: 'estatico', status: 'rascunho',
      scheduledDate: '2026-10-08', involvedUserIds: [analista.id], responsibleId: analista.id
    })
  }).then((r) => r.json());
  check('post criado direto em Facebook NÃO dispara espelhamento nenhum', !fbDireto.mirrorPost);
  if (fbDireto.post) createdIds.push(fbDireto.post.id);

  // ---------- 2. Upload do criativo copia pro espelho ----------
  const FormData = globalThis.FormData;
  const Blob = globalThis.Blob;
  const fakeImageBytes = Buffer.from('fake-jpeg-bytes-para-teste-79');
  const form = new FormData();
  form.append('file', new Blob([fakeImageBytes], { type: 'image/jpeg' }), 'arte-teste-79.jpg');
  const uploadRes = await fetch(`${BASE}/api/social-posts/${igDebacco.post.id}/files`, {
    method: 'POST', headers: { Authorization: `Bearer ${analistaToken}` }, body: form
  }).then((r) => r.json());
  check('upload do criativo no post de Instagram funcionou', !!(uploadRes.post && uploadRes.post.files && uploadRes.post.files.length === 1));

  const mirrorAfterUpload = db.get('socialPosts').find({ id: igDebacco.mirrorPost.id }).value();
  check('o criativo foi copiado sozinho pro espelho do Facebook (files)', !!(mirrorAfterUpload && mirrorAfterUpload.files && mirrorAfterUpload.files.length === 1));
  if (mirrorAfterUpload && mirrorAfterUpload.files[0]) {
    const mirrorFilePath = path.join(__dirname, '..', 'data', 'uploads', 'social', igDebacco.mirrorPost.id, 'creative', path.basename(mirrorAfterUpload.files[0].url));
    check('o arquivo copiado existe de verdade na pasta do espelho (cópia física)', fs.existsSync(mirrorFilePath));
    if (fs.existsSync(mirrorFilePath)) {
      check('o conteúdo copiado é idêntico ao criativo original', fs.readFileSync(mirrorFilePath).equals(fakeImageBytes));
    }
  }

  // ---------- 3. Aviso de reprovação (responsável + gerente + coordenador, mostrando quem reprovou) ----------
  // Usa o post de GhelPlus (mais simples, sem depender do upload acima) --
  // precisa ficar "pronto pra aprovar" antes (legenda + arte).
  const formB = new FormData();
  formB.append('file', new Blob([Buffer.from('outra-arte-79')], { type: 'image/jpeg' }), 'arte-ghelplus-79.jpg');
  await fetch(`${BASE}/api/social-posts/${igGhelplus.post.id}/files`, {
    method: 'POST', headers: { Authorization: `Bearer ${analistaToken}` }, body: formB
  });

  const approvalRejectRes = await fetch(`${BASE}/api/social-posts/${igGhelplus.post.id}/approval`, {
    method: 'PUT', headers: hj(adminToken),
    body: JSON.stringify({ approvalStatus: 'reprovado', approvalNotes: 'Trocar a cor do fundo, por favor.' })
  }).then((r) => r.json());
  check('reprovação processada com sucesso', approvalRejectRes.post && approvalRejectRes.post.approvalStatus === 'reprovado');

  const analistaRecados = await fetch(`${BASE}/api/recados/for-me`, { headers: hj(analistaToken) }).then((r) => r.json()).then((d) => d.recados);
  const gerenteRecados = await fetch(`${BASE}/api/recados/for-me`, { headers: hj(await login('gerente79b', '123456')) }).then((r) => r.json()).then((d) => d.recados);
  const adminRecados = await fetch(`${BASE}/api/recados/for-me`, { headers: hj(adminToken) }).then((r) => r.json()).then((d) => d.recados);

  const analistaRejMsg = analistaRecados.find((r) => r.sourceSocialPostId === igGhelplus.post.id && r.kind === 'post_rejected');
  const gerenteRejMsg = gerenteRecados.find((r) => r.sourceSocialPostId === igGhelplus.post.id && r.kind === 'post_rejected');
  const adminRejMsg = adminRecados.find((r) => r.sourceSocialPostId === igGhelplus.post.id && r.kind === 'post_rejected');
  check('o RESPONSÁVEL (estrelinha) recebeu o aviso de reprovação', !!analistaRejMsg);
  check('a GERENTE recebeu o aviso de reprovação', !!gerenteRejMsg);
  check('o COORDENADOR/admin (quem reprovou) também recebeu o aviso (é coordenador cadastrado)', !!adminRejMsg);
  if (analistaRejMsg) {
    check('o aviso diz que o post foi REJEITADO/reprovado', /reprovado/i.test(analistaRejMsg.text));
    check('o aviso mostra QUEM reprovou (cargo + nome)', analistaRejMsg.text.includes(`reprovado por Coordenador(a) (${adminUser.name})`));
    check('o aviso inclui o motivo/sugestão de alteração', analistaRejMsg.text.includes('Trocar a cor do fundo, por favor.'));
  }

  // ---------- 4. Reenvio (check/ok) depois de ajustar a sugestão ----------
  // 4a. Post ainda "pendente" (não reprovado) -> resubmit deve falhar (400).
  const resubmitAntesDaReprovacao = await fetch(`${BASE}/api/social-posts/${igDebacco.post.id}/resubmit`, {
    method: 'PUT', headers: hj(analistaToken)
  });
  check('reenviar um post que NÃO está reprovado dá erro 400', resubmitAntesDaReprovacao.status === 400);

  // 4b. Pessoa sem permissão (nem responsável, nem aprovador) -> 403.
  const estranho = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'estranho79b', password: '123456', name: 'Pessoa Sem Relação', cargo: 'auxiliar' })
  }).then((r) => r.json()).then((d) => d.user);
  const estranhoToken = await login('estranho79b', '123456');
  const resubmitSemPermissao = await fetch(`${BASE}/api/social-posts/${igGhelplus.post.id}/resubmit`, {
    method: 'PUT', headers: hj(estranhoToken)
  });
  check('reenviar sem ser responsável nem aprovador dá erro 403', resubmitSemPermissao.status === 403);

  // 4c. A própria responsável (estrelinha) ajustou e clica "já ajustei" -> volta pra pendente.
  const resubmitOk = await fetch(`${BASE}/api/social-posts/${igGhelplus.post.id}/resubmit`, {
    method: 'PUT', headers: hj(analistaToken)
  }).then((r) => r.json());
  check('reenvio pela responsável funcionou (200)', resubmitOk.post && resubmitOk.post.approvalStatus === 'pendente');
  check('approvalNotes (a sugestão) continua visível depois do reenvio, pra conferência', resubmitOk.post.approvalNotes === 'Trocar a cor do fundo, por favor.');
  check('approvedBy/approvedByName foram limpos no reenvio', !resubmitOk.post.approvedBy && !resubmitOk.post.approvedByName);

  const adminRecadosAposResubmit = await fetch(`${BASE}/api/recados/for-me`, { headers: hj(adminToken) }).then((r) => r.json()).then((d) => d.recados);
  const resubmitMsg = adminRecadosAposResubmit.find((r) => r.sourceSocialPostId === igGhelplus.post.id && r.kind === 'post_resubmitted');
  check('quem aprova foi avisado do reenvio (post ajustado, esperando nova aprovação)', !!resubmitMsg);

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;

  // Limpa os posts/uploads criados neste teste antes de restaurar o banco
  // (o restore do db.json já cobre os registros, mas os arquivos físicos
  // de upload ficam soltos em data/uploads/social se não apagar).
  createdIds.forEach((id) => {
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
