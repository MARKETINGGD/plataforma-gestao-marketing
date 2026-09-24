// Teste manual (Node puro, sem servidor HTTP) do publicador automático da
// Meta (utils/metaPublisher.js) — usa o MESMO banco data/db.json da cópia
// de teste isolada, mockando o cliente da Graph API (utils/metaGraphClient)
// pra não precisar de rede/credenciais reais. Rodar com o servidor de
// teste PARADO (lowdb não lida bem com 2 processos escrevendo no mesmo
// arquivo ao mesmo tempo).
process.env.PAPOI_BASE_URL = 'http://localhost:4123';

const assert = require('assert');
const db = require('../db');
const { nanoid } = require('../utils/id');

// ---------- monkeypatch do cliente da Meta (sem rede) ----------
const metaGraph = require('../utils/metaGraphClient');
let publishCalls = [];
let shouldFail = false;
metaGraph.createInstagramMediaContainer = async (args) => {
  publishCalls.push({ fn: 'createInstagramMediaContainer', args });
  if (shouldFail) throw new metaGraph.MetaGraphError('Falha simulada no container.');
  return { id: 'container-fake-1' };
};
// 7ª correção: attemptPublish agora espera o container ficar "FINISHED"
// antes de publicar (achado ao vivo pela Raquel -- "Media ID is not
// available" quando publicava cedo demais) -- sem mockar isso aqui, o
// teste bateria na rede de verdade tentando checar o status.
metaGraph.waitForMediaContainerReady = async (args) => {
  publishCalls.push({ fn: 'waitForMediaContainerReady', args });
  if (shouldFail) throw new metaGraph.MetaGraphError('Falha simulada: container nunca ficou pronto.');
};
metaGraph.publishInstagramMediaContainer = async (args) => {
  publishCalls.push({ fn: 'publishInstagramMediaContainer', args });
  if (shouldFail) throw new metaGraph.MetaGraphError('Falha simulada ao publicar.');
  return { id: 'ig-post-fake-1' };
};
// 8ª correção (Carrossel) -- cada imagem chamada gera um id de container
// filho diferente e previsível (child-N), pra confirmar a ordem certa
// depois no container pai.
let childContainerCounter = 0;
metaGraph.createInstagramCarouselChildContainer = async (args) => {
  publishCalls.push({ fn: 'createInstagramCarouselChildContainer', args });
  if (shouldFail) throw new metaGraph.MetaGraphError('Falha simulada no container filho do carrossel.');
  childContainerCounter += 1;
  return { id: `child-${childContainerCounter}` };
};
metaGraph.createInstagramCarouselContainer = async (args) => {
  publishCalls.push({ fn: 'createInstagramCarouselContainer', args });
  if (shouldFail) throw new metaGraph.MetaGraphError('Falha simulada no container pai do carrossel.');
  return { id: 'carousel-parent-fake-1' };
};
// 9ª melhoria (Reels) -- reusa o mesmo `waitForMediaContainerReady` mockado
// acima, mas o publisher passa os parâmetros de tempo de VÍDEO
// (VIDEO_CONTAINER_POLL_INTERVAL_MS/TIMEOUT_MS) -- os testes abaixo
// conferem que esses valores de verdade (não os padrão de imagem) são os
// repassados.
metaGraph.createInstagramReelsContainer = async (args) => {
  publishCalls.push({ fn: 'createInstagramReelsContainer', args });
  if (shouldFail) throw new metaGraph.MetaGraphError('Falha simulada no container do Reels.');
  return { id: 'reels-container-fake-1' };
};
// 10ª melhoria (Storie) -- aceita foto OU vídeo, sem legenda nenhuma (a
// própria Meta não aceita) -- o mock confirma que `caption` nunca é
// passado (a função nem tem esse parâmetro de propósito).
metaGraph.createInstagramStoryContainer = async (args) => {
  publishCalls.push({ fn: 'createInstagramStoryContainer', args });
  if (shouldFail) throw new metaGraph.MetaGraphError('Falha simulada no container do Storie.');
  return { id: 'storie-container-fake-1' };
};
metaGraph.publishFacebookPagePost = async (args) => {
  publishCalls.push({ fn: 'publishFacebookPagePost', args });
  if (shouldFail) throw new metaGraph.MetaGraphError('Falha simulada no Facebook.');
  return { id: 'fb-post-fake-1', post_id: 'fb-post-fake-1' };
};
metaGraph.getPermalink = async () => 'https://instagram.com/p/fake/';

