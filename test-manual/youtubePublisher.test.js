// Teste manual (Node puro, sem servidor HTTP) do publicador automático do
// YouTube (utils/youtubePublisher.js) — mesmo padrão de
// linkedinPublisher.test.js: usa o banco data/db.json da cópia de teste
// isolada, mockando o cliente do YouTube (utils/youtubeClient) pra não
// precisar de rede/credenciais reais. Rodar com o servidor de teste PARADO
// (lowdb não lida bem com 2 processos escrevendo no mesmo arquivo ao mesmo
// tempo).
process.env.PAPOI_BASE_URL = 'http://localhost:4123';
process.env.YOUTUBE_CLIENT_ID = 'fake-client-id';
process.env.YOUTUBE_CLIENT_SECRET = 'fake-client-secret';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { nanoid } = require('../utils/id');

// ---------- monkeypatch do cliente do YouTube (sem rede) ----------
const youtubeClient = require('../utils/youtubeClient');
let calls = [];
let shouldFail = false;
let shouldFailThumbnail = false;
youtubeClient.refreshAccessToken = async (args) => {
  calls.push({ fn: 'refreshAccessToken', args: { refreshToken: args.refreshToken } });
  return 'fake-access-token';
};
youtubeClient.uploadVideo = async (args) => {
  calls.push({ fn: 'uploadVideo', args: { title: args.title, description: args.description, mimeType: args.mimeType, bytes: args.buffer.length, privacyStatus: args.privacyStatus } });
  if (shouldFail) throw new youtubeClient.YouTubeApiError('Falha simulada no upload do vídeo.');
  return 'fake-video-id-1';
};
youtubeClient.setThumbnail = async (args) => {
  calls.push({ fn: 'setThumbnail', args: { videoId: args.videoId, mimeType: args.mimeType, bytes: args.buffer.length } });
  if (shouldFailThumbnail) throw new youtubeClient.YouTubeApiError('Falha simulada no upload da capa.');
};

const youtubePublisher = require('../utils/youtubePublisher');

// ---------- arquivos de verdade no disco (attemptPublish lê o binário de
// verdade, igual à LinkedIn) ----------
const uploadsRoot = path.join(__dirname, '..', 'data', 'uploads', 'social', 'xyz-youtube', 'creative');
fs.mkdirSync(uploadsRoot, { recursive: true });
fs.writeFileSync(path.join(uploadsRoot, 'video.mp4'), Buffer.from('fake-mp4-bytes'));
fs.writeFileSync(path.join(uploadsRoot, 'foto.jpg'), Buffer.from('fake-jpg-bytes'));
fs.writeFileSync(path.join(uploadsRoot, 'capa.jpg'), Buffer.from('fake-thumb-bytes'));

