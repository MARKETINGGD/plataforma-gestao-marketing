// Teste manual (Node puro, sem servidor HTTP) do publicador automático da
// TikTok (utils/tiktokPublisher.js) — mesmo padrão de
// youtubePublisher.test.js/pinterestPublisher: usa o banco data/db.json da
// cópia de teste isolada, mockando o cliente da TikTok (utils/tiktokClient)
// pra não precisar de rede/credenciais reais (que, no caso da TikTok, nem
// existem ainda -- depende de uma auditoria própria da TikTok, ver
// PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md). Rodar com o servidor de
// teste PARADO (lowdb não lida bem com 2 processos escrevendo no mesmo
// arquivo ao mesmo tempo).
process.env.PAPOI_BASE_URL = 'http://localhost:4123';
process.env.TIKTOK_CLIENT_KEY = 'fake-client-key';
process.env.TIKTOK_CLIENT_SECRET = 'fake-client-secret';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { nanoid } = require('../utils/id');

// ---------- monkeypatch do cliente da TikTok (sem rede) ----------
const tiktokClient = require('../utils/tiktokClient');
let calls = [];
let shouldFailInit = false;
let refreshTokenToReturn = 'fake-refresh-token'; // por padrão, "não rotaciona" (devolve o mesmo)
let privacyLevelOptionsToReturn = ['SELF_ONLY', 'PUBLIC_TO_EVERYONE']; // "App já auditado" por padrão nos testes básicos
tiktokClient.refreshAccessToken = async (args) => {
  calls.push({ fn: 'refreshAccessToken', args: { refreshToken: args.refreshToken } });
  return { access_token: 'fake-access-token', refresh_token: refreshTokenToReturn, expires_in: 86400 };
};
tiktokClient.queryCreatorInfo = async (args) => {
  calls.push({ fn: 'queryCreatorInfo', args: { accessToken: args.accessToken } });
  return {
    creatorUsername: 'ghelplus.oficial',
    creatorNickname: 'GhelPlus',
    creatorAvatarUrl: 'https://example.com/avatar.jpg',
    privacyLevelOptions: privacyLevelOptionsToReturn,
    commentDisabled: false,
    duetDisabled: false,
    stitchDisabled: false,
    maxVideoPostDurationSec: 600
  };
};
tiktokClient.initDirectPostFromUrl = async (args) => {
  calls.push({ fn: 'initDirectPostFromUrl', args: { videoUrl: args.videoUrl, title: args.title, privacyLevel: args.privacyLevel } });
  if (shouldFailInit) throw new tiktokClient.TikTokApiError('Falha simulada iniciando a publicação na TikTok.');
  return 'fake-publish-id-1';
};
tiktokClient.waitForPublishComplete = async (args) => {
  calls.push({ fn: 'waitForPublishComplete', args: { publishId: args.publishId } });
  return { status: 'PUBLISH_COMPLETE', failReason: null, publiclyAvailablePostIds: [] };
};

const tiktokPublisher = require('../utils/tiktokPublisher');