const metaPublisher = require('../utils/metaPublisher');

function makePost(overrides) {
  const post = Object.assign({
    id: nanoid(),
    brand: 'ghelplus',
    platform: 'instagram',
    scheduledDate: '2020-01-01',
    scheduledTime: '08:00',
    caption: 'Legenda de teste',
    postType: 'estatico',
    status: 'rascunho',
    publishStatus: null,
    involvedUserIds: [],
    responsibleId: null,
    files: [{ id: 'f1', url: '/uploads/social/xyz/creative/foto.jpg', name: 'foto.jpg' }],
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
function cleanupAccount(id) {
  db.get('socialAccounts').remove({ id }).write();
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

  // ---------- 1. sem conta conectada: isEligible ainda é true (elegibilidade
  //    não depende de conta -- só publishOne() checa a conta na hora de
  //    publicar), mas checkAndPublishScheduledPosts não deve publicar nada
  //    (sem conta = publishOne sai cedo, sem mexer no post). ----------
  db.get('socialAccounts').remove({ brand: 'ghelplus', platform: 'meta' }).write();
  const post1 = makePost({});
  check('post elegível mesmo sem conta conectada (isEligible só olha o post)', metaPublisher.isEligible(post1) === true);
  await metaPublisher.checkAndPublishScheduledPosts();
  const post1After = db.get('socialPosts').find({ id: post1.id }).value();
  check('sem conta conectada: post NÃO foi tocado (publishStatus continua null)', post1After.publishStatus === null);
  cleanupPost(post1.id);

  // ---------- 2. com conta conectada, sucesso ----------
  const accountId = nanoid();
  db.get('socialAccounts').push({
    id: accountId, brand: 'ghelplus', platform: 'meta',
    igUserId: 'ig-123', igUsername: 'ghelplus_oficial',
    pageId: 'page-123', pageName: 'GhelPlus', pageAccessToken: 'fake-page-token',
    tokenExpiresAt: new Date(Date.now() + 1000000).toISOString(),
    connectedBy: null, connectedByName: 'Teste', connectedAt: new Date().toISOString()
  }).write();

  publishCalls = [];
  shouldFail = false;
  const post2 = makePost({});
  await metaPublisher.checkAndPublishScheduledPosts();
  const post2After = db.get('socialPosts').find({ id: post2.id }).value();
  check('com conta conectada: publishStatus vira "published"', post2After.publishStatus === 'published');
  check('externalPostId gravado', post2After.externalPostId === 'ig-post-fake-1');
  check('externalPermalink gravado', post2After.externalPermalink === 'https://instagram.com/p/fake/');
  check('status também vira "publicado" (cascata igual ao fluxo manual)', post2After.status === 'publicado');
  check('chamou createInstagramMediaContainer com a imageUrl pública certa',
    publishCalls.some((c) => c.fn === 'createInstagramMediaContainer' && c.args.imageUrl === 'http://localhost:4123/uploads/social/xyz/creative/foto.jpg'));
  const callsBeforeSecondRun = publishCalls.length;
  await metaPublisher.checkAndPublishScheduledPosts();
  check('não tentou publicar de novo numa 2ª chamada (já está "published")', publishCalls.length === callsBeforeSecondRun);
  cleanupPost(post2.id);

  // ---------- 3. com conta conectada, falha simulada ----------
  publishCalls = [];
  shouldFail = true;
  const anyUser = db.get('users').value()[0];
  const post3 = makePost(anyUser ? { responsibleId: anyUser.id, involvedUserIds: [anyUser.id] } : {});
  await metaPublisher.checkAndPublishScheduledPosts();
  const post3After = db.get('socialPosts').find({ id: post3.id }).value();
  check('falha simulada: publishStatus vira "failed"', post3After.publishStatus === 'failed');
  check('publishError preenchido com a mensagem', post3After.publishError === 'Falha simulada no container.');
  check('recado automático criado avisando a falha', db.get('recados').value().some((r) => r.sourceSocialPostId === post3.id && r.text.includes('não consegui publicar')));
  // não tenta de novo sozinho enquanto continuar 'failed'
  publishCalls = [];
  await metaPublisher.checkAndPublishScheduledPosts();
  check('não retenta sozinho um post "failed" sem edição', publishCalls.length === 0);
  cleanupPost(post3.id);
  shouldFail = false;

  // ---------- 4. Carrossel (8ª correção) — sucesso com 3 imagens ----------
  publishCalls = [];
  childContainerCounter = 0;
  const post4 = makePost({
    postType: 'carrossel',
    files: [
      { id: 'c1', url: '/uploads/social/xyz/creative/1.jpg', name: '1.jpg' },
      { id: 'c2', url: '/uploads/social/xyz/creative/2.jpg', name: '2.jpg' },
      { id: 'c3', url: '/uploads/social/xyz/creative/3.jpg', name: '3.jpg' }
    ]
  });
  await metaPublisher.checkAndPublishScheduledPosts();
  const post4After = db.get('socialPosts').find({ id: post4.id }).value();
  check('carrossel com 3 imagens: publishStatus vira "published"', post4After.publishStatus === 'published');
  check('carrossel: externalPostId é o do container PAI publicado', post4After.externalPostId === 'ig-post-fake-1');
  const childCalls = publishCalls.filter((c) => c.fn === 'createInstagramCarouselChildContainer');
  check('carrossel: criou exatamente 3 containers filhos (1 por imagem)', childCalls.length === 3);
  check('carrossel: containers filhos na ORDEM certa das imagens', childCalls.map((c) => c.args.imageUrl).join(',') === [
    'http://localhost:4123/uploads/social/xyz/creative/1.jpg',
    'http://localhost:4123/uploads/social/xyz/creative/2.jpg',
    'http://localhost:4123/uploads/social/xyz/creative/3.jpg'
  ].join(','));
  check('carrossel: esperou cada filho ficar pronto (3x) mais o pai (1x) = 4 esperas', publishCalls.filter((c) => c.fn === 'waitForMediaContainerReady').length === 4);
  const parentCall = publishCalls.find((c) => c.fn === 'createInstagramCarouselContainer');
  check('carrossel: container pai criado com os 3 IDs filhos, na ordem certa', parentCall && parentCall.args.childrenIds.join(',') === 'child-1,child-2,child-3');
  check('carrossel: legenda vai só no container pai (não nos filhos)', parentCall && parentCall.args.caption === 'Legenda de teste');
  cleanupPost(post4.id);

  // ---------- 5. Carrossel com quantidade de imagens inválida (1 só) ----------
  publishCalls = [];
  const post5 = makePost({ postType: 'carrossel', files: [{ id: 'c1', url: '/uploads/social/xyz/creative/1.jpg', name: '1.jpg' }] });
  await metaPublisher.checkAndPublishScheduledPosts();
  const post5After = db.get('socialPosts').find({ id: post5.id }).value();
  check('carrossel com só 1 imagem: falha (Instagram exige de 2 a 10)', post5After.publishStatus === 'failed');
  check('carrossel com 1 imagem: mensagem de erro explica o limite (2 a 10)', post5After.publishError && post5After.publishError.includes('2 a 10') && post5After.publishError.includes('tem 1'));
  check('carrossel com 1 imagem: NÃO chegou a chamar a Graph API de verdade (validação antes)', publishCalls.length === 0);
  cleanupPost(post5.id);

  // ---------- 6. Carrossel com quantidade acima do limite (11 imagens) ----------
  const post6 = makePost({
    postType: 'carrossel',
    files: Array.from({ length: 11 }, (_, i) => ({ id: `c${i}`, url: `/uploads/social/xyz/creative/${i}.jpg`, name: `${i}.jpg` }))
  });
  await metaPublisher.checkAndPublishScheduledPosts();
  const post6After = db.get('socialPosts').find({ id: post6.id }).value();
  check('carrossel com 11 imagens: falha (acima do limite de 10)', post6After.publishStatus === 'failed' && post6After.publishError.includes('tem 11'));
  cleanupPost(post6.id);

  // ---------- 7. Reels (9ª melhoria) — sucesso com 1 vídeo ----------
  publishCalls = [];
  const post7 = makePost({
    postType: 'reels',
    files: [{ id: 'v1', url: '/uploads/social/xyz/creative/video.mp4', name: 'video.mp4' }]
  });
  await metaPublisher.checkAndPublishScheduledPosts();
  const post7After = db.get('socialPosts').find({ id: post7.id }).value();
  check('reels com 1 vídeo MP4: publishStatus vira "published"', post7After.publishStatus === 'published');
  check('reels: externalPostId é o do container publicado', post7After.externalPostId === 'ig-post-fake-1');
  const reelsCall = publishCalls.find((c) => c.fn === 'createInstagramReelsContainer');
  check('reels: chamou createInstagramReelsContainer com o videoUrl público certo', reelsCall && reelsCall.args.videoUrl === 'http://localhost:4123/uploads/social/xyz/creative/video.mp4');
  check('reels: legenda repassada certinha', reelsCall && reelsCall.args.caption === 'Legenda de teste');
  check('reels sem capa enviada: coverUrl não é passado pra Meta (usa o frame 0 padrão)', reelsCall && reelsCall.args.coverUrl === undefined);
  const reelsWaitCall = publishCalls.find((c) => c.fn === 'waitForMediaContainerReady' && c.args.containerId === 'reels-container-fake-1');
  check('reels: espera usando os parâmetros de tempo de VÍDEO (bem maiores que o padrão de imagem)',
    reelsWaitCall && reelsWaitCall.args.timeoutMs === metaGraph.VIDEO_CONTAINER_POLL_TIMEOUT_MS && reelsWaitCall.args.pollIntervalMs === metaGraph.VIDEO_CONTAINER_POLL_INTERVAL_MS);
  cleanupPost(post7.id);

  // ---------- 7b. Reels COM capa customizada (11ª melhoria, pedido da
  // Raquel: "preciso que a capa do reels seja publicada tbm") ----------
  publishCalls = [];
  const post7b = makePost({
    postType: 'reels',
    files: [{ id: 'v1', url: '/uploads/social/xyz/creative/video.mp4', name: 'video.mp4' }],
    thumbnailFile: { id: 't1', url: '/uploads/social/xyz/thumbnail/capa.jpg', name: 'capa.jpg' }
  });
  await metaPublisher.checkAndPublishScheduledPosts();
  const post7bAfter = db.get('socialPosts').find({ id: post7b.id }).value();
  check('reels com capa: publishStatus vira "published"', post7bAfter.publishStatus === 'published');
  const reelsCallComCapa = publishCalls.find((c) => c.fn === 'createInstagramReelsContainer');
  check('reels com capa: manda cover_url com a URL pública da capa (confirmado como parâmetro real da Meta pra Reels)',
    reelsCallComCapa && reelsCallComCapa.args.coverUrl === 'http://localhost:4123/uploads/social/xyz/thumbnail/capa.jpg');
  cleanupPost(post7b.id);

  // ---------- 8. Reels com arquivo que não parece vídeo (extensão errada) ----------
  publishCalls = [];
  const post8 = makePost({
    postType: 'reels',
    files: [{ id: 'f1', url: '/uploads/social/xyz/creative/foto.jpg', name: 'foto.jpg' }]
  });
  await metaPublisher.checkAndPublishScheduledPosts();
  const post8After = db.get('socialPosts').find({ id: post8.id }).value();
  check('reels com arquivo .jpg (não é vídeo): falha com mensagem clara', post8After.publishStatus === 'failed' && post8After.publishError.includes('não parece ser um vídeo') && post8After.publishError.includes('MP4 ou MOV'));
  check('reels com arquivo errado: NÃO chegou a chamar a Graph API de verdade (validação antes)', publishCalls.length === 0);
  cleanupPost(post8.id);

  // ---------- 9. Reels com mais de 1 arquivo (Instagram exige exatamente 1 vídeo) ----------
  const post9 = makePost({
    postType: 'reels',
    files: [
      { id: 'v1', url: '/uploads/social/xyz/creative/video1.mp4', name: 'video1.mp4' },
      { id: 'v2', url: '/uploads/social/xyz/creative/video2.mp4', name: 'video2.mp4' }
    ]
  });
  await metaPublisher.checkAndPublishScheduledPosts();
  const post9After = db.get('socialPosts').find({ id: post9.id }).value();
  check('reels com 2 arquivos: falha (precisa de exatamente 1 vídeo)', post9After.publishStatus === 'failed' && post9After.publishError.includes('exatamente 1 vídeo') && post9After.publishError.includes('tem 2'));
  cleanupPost(post9.id);

  // ---------- 10. Reels aceita .mov também (não só .mp4) ----------
  publishCalls = [];
  const post10 = makePost({
    postType: 'reels',
    files: [{ id: 'v1', url: '/uploads/social/xyz/creative/video.mov', name: 'video.mov' }]
  });
  await metaPublisher.checkAndPublishScheduledPosts();
  const post10After = db.get('socialPosts').find({ id: post10.id }).value();
  check('reels com vídeo .mov: também publica com sucesso', post10After.publishStatus === 'published');
  cleanupPost(post10.id);

  // ---------- 11. Storie (10ª melhoria) — sucesso com FOTO ----------
  publishCalls = [];
  const post11 = makePost({
    postType: 'storie',
    files: [{ id: 'f1', url: '/uploads/social/xyz/creative/foto-storie.jpg', name: 'foto-storie.jpg' }]
  });
  await metaPublisher.checkAndPublishScheduledPosts();
  const post11After = db.get('socialPosts').find({ id: post11.id }).value();
  check('storie com 1 foto: publishStatus vira "published"', post11After.publishStatus === 'published');
  const storieCallFoto = publishCalls.find((c) => c.fn === 'createInstagramStoryContainer');
  check('storie com foto: mediaUrl certo e isVideo=false', storieCallFoto && storieCallFoto.args.mediaUrl === 'http://localhost:4123/uploads/social/xyz/creative/foto-storie.jpg' && storieCallFoto.args.isVideo === false);
  check('storie: NUNCA manda legenda pra Meta (a própria função nem aceita esse parâmetro)', storieCallFoto && storieCallFoto.args.caption === undefined);
  const storieWaitCallFoto = publishCalls.find((c) => c.fn === 'waitForMediaContainerReady' && c.args.containerId === 'storie-container-fake-1');
  check('storie com foto: usa os tempos de espera de IMAGEM (não os de vídeo, bem mais lentos)', storieWaitCallFoto && storieWaitCallFoto.args.pollIntervalMs === undefined && storieWaitCallFoto.args.timeoutMs === undefined);
  cleanupPost(post11.id);

  // ---------- 12. Storie — sucesso com VÍDEO ----------
  publishCalls = [];
  const post12 = makePost({
    postType: 'storie',
    files: [{ id: 'v1', url: '/uploads/social/xyz/creative/video-storie.mp4', name: 'video-storie.mp4' }]
  });
  await metaPublisher.checkAndPublishScheduledPosts();
  const post12After = db.get('socialPosts').find({ id: post12.id }).value();
  check('storie com 1 vídeo: publishStatus vira "published"', post12After.publishStatus === 'published');
  const storieCallVideo = publishCalls.find((c) => c.fn === 'createInstagramStoryContainer');
  check('storie com vídeo: isVideo=true', storieCallVideo && storieCallVideo.args.isVideo === true);
  const storieWaitCallVideo = publishCalls.find((c) => c.fn === 'waitForMediaContainerReady' && c.args.containerId === 'storie-container-fake-1');
  check('storie com vídeo: usa os tempos de espera de VÍDEO (bem maiores que os de imagem)',
    storieWaitCallVideo && storieWaitCallVideo.args.timeoutMs === metaGraph.VIDEO_CONTAINER_POLL_TIMEOUT_MS && storieWaitCallVideo.args.pollIntervalMs === metaGraph.VIDEO_CONTAINER_POLL_INTERVAL_MS);
  cleanupPost(post12.id);

  // ---------- 13. Storie com mais de 1 arquivo (só aceita 1 foto OU 1 vídeo) ----------
  const post13 = makePost({
    postType: 'storie',
    files: [
      { id: 'f1', url: '/uploads/social/xyz/creative/1.jpg', name: '1.jpg' },
      { id: 'f2', url: '/uploads/social/xyz/creative/2.jpg', name: '2.jpg' }
    ]
  });
  await metaPublisher.checkAndPublishScheduledPosts();
  const post13After = db.get('socialPosts').find({ id: post13.id }).value();
  check('storie com 2 arquivos: falha (precisa de exatamente 1)', post13After.publishStatus === 'failed' && post13After.publishError.includes('exatamente 1') && post13After.publishError.includes('tem 2'));
  cleanupPost(post13.id);

  // ---------- 14. elegibilidade: cada regra de exclusão isoladamente ----------
  check('elegível: postType carrossel no Instagram (8ª correção, novo escopo)', metaPublisher.isEligible(makePostObjOnly({ postType: 'carrossel', files: [{ url: '/a.jpg' }, { url: '/b.jpg' }] })));
  check('não elegível: postType carrossel no Facebook (fora do escopo -- mecanismo de multi-foto é diferente)', !metaPublisher.isEligible(makePostObjOnly({ postType: 'carrossel', platform: 'facebook', files: [{ url: '/a.jpg' }, { url: '/b.jpg' }] })));
  check('elegível: postType reels no Instagram (9ª melhoria, novo escopo)', metaPublisher.isEligible(makePostObjOnly({ postType: 'reels', files: [{ url: '/v.mp4' }] })));
  check('não elegível: postType reels no Facebook (fora do escopo)', !metaPublisher.isEligible(makePostObjOnly({ postType: 'reels', platform: 'facebook', files: [{ url: '/v.mp4' }] })));
  check('elegível: postType storie no Instagram (10ª melhoria, novo escopo)', metaPublisher.isEligible(makePostObjOnly({ postType: 'storie', files: [{ url: '/f.jpg' }] })));
  check('não elegível: postType storie no Facebook (fora do escopo)', !metaPublisher.isEligible(makePostObjOnly({ postType: 'storie', platform: 'facebook', files: [{ url: '/f.jpg' }] })));
  check('não elegível: postType video_tiktok (plataforma diferente, fora do escopo)', !metaPublisher.isEligible(makePostObjOnly({ postType: 'video_tiktok', platform: 'tiktok' })));
  check('não elegível: plataforma linkedin', !metaPublisher.isEligible(makePostObjOnly({ platform: 'linkedin' })));
  check('não elegível: marca duranox (sem app Meta ainda)', !metaPublisher.isEligible(makePostObjOnly({ brand: 'duranox' })));
  check('não elegível: sem legenda', !metaPublisher.isEligible(makePostObjOnly({ caption: '' })));
  check('não elegível: sem arquivo', !metaPublisher.isEligible(makePostObjOnly({ files: [] })));
  check('não elegível: data no futuro (ainda não chegou a hora)', !metaPublisher.isEligible(makePostObjOnly({ scheduledDate: '2099-01-01' })));
  check('não elegível: já publicado antes', !metaPublisher.isEligible(makePostObjOnly({ publishStatus: 'published' })));
  check('não elegível: já falhou antes (só reelegível depois de editar)', !metaPublisher.isEligible(makePostObjOnly({ publishStatus: 'failed' })));

  // ---------- 15. bug real achado ao vivo pela Raquel (11ª melhoria):
  // Storie sem legenda ficava parado pra sempre, sem publicar e sem
  // NENHUM aviso -- porque isEligible exigia legenda preenchida até pra
  // Storie, mesmo a legenda nunca sendo mandada pra Meta nesse caso (ver
  // createInstagramStoryContainer). Confirma que Storie sem legenda AGORA
  // é elegível, e que os outros tipos continuam exigindo legenda
  // normalmente (a legenda É de verdade usada/mandada pra Meta neles). ----------
  check('CORREÇÃO: Storie SEM legenda agora é elegível (legenda nunca vai pra Meta nesse caso mesmo)',
    metaPublisher.isEligible(makePostObjOnly({ postType: 'storie', caption: '', files: [{ url: '/f.jpg' }] })));
  check('Estático sem legenda continua INELEGÍVEL (legenda de verdade vai pra Meta nesse caso)',
    !metaPublisher.isEligible(makePostObjOnly({ postType: 'estatico', caption: '' })));
  check('Carrossel sem legenda continua INELEGÍVEL', !metaPublisher.isEligible(makePostObjOnly({ postType: 'carrossel', caption: '', files: [{ url: '/a.jpg' }, { url: '/b.jpg' }] })));
  check('Reels sem legenda continua INELEGÍVEL', !metaPublisher.isEligible(makePostObjOnly({ postType: 'reels', caption: '', files: [{ url: '/v.mp4' }] })));

  // ---------- 16. isMetaAutoPublishSupported exportado (reaproveitado por
  // routes/socialPosts.js pra saber, na hora de marcar "Publicado" na mão,
  // se aquele post é de um tipo que a Papoi publica sozinha) ----------
  check('isMetaAutoPublishSupported exportado e bate com a mesma matriz rede+tipo+marca do isEligible',
    typeof metaPublisher.isMetaAutoPublishSupported === 'function'
    && metaPublisher.isMetaAutoPublishSupported({ platform: 'instagram', postType: 'storie', brand: 'ghelplus' }) === true
    && metaPublisher.isMetaAutoPublishSupported({ platform: 'facebook', postType: 'storie', brand: 'ghelplus' }) === false
    && metaPublisher.isMetaAutoPublishSupported({ platform: 'instagram', postType: 'video_tiktok', brand: 'ghelplus' }) === false
    && metaPublisher.isMetaAutoPublishSupported({ platform: 'instagram', postType: 'estatico', brand: 'duranox' }) === false);
  check('publishOne e findConnectedAccount também exportados (reaproveitados pelo "publicar agora" manual)',
    typeof metaPublisher.publishOne === 'function' && typeof metaPublisher.findConnectedAccount === 'function');

  function makePostObjOnly(overrides) {
    return Object.assign({
      id: 'obj-only', brand: 'ghelplus', platform: 'instagram', scheduledDate: '2020-01-01', scheduledTime: '08:00',
      caption: 'x', postType: 'estatico', publishStatus: null, files: [{ url: '/x.jpg' }]
    }, overrides);
  }

  cleanupAccount(accountId);

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
