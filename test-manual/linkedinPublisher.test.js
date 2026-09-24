// Teste manual (Node puro, sem servidor HTTP) do publicador automático da
// LinkedIn (utils/linkedinPublisher.js) — mesmo padrão de
// metaPublisher.test.js: usa o banco data/db.json da cópia de teste
// isolada, mockando o cliente da LinkedIn (utils/linkedinClient) pra não
// precisar de rede/credenciais reais (que, no caso da LinkedIn, nem
// existem ainda -- depende da aprovação do App, ver
// PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md seção 7). Rodar com o
// servidor de teste PARADO (lowdb não lida bem com 2 processos escrevendo
// no mesmo arquivo ao mesmo tempo).
process.env.PAPOI_BASE_URL = 'http://localhost:4123';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { nanoid } = require('../utils/id');

// ---------- monkeypatch do cliente da LinkedIn (sem rede) ----------
const linkedinClient = require('../utils/linkedinClient');
let calls = [];
let shouldFail = false;
linkedinClient.uploadImage = async (args) => {
  calls.push({ fn: 'uploadImage', args: { ownerUrn: args.ownerUrn, bytes: args.buffer.length } });
  if (shouldFail) throw new linkedinClient.LinkedInApiError('Falha simulada no upload da imagem.');
  return 'urn:li:image:fake-image-1';
};
linkedinClient.uploadVideo = async (args) => {
  calls.push({ fn: 'uploadVideo', args: { ownerUrn: args.ownerUrn, bytes: args.buffer.length } });
  if (shouldFail) throw new linkedinClient.LinkedInApiError('Falha simulada no upload do vídeo.');
  return 'urn:li:video:fake-video-1';
};
linkedinClient.createPost = async (args) => {
  calls.push({ fn: 'createPost', args });
  if (shouldFail) throw new linkedinClient.LinkedInApiError('Falha simulada ao publicar.');
  return { id: 'urn:li:share:fake-post-1' };
};

const linkedinPublisher = require('../utils/linkedinPublisher');

// ---------- arquivos de verdade no disco (attemptPublish lê o binário de
// verdade, diferente da Meta que só monta uma URL pública) ----------
const uploadsRoot = path.join(__dirname, '..', 'data', 'uploads', 'social', 'xyz-linkedin', 'creative');
fs.mkdirSync(uploadsRoot, { recursive: true });
fs.writeFileSync(path.join(uploadsRoot, 'foto.jpg'), Buffer.from('fake-jpg-bytes'));
fs.writeFileSync(path.join(uploadsRoot, 'video.mp4'), Buffer.from('fake-mp4-bytes'));

function makePost(overrides) {
  const post = Object.assign({
    id: nanoid(),
    brand: 'ghelplus',
    platform: 'linkedin',
    scheduledDate: '2020-01-01',
    scheduledTime: '08:00',
    caption: 'Legenda de teste do LinkedIn',
    postType: 'estatico',
    status: 'rascunho',
    publishStatus: null,
    involvedUserIds: [],
    responsibleId: null,
    files: [],
    createdAt: new Date().toISOString(),
    createdBy: null,
    updatedAt: new Date().toISOString()
  }, overrides);
  db.get('socialPosts').push(post).write();
  return post;
}

function cleanupPost(id) {
  db.get('socialPosts').remove({ id }).write();
}