function makePost(overrides) {
  const post = Object.assign({
    id: nanoid(),
    brand: 'ghelplus',
    platform: 'tiktok',
    postType: 'video_tiktok',
    scheduledDate: '2020-01-01',
    scheduledTime: '08:00',
    subject: 'Vídeo de teste',
    caption: 'Legenda de teste da TikTok #teste',
    status: 'rascunho',
    publishStatus: null,
    involvedUserIds: [],
    responsibleId: null,
    files: [{ id: 'f1', url: '/uploads/social/xyz-tiktok/creative/video.mp4', name: 'video.mp4' }],
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

  // ---------- 0. choosePrivacyLevel isolado ----------
  check('choosePrivacyLevel: escolhe PUBLIC_TO_EVERYONE quando disponível (App auditado)', tiktokPublisher.choosePrivacyLevel(['SELF_ONLY', 'PUBLIC_TO_EVERYONE']) === 'PUBLIC_TO_EVERYONE');
  check('choosePrivacyLevel: cai pro único disponível quando não tem público (pré-auditoria)', tiktokPublisher.choosePrivacyLevel(['SELF_ONLY']) === 'SELF_ONLY');
  check('choosePrivacyLevel: nunca quebra com lista vazia/undefined (usa SELF_ONLY como último recurso)', tiktokPublisher.choosePrivacyLevel([]) === 'SELF_ONLY' && tiktokPublisher.choosePrivacyLevel(undefined) === 'SELF_ONLY');

  // ---------- 1. sem conta conectada: elegível, mas não publica nada ----------
  db.get('socialAccounts').remove({ brand: 'ghelplus', platform: 'tiktok' }).write();
  const post1 = makePost({});
  check('post elegível mesmo sem conta conectada (isEligible só olha o post)', tiktokPublisher.isEligible(post1) === true);
  await tiktokPublisher.checkAndPublishScheduledPosts();
  const post1After = db.get('socialPosts').find({ id: post1.id }).value();
  check('sem conta conectada: post NÃO foi tocado (publishStatus continua null)', post1After.publishStatus === null);
  cleanupPost(post1.id);

  // ---------- 2. sem legenda: não elegível ----------
  const post2 = makePost({ caption: '' });
  check('sem legenda: NÃO elegível (vira o title do post na TikTok)', tiktokPublisher.isEligible(post2) === false);
  cleanupPost(post2.id);

  // ---------- 3. mais de 1 arquivo: v1 não suporta ----------
  const post3 = makePost({
    files: [
      { id: 'f1', url: '/uploads/social/xyz-tiktok/creative/video.mp4', name: 'video.mp4' },
      { id: 'f2', url: '/uploads/social/xyz-tiktok/creative/video2.mp4', name: 'video2.mp4' }
    ]
  });
  check('mais de 1 arquivo: NÃO elegível pra publicação automática nesta 1ª versão', tiktokPublisher.isEligible(post3) === false);
  cleanupPost(post3.id);

  // ---------- 4. arquivo que não parece vídeo: não elegível ----------
  const post4 = makePost({ files: [{ id: 'f1', url: '/uploads/social/xyz-tiktok/creative/foto.jpg', name: 'foto.jpg' }] });
  check('arquivo não é vídeo: NÃO elegível', tiktokPublisher.isEligible(post4) === false);
  cleanupPost(post4.id);

  // ---------- 5. com conta conectada, publicação de verdade (mockada), App já auditado ----------
  const accountId = nanoid();
  db.get('socialAccounts').push({
    id: accountId, brand: 'ghelplus', platform: 'tiktok',
    creatorUsername: 'ghelplus.oficial', creatorNickname: 'GhelPlus',
    refreshToken: 'fake-refresh-token',
    connectedBy: null, connectedByName: 'Teste', connectedAt: new Date().toISOString()
  }).write();

  calls = [];
  refreshTokenToReturn = 'fake-refresh-token'; // não rotaciona nesta rodada
  privacyLevelOptionsToReturn = ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'];
  const anyUser = db.get('users').value()[0];
  const post5 = makePost(anyUser ? { responsibleId: anyUser.id, involvedUserIds: [anyUser.id] } : {});
  await tiktokPublisher.checkAndPublishScheduledPosts();
  const post5After = db.get('socialPosts').find({ id: post5.id }).value();
  check('publica de verdade: publishStatus vira "published"', post5After.publishStatus === 'published');
  check('publica de verdade: externalPostId é o publish_id', post5After.externalPostId === 'fake-publish-id-1');
  check('publica de verdade: externalPermalink é o perfil da criadora', post5After.externalPermalink === 'https://www.tiktok.com/@ghelplus.oficial');
  check('publica de verdade: status também vira "publicado" (mesma cascata das outras redes)', post5After.status === 'publicado');
  check('publica de verdade: pediu access token novo com o refresh token certo', calls.some((c) => c.fn === 'refreshAccessToken' && c.args.refreshToken === 'fake-refresh-token'));
  check('publica de verdade: consultou creator_info antes de publicar', calls.some((c) => c.fn === 'queryCreatorInfo'));
  const initCall5 = calls.find((c) => c.fn === 'initDirectPostFromUrl');
  check('publica de verdade: initDirectPostFromUrl recebeu o title certo (a legenda)', initCall5 && initCall5.args.title === 'Legenda de teste da TikTok #teste');
  check('publica de verdade: URL pública do vídeo montada certo (PAPOI_BASE_URL + file.url)', initCall5 && initCall5.args.videoUrl === 'http://localhost:4123/uploads/social/xyz-tiktok/creative/video.mp4');
  check('publica de verdade: App já auditado -> privacyLevel PUBLIC_TO_EVERYONE', initCall5 && initCall5.args.privacyLevel === 'PUBLIC_TO_EVERYONE');
  check('publica de verdade: esperou o status ficar pronto (waitForPublishComplete) com o publishId certo', calls.some((c) => c.fn === 'waitForPublishComplete' && c.args.publishId === 'fake-publish-id-1'));

  const recadoSucesso = db.get('recados').value().find((r) => r.sourceSocialPostId === post5.id);
  check('publicar com sucesso cria um recado automático', !!recadoSucesso);
  check('recado de sucesso menciona TikTok e publicação', recadoSucesso && /TikTok/.test(recadoSucesso.text) && /publicad[oa] com sucesso/i.test(recadoSucesso.text));
  check('App já auditado: recado de sucesso NÃO menciona modo privado', recadoSucesso && !/modo PRIVADO/.test(recadoSucesso.text));
  check('recado de sucesso carrega o link do perfil (externalUrl)', recadoSucesso && recadoSucesso.externalUrl === 'https://www.tiktok.com/@ghelplus.oficial');
  cleanupPost(post5.id);
  if (recadoSucesso) db.get('recados').remove({ id: recadoSucesso.id }).write();

  // ---------- 6. App NÃO auditado ainda: só SELF_ONLY disponível -> publica privado e avisa ----------
  calls = [];
  privacyLevelOptionsToReturn = ['SELF_ONLY'];
  const post6 = makePost(anyUser ? { responsibleId: anyUser.id, involvedUserIds: [anyUser.id] } : {});
  await tiktokPublisher.checkAndPublishScheduledPosts();
  const post6After = db.get('socialPosts').find({ id: post6.id }).value();
  check('pré-auditoria: publica mesmo assim (published)', post6After.publishStatus === 'published');
  const initCall6 = calls.find((c) => c.fn === 'initDirectPostFromUrl');
  check('pré-auditoria: privacyLevel cai pra SELF_ONLY (só o que a TikTok libera antes de auditar)', initCall6 && initCall6.args.privacyLevel === 'SELF_ONLY');
  const recado6 = db.get('recados').value().find((r) => r.sourceSocialPostId === post6.id);
  check('pré-auditoria: recado de sucesso AVISA que saiu em modo privado', recado6 && /modo PRIVADO/.test(recado6.text));
  cleanupPost(post6.id);
  if (recado6) db.get('recados').remove({ id: recado6.id }).write();
  privacyLevelOptionsToReturn = ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'];

  // ---------- 7. refresh_token rotacionado -- precisa salvar o novo ----------
  calls = [];
  refreshTokenToReturn = 'novo-refresh-token-rotacionado';
  const post7 = makePost({});
  await tiktokPublisher.checkAndPublishScheduledPosts();
  const accountAfter7 = db.get('socialAccounts').find({ id: accountId }).value();
  check('refresh_token rotacionado pela TikTok é salvo de volta (senão a próxima renovação falha)', accountAfter7.refreshToken === 'novo-refresh-token-rotacionado');
  cleanupPost(post7.id);
  const recado7 = db.get('recados').value().find((r) => r.sourceSocialPostId === post7.id);
  if (recado7) db.get('recados').remove({ id: recado7.id }).write();
  refreshTokenToReturn = 'novo-refresh-token-rotacionado'; // mantém consistente com o que já foi salvo

  // ---------- 8. falha simulada iniciando a publicação ----------
  calls = [];
  shouldFailInit = true;
  const post8 = makePost(anyUser ? { responsibleId: anyUser.id, involvedUserIds: [anyUser.id] } : {});
  await tiktokPublisher.checkAndPublishScheduledPosts();
  const post8After = db.get('socialPosts').find({ id: post8.id }).value();
  check('falha simulada: publishStatus vira "failed"', post8After.publishStatus === 'failed');
  check('falha simulada: publishError com a mensagem certa', post8After.publishError === 'Falha simulada iniciando a publicação na TikTok.');
  check('falha simulada: recado automático de falha criado', db.get('recados').value().some((r) => r.sourceSocialPostId === post8.id && r.text.includes('não consegui publicar')));
  calls = [];
  await tiktokPublisher.checkAndPublishScheduledPosts();
  check('não retenta sozinho um post "failed" sem edição', calls.length === 0);
  cleanupPost(post8.id);
  shouldFailInit = false;

  // ---------- 9. limpeza ----------
  db.get('socialAccounts').remove({ id: accountId }).write();
  db.get('recados').remove((r) => r.postNetwork === 'tiktok').write();

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