function makePost(overrides) {
  const post = Object.assign({
    id: nanoid(),
    brand: 'ghelplus',
    platform: 'youtube',
    postType: 'video_youtube',
    scheduledDate: '2020-01-01',
    scheduledTime: '08:00',
    subject: 'Vídeo de teste',
    caption: 'Descrição de teste do YouTube',
    status: 'rascunho',
    publishStatus: null,
    involvedUserIds: [],
    responsibleId: null,
    files: [{ id: 'f1', url: '/uploads/social/xyz-youtube/creative/video.mp4', name: 'video.mp4' }],
    thumbnailFile: null,
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
  db.get('socialAccounts').remove({ brand: 'ghelplus', platform: 'youtube' }).write();
  const post1 = makePost({});
  check('post elegível mesmo sem conta conectada (isEligible só olha o post)', youtubePublisher.isEligible(post1) === true);
  await youtubePublisher.checkAndPublishScheduledPosts();
  const post1After = db.get('socialPosts').find({ id: post1.id }).value();
  check('sem conta conectada: post NÃO foi tocado (publishStatus continua null)', post1After.publishStatus === null);
  cleanupPost(post1.id);

  // ---------- 2. sem assunto (título): não elegível ----------
  const post2 = makePost({ subject: '' });
  check('sem assunto: NÃO elegível (é o título obrigatório do vídeo)', youtubePublisher.isEligible(post2) === false);
  cleanupPost(post2.id);

  // ---------- 3. mais de 1 arquivo: v1 não suporta ----------
  const post3 = makePost({
    files: [
      { id: 'f1', url: '/uploads/social/xyz-youtube/creative/video.mp4', name: 'video.mp4' },
      { id: 'f2', url: '/uploads/social/xyz-youtube/creative/foto.jpg', name: 'foto.jpg' }
    ]
  });
  check('mais de 1 arquivo: NÃO elegível pra publicação automática nesta 1ª versão', youtubePublisher.isEligible(post3) === false);
  cleanupPost(post3.id);

  // ---------- 4. arquivo que não parece vídeo: não elegível ----------
  const post4 = makePost({ files: [{ id: 'f1', url: '/uploads/social/xyz-youtube/creative/foto.jpg', name: 'foto.jpg' }] });
  check('arquivo não é vídeo: NÃO elegível', youtubePublisher.isEligible(post4) === false);
  cleanupPost(post4.id);

  // ---------- 5. com conta conectada, publicação de verdade (mockada) ----------
  const accountId = nanoid();
  db.get('socialAccounts').push({
    id: accountId, brand: 'ghelplus', platform: 'youtube',
    channelId: 'UC_fake_channel', channelTitle: 'GhelPlus',
    refreshToken: 'fake-refresh-token',
    connectedBy: null, connectedByName: 'Teste', connectedAt: new Date().toISOString()
  }).write();

  calls = [];
  shouldFail = false;
  const anyUser = db.get('users').value()[0];
  const post5 = makePost(anyUser ? { responsibleId: anyUser.id, involvedUserIds: [anyUser.id] } : {});
  await youtubePublisher.checkAndPublishScheduledPosts();
  const post5After = db.get('socialPosts').find({ id: post5.id }).value();
  check('publica de verdade: publishStatus vira "published"', post5After.publishStatus === 'published');
  check('publica de verdade: externalPostId gravado', post5After.externalPostId === 'fake-video-id-1');
  check('publica de verdade: externalPermalink montado a partir do id', post5After.externalPermalink === 'https://www.youtube.com/watch?v=fake-video-id-1');
  check('publica de verdade: status também vira "publicado" (mesma cascata da Meta/LinkedIn)', post5After.status === 'publicado');
  check('publica de verdade: pediu access token novo com o refresh token certo', calls.some((c) => c.fn === 'refreshAccessToken' && c.args.refreshToken === 'fake-refresh-token'));
  const uploadCall5 = calls.find((c) => c.fn === 'uploadVideo');
  check('publica de verdade: uploadVideo recebeu título e descrição certos', uploadCall5 && uploadCall5.args.title === 'Vídeo de teste' && uploadCall5.args.description === 'Descrição de teste do YouTube');
  check('publica de verdade: privacyStatus é "public" (Opção A, sem estado privado)', uploadCall5 && uploadCall5.args.privacyStatus === 'public');
  check('publica de verdade: sem capa anexada, NÃO chamou setThumbnail', !calls.some((c) => c.fn === 'setThumbnail'));

  const recadoSucesso = db.get('recados').value().find((r) => r.sourceSocialPostId === post5.id);
  check('publicar com sucesso cria um recado automático', !!recadoSucesso);
  check('recado de sucesso menciona YouTube e publicação', recadoSucesso && /YouTube/.test(recadoSucesso.text) && /publicad[oa] com sucesso/i.test(recadoSucesso.text));
  check('recado de sucesso carrega o link (externalUrl)', recadoSucesso && recadoSucesso.externalUrl === 'https://www.youtube.com/watch?v=fake-video-id-1');
  cleanupPost(post5.id);
  if (recadoSucesso) db.get('recados').remove({ id: recadoSucesso.id }).write();

  // ---------- 6. com capa/thumbnail anexada ----------
  calls = [];
  const post6 = makePost({ thumbnailFile: { id: 'f2', url: '/uploads/social/xyz-youtube/creative/capa.jpg', name: 'capa.jpg' } });
  await youtubePublisher.checkAndPublishScheduledPosts();
  const post6After = db.get('socialPosts').find({ id: post6.id }).value();
  check('com capa: publishStatus vira "published"', post6After.publishStatus === 'published');
  const thumbCall = calls.find((c) => c.fn === 'setThumbnail');
  check('com capa: chamou setThumbnail com o videoId certo', thumbCall && thumbCall.args.videoId === 'fake-video-id-1');
  check('com capa: mimeType certo pra .jpg', thumbCall && thumbCall.args.mimeType === 'image/jpeg');
  cleanupPost(post6.id);

  // ---------- 7. falha só na capa NÃO desfaz o vídeo já publicado ----------
  calls = [];
  shouldFailThumbnail = true;
  const post7 = makePost({ thumbnailFile: { id: 'f2', url: '/uploads/social/xyz-youtube/creative/capa.jpg', name: 'capa.jpg' } });
  await youtubePublisher.checkAndPublishScheduledPosts();
  const post7After = db.get('socialPosts').find({ id: post7.id }).value();
  check('falha só na capa: vídeo publica mesmo assim (published)', post7After.publishStatus === 'published');
  cleanupPost(post7.id);
  shouldFailThumbnail = false;

  // ---------- 8. título maior que 100 caracteres é cortado ----------
  calls = [];
  const longSubject = 'A'.repeat(140);
  const post8 = makePost({ subject: longSubject });
  await youtubePublisher.checkAndPublishScheduledPosts();
  const uploadCall8 = calls.find((c) => c.fn === 'uploadVideo');
  check('título maior que 100 caracteres é cortado antes de mandar pro YouTube', uploadCall8 && uploadCall8.args.title.length === 100);
  cleanupPost(post8.id);

  // ---------- 9. arquivo referenciado não existe mais no disco ----------
  calls = [];
  const post9 = makePost({ files: [{ id: 'f1', url: '/uploads/social/xyz-youtube/creative/nao-existe.mp4', name: 'nao-existe.mp4' }] });
  await youtubePublisher.checkAndPublishScheduledPosts();
  const post9After = db.get('socialPosts').find({ id: post9.id }).value();
  check('arquivo sumiu do disco: falha com mensagem clara (não trava)', post9After.publishStatus === 'failed' && /Não encontrei o arquivo/.test(post9After.publishError || ''));
  cleanupPost(post9.id);

  // ---------- 10. falha simulada no upload do vídeo ----------
  calls = [];
  shouldFail = true;
  const post10 = makePost(anyUser ? { responsibleId: anyUser.id, involvedUserIds: [anyUser.id] } : {});
  await youtubePublisher.checkAndPublishScheduledPosts();
  const post10After = db.get('socialPosts').find({ id: post10.id }).value();
  check('falha simulada: publishStatus vira "failed"', post10After.publishStatus === 'failed');
  check('falha simulada: publishError com a mensagem certa', post10After.publishError === 'Falha simulada no upload do vídeo.');
  check('falha simulada: recado automático de falha criado', db.get('recados').value().some((r) => r.sourceSocialPostId === post10.id && r.text.includes('não consegui publicar')));
  calls = [];
  await youtubePublisher.checkAndPublishScheduledPosts();
  check('não retenta sozinho um post "failed" sem edição', calls.length === 0);
  cleanupPost(post10.id);
  shouldFail = false;

  // ---------- 11. limpeza ----------
  db.get('socialAccounts').remove({ id: accountId }).write();
  fs.rmSync(path.join(__dirname, '..', 'data', 'uploads', 'social', 'xyz-youtube'), { recursive: true, force: true });

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