async function run() {
  let failures = 0;
  function check(label, cond) {
    if (cond) {
      console.log(`OK   - ${label}`);
    } else {
      failures++;
      console.log(`FAIL - ${label}`);
    }
  }

  // ---------- 1. sem conta conectada: elegível, mas não publica nada ----------
  db.get('socialAccounts').remove({ brand: 'ghelplus', platform: 'linkedin' }).write();
  const post1 = makePost({});
  check('post elegível mesmo sem conta conectada (isEligible só olha o post)', linkedinPublisher.isEligible(post1) === true);
  await linkedinPublisher.checkAndPublishScheduledPosts();
  const post1After = db.get('socialPosts').find({ id: post1.id }).value();
  check('sem conta conectada: post NÃO foi tocado (publishStatus continua null)', post1After.publishStatus === null);
  cleanupPost(post1.id);

  // ---------- 2. com conta conectada, texto puro (sem arquivo nenhum) ----------
  const accountId = nanoid();
  db.get('socialAccounts').push({
    id: accountId, brand: 'ghelplus', platform: 'linkedin',
    organizationId: '999888', organizationUrn: 'urn:li:organization:999888', orgName: 'GhelPlus',
    accessToken: 'fake-access-token',
    tokenExpiresAt: new Date(Date.now() + 1000000).toISOString(),
    connectedBy: null, connectedByName: 'Teste', connectedAt: new Date().toISOString()
  }).write();

  calls = [];
  shouldFail = false;
  const post2 = makePost({ files: [] });
  await linkedinPublisher.checkAndPublishScheduledPosts();
  const post2After = db.get('socialPosts').find({ id: post2.id }).value();
  check('texto puro: publishStatus vira "published"', post2After.publishStatus === 'published');
  check('texto puro: externalPostId gravado', post2After.externalPostId === 'urn:li:share:fake-post-1');
  check('texto puro: externalPermalink montado a partir do URN', post2After.externalPermalink === 'https://www.linkedin.com/feed/update/urn:li:share:fake-post-1/');
  check('texto puro: status também vira "publicado" (mesma cascata da Meta)', post2After.status === 'publicado');
  check('texto puro: NÃO chamou upload nenhum (sem arquivo)', !calls.some((c) => c.fn === 'uploadImage' || c.fn === 'uploadVideo'));
  const createCall2 = calls.find((c) => c.fn === 'createPost');
  check('texto puro: createPost chamado como a organization certa, sem mediaUrn', createCall2 && createCall2.args.authorUrn === 'urn:li:organization:999888' && !createCall2.args.mediaUrn);
  check('texto puro: commentary é a legenda do post', createCall2 && createCall2.args.commentary === 'Legenda de teste do LinkedIn');
  cleanupPost(post2.id);

  // ---------- 2b. recado automático de sucesso, com o link ----------
  const anyUser = db.get('users').value()[0];
  const post2b = makePost(anyUser ? { responsibleId: anyUser.id, involvedUserIds: [anyUser.id] } : {});
  await linkedinPublisher.checkAndPublishScheduledPosts();
  const recadoSucesso = db.get('recados').value().find((r) => r.sourceSocialPostId === post2b.id);
  check('publicar com sucesso cria um recado automático', !!recadoSucesso);
  check('recado de sucesso menciona LinkedIn e publicação', recadoSucesso && /LinkedIn/.test(recadoSucesso.text) && /publicad[oa] com sucesso/i.test(recadoSucesso.text));
  check('recado de sucesso carrega o link (externalUrl)', recadoSucesso && recadoSucesso.externalUrl === 'https://www.linkedin.com/feed/update/urn:li:share:fake-post-1/');
  cleanupPost(post2b.id);
  if (recadoSucesso) db.get('recados').remove({ id: recadoSucesso.id }).write();

  // ---------- 3. com imagem ----------
  calls = [];
  const post3 = makePost({ files: [{ id: 'f1', url: '/uploads/social/xyz-linkedin/creative/foto.jpg', name: 'foto.jpg' }] });
  await linkedinPublisher.checkAndPublishScheduledPosts();
  const post3After = db.get('socialPosts').find({ id: post3.id }).value();
  check('com imagem: publishStatus vira "published"', post3After.publishStatus === 'published');
  check('com imagem: chamou uploadImage (não uploadVideo)', calls.some((c) => c.fn === 'uploadImage') && !calls.some((c) => c.fn === 'uploadVideo'));
  const createCall3 = calls.find((c) => c.fn === 'createPost');
  check('com imagem: createPost recebeu o mediaUrn certo', createCall3 && createCall3.args.mediaUrn === 'urn:li:image:fake-image-1');
  cleanupPost(post3.id);

  // ---------- 4. com vídeo (extensão .mp4) ----------
  calls = [];
  const post4 = makePost({ files: [{ id: 'f1', url: '/uploads/social/xyz-linkedin/creative/video.mp4', name: 'video.mp4' }] });
  await linkedinPublisher.checkAndPublishScheduledPosts();
  const post4After = db.get('socialPosts').find({ id: post4.id }).value();
  check('com vídeo: publishStatus vira "published"', post4After.publishStatus === 'published');
  check('com vídeo: chamou uploadVideo (não uploadImage)', calls.some((c) => c.fn === 'uploadVideo') && !calls.some((c) => c.fn === 'uploadImage'));
  const createCall4 = calls.find((c) => c.fn === 'createPost');
  check('com vídeo: createPost recebeu o mediaUrn certo', createCall4 && createCall4.args.mediaUrn === 'urn:li:video:fake-video-1');
  cleanupPost(post4.id);

  // ---------- 5. mais de 1 arquivo: v1 não suporta (fica manual, não elegível) ----------
  const post5 = makePost({
    files: [
      { id: 'f1', url: '/uploads/social/xyz-linkedin/creative/foto.jpg', name: 'foto.jpg' },
      { id: 'f2', url: '/uploads/social/xyz-linkedin/creative/video.mp4', name: 'video.mp4' }
    ]
  });
  check('mais de 1 arquivo: NÃO elegível pra publicação automática nesta 1ª versão', linkedinPublisher.isEligible(post5) === false);
  calls = [];
  await linkedinPublisher.checkAndPublishScheduledPosts();
  const post5After = db.get('socialPosts').find({ id: post5.id }).value();
  check('mais de 1 arquivo: publishStatus continua null (não tentou)', post5After.publishStatus === null);
  check('mais de 1 arquivo: nenhuma chamada de rede foi feita', calls.length === 0);
  cleanupPost(post5.id);

  // ---------- 6. arquivo referenciado não existe mais no disco ----------
  calls = [];
  const post6 = makePost({ files: [{ id: 'f1', url: '/uploads/social/xyz-linkedin/creative/nao-existe.jpg', name: 'nao-existe.jpg' }] });
  await linkedinPublisher.checkAndPublishScheduledPosts();
  const post6After = db.get('socialPosts').find({ id: post6.id }).value();
  check('arquivo sumiu do disco: falha com mensagem clara (não trava)', post6After.publishStatus === 'failed' && /Não encontrei o arquivo/.test(post6After.publishError || ''));
  cleanupPost(post6.id);

  // ---------- 7. falha simulada na própria LinkedIn ----------
  calls = [];
  shouldFail = true;
  const post7 = makePost(anyUser ? { responsibleId: anyUser.id, involvedUserIds: [anyUser.id] } : {});
  await linkedinPublisher.checkAndPublishScheduledPosts();
  const post7After = db.get('socialPosts').find({ id: post7.id }).value();
  check('falha simulada: publishStatus vira "failed"', post7After.publishStatus === 'failed');
  check('falha simulada: publishError com a mensagem certa', post7After.publishError === 'Falha simulada ao publicar.');
  check('falha simulada: recado automático de falha criado', db.get('recados').value().some((r) => r.sourceSocialPostId === post7.id && r.text.includes('não consegui publicar')));
  calls = [];
  await linkedinPublisher.checkAndPublishScheduledPosts();
  check('não retenta sozinho um post "failed" sem edição', calls.length === 0);
  cleanupPost(post7.id);
  shouldFail = false;

  // ---------- 8. limpeza ----------
  db.get('socialAccounts').remove({ id: accountId }).write();
  fs.rmSync(path.join(__dirname, '..', 'data', 'uploads', 'social', 'xyz-linkedin'), { recursive: true, force: true });

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
