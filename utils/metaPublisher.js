// Publicador automático da Meta (54ª rodada — conectar o Agendamento de
// Redes Sociais à API de verdade, pedido priorizado pela Raquel: Meta
// primeiro). Mesmo padrão de temporizador já usado em
// utils/pontoReminders.js (47ª rodada) — um `setInterval` de verdade rodando
// sozinho no servidor, já que publicar "no horário certo" não é algo que
// reage a uma ação de alguém.
//
// Escopo (deliberadamente restrito, pra sair do zero pro ar rápido, e
// crescido aos poucos a pedido da Raquel): publica post ESTÁTICO (1
// imagem), CARROSSEL (2 a 10 imagens, 8ª correção), REELS (1 vídeo, 9ª
// melhoria) e STORIE (1 foto OU vídeo, 10ª melhoria), tanto no Instagram
// quanto no Facebook (82ª rodada -- Carrossel/Reels/Storie no Facebook
// entraram nesta rodada, ver utils/metaGraphClient.js pros detalhes de
// cada mecanismo próprio do Facebook), pra marca com conta Meta conectada
// (De Bacco/GhelPlus, ver routes/socialAccounts.js). Vídeo do TikTok/
// YouTube (plataformas diferentes, nem são Meta) continua 100% manual,
// como sempre foi. Ver PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md pro
// histórico completo de cada rodada.

const path = require('path');
const db = require('../db');
const { nowSaoPaulo } = require('./pontoReminders');
const { createAutoRecado } = require('../routes/recados');
const metaGraph = require('./metaGraphClient');

const CHECK_INTERVAL_MS = 2 * 60 * 1000; // a cada 2 minutos
const AUTO_PUBLISH_PLATFORMS = ['instagram', 'facebook'];
const AUTO_PUBLISH_POST_TYPES = ['estatico', 'carrossel', 'reels', 'storie'];
// Carrossel, Reels e Storie: Instagram E Facebook desde a 82ª rodada (cada
// um com o mecanismo PRÓPRIO do Facebook -- ver comentário no topo de
// utils/metaGraphClient.js). Continuam como listas separadas (em vez de
// reaproveitar AUTO_PUBLISH_PLATFORMS direto) pra deixar fácil restringir
// de novo no futuro, caso algum dos dois precise sair de novo por algum
// motivo -- mesmo espírito de sempre desta base.
const CAROUSEL_PLATFORMS = ['instagram', 'facebook'];
const REELS_PLATFORMS = ['instagram', 'facebook'];
const STORIES_PLATFORMS = ['instagram', 'facebook'];
// Limite de imagens por carrossel exigido pela própria Meta (não é uma
// escolha nossa) -- publicar com menos de 2 ou mais de 10 é rejeitado pela
// Graph API, então valida aqui ANTES de gastar uma chamada de verdade.
const CAROUSEL_MIN_ITEMS = 2;
const CAROUSEL_MAX_ITEMS = 10;
// Extensões aceitas pra um arquivo de VÍDEO (Reels sempre, Storie quando
// não for foto) -- MP4 e MOV são os formatos que a própria Meta documenta
// como suportados; valida ANTES de gastar uma chamada de verdade na Graph
// API, mesmo espírito do limite do Carrossel.
const VIDEO_FILE_EXTENSIONS = ['.mp4', '.mov'];
const META_BRANDS = ['debacco', 'ghelplus'];
const APP_BASE_URL = (process.env.PAPOI_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

const PLATFORM_LABEL_PT = { instagram: 'Instagram', facebook: 'Facebook' };
const BRAND_LABEL_PT = { debacco: 'De Bacco', ghelplus: 'GhelPlus' };

function scheduledDateTimeString(post) {
  return `${post.scheduledDate} ${post.scheduledTime || '00:00'}`;
}

function isDue(post) {
  const { dateStr, hhmm } = nowSaoPaulo();
  return scheduledDateTimeString(post) <= `${dateStr} ${hhmm}`;
}

// Só entra na fila de publicação automática quem: (a) ainda não teve
// nenhuma tentativa (publishStatus null — 'failed' fica de fora até alguém
// editar algo, ver clearFailedPublishIfContentChanged em
// routes/socialPosts.js; 'published'/'publishing' obviamente também ficam
// de fora); (b) é Instagram ou Facebook; (c) é post Estático, Carrossel,
// Reels ou Storie (ver limitação de escopo no comentário do topo) —
// Carrossel, Reels e Storie só entram se for Instagram, Facebook fica de
// fora nesses 3 casos; (d) tem legenda e pelo menos 1 arquivo (a
// quantidade EXATA de imagens do Carrossel — 2 a 10 —, se o arquivo do
// Reels/Storie realmente parece um vídeo quando precisa ser, e o aviso de
// que Storie NÃO tem legenda de verdade na Meta — só são validados/
// avisados na hora de publicar, em attemptPublish, pra dar uma mensagem
// clara em vez de deixar o post parado pra sempre sem nenhum aviso); (e)
// já chegou a data/hora agendada; (f) a marca do post tem conta Meta
// conectada.
// Combinação rede+tipo+marca que a publicação automática sabe lidar --
// separado de isEligible() (11ª melhoria) pra dar pra reaproveitar tanto
// no ciclo automático quanto na hora de alguém marcar "Publicado" na mão
// (ver routes/socialPosts.js) sem duplicar essa lista em 2 lugares (o que
// já causou 1 bug real -- ver isEligible logo abaixo).
function isMetaAutoPublishSupported({ platform, postType, brand }) {
  if (!AUTO_PUBLISH_PLATFORMS.includes(platform)) return false;
  if (!AUTO_PUBLISH_POST_TYPES.includes(postType)) return false;
  if (postType === 'carrossel' && !CAROUSEL_PLATFORMS.includes(platform)) return false;
  if (postType === 'reels' && !REELS_PLATFORMS.includes(platform)) return false;
  if (postType === 'storie' && !STORIES_PLATFORMS.includes(platform)) return false;
  if (!META_BRANDS.includes(brand)) return false;
  return true;
}

function isEligible(post) {
  if (post.publishStatus) return false;
  if (!isMetaAutoPublishSupported(post)) return false;
  // Legenda é exigida como confirmação de que o post está pronto -- EXCETO
  // pra Storie, que nunca manda legenda nenhuma pra Meta (ver
  // createInstagramStoryContainer em utils/metaGraphClient.js). Exigir
  // aqui mesmo assim (11ª melhoria, bug achado ao vivo pela Raquel) fazia
  // um Storie sem legenda preenchida (bem comum, já que a legenda nem
  // aparece no Story publicado) ficar parado pra sempre, sem publicar e
  // SEM NENHUM AVISO -- silencioso de propósito nenhum, só um bug.
  if (post.postType !== 'storie' && (!post.caption || !post.caption.trim())) return false;
  if (!(post.files || []).length) return false;
  if (!post.scheduledDate) return false;
  if (!isDue(post)) return false;
  return true;
}

function findConnectedAccount(brand) {
  return db.get('socialAccounts').find({ brand, platform: 'meta' }).value();
}

// Carrossel (8ª correção): cada imagem vira um container "filho", todos
// esperados ficarem prontos, depois combinados num container "pai" que é
// o que de fato se publica -- ver comentário completo em
// utils/metaGraphClient.js. Sequencial de propósito, mesmo motivo do loop
// principal em checkAndPublishScheduledPosts (evita bater rate limit da
// Graph API criando vários containers ao mesmo tempo).
async function publishInstagramCarousel(post, account) {
  const files = post.files || [];
  if (files.length < CAROUSEL_MIN_ITEMS || files.length > CAROUSEL_MAX_ITEMS) {
    throw new metaGraph.MetaGraphError(
      `Carrossel precisa de ${CAROUSEL_MIN_ITEMS} a ${CAROUSEL_MAX_ITEMS} imagens pra publicar no Instagram -- esse post tem ${files.length}. Ajuste as imagens e edite o agendamento pra tentar de novo.`
    );
  }
  const childIds = [];
  for (const file of files) {
    const imageUrl = `${APP_BASE_URL}${file.url}`;
    const child = await metaGraph.createInstagramCarouselChildContainer({
      igUserId: account.igUserId,
      pageAccessToken: account.pageAccessToken,
      imageUrl
    });
    await metaGraph.waitForMediaContainerReady({
      containerId: child.id,
      pageAccessToken: account.pageAccessToken
    });
    childIds.push(child.id);
  }
  const parent = await metaGraph.createInstagramCarouselContainer({
    igUserId: account.igUserId,
    pageAccessToken: account.pageAccessToken,
    childrenIds: childIds,
    caption: post.caption
  });
  await metaGraph.waitForMediaContainerReady({
    containerId: parent.id,
    pageAccessToken: account.pageAccessToken
  });
  const published = await metaGraph.publishInstagramMediaContainer({
    igUserId: account.igUserId,
    pageAccessToken: account.pageAccessToken,
    creationId: parent.id
  });
  return published.id;
}

// Reels (9ª melhoria): bem mais simples que Carrossel na montagem (1
// chamada só pra criar o container, depois publica) -- a diferença de
// verdade é o TEMPO de processamento do vídeo, bem maior que 1 imagem só,
// por isso usa as constantes de espera de VÍDEO (bem maiores que as
// padrão) em vez das de imagem. Ver comentário completo em
// utils/metaGraphClient.js.
function isVideoFile(file) {
  const ext = path.extname((file && (file.url || file.name)) || '').toLowerCase();
  return VIDEO_FILE_EXTENSIONS.includes(ext);
}

async function publishInstagramReels(post, account) {
  const files = post.files || [];
  if (files.length !== 1) {
    throw new metaGraph.MetaGraphError(
      `Reels precisa de exatamente 1 vídeo pra publicar -- esse post tem ${files.length} arquivo(s). Ajuste o criativo e edite o agendamento pra tentar de novo.`
    );
  }
  const file = files[0];
  if (!isVideoFile(file)) {
    throw new metaGraph.MetaGraphError(
      `O arquivo desse Reels não parece ser um vídeo (${file.name || file.url || 'sem nome'}) -- formatos aceitos: MP4 ou MOV. Confirme o criativo e edite o agendamento pra tentar de novo.`
    );
  }
  const videoUrl = `${APP_BASE_URL}${file.url}`;
  // Capa customizada (11ª melhoria): usa post.thumbnailFile quando a pessoa
  // subiu uma (mesmo campo/upload já usado pelo YouTube, ver
  // routes/socialPosts.js) -- sem ela, a Meta usa o primeiro frame do
  // vídeo (comportamento de sempre, nada muda).
  const coverUrl = post.thumbnailFile ? `${APP_BASE_URL}${post.thumbnailFile.url}` : undefined;
  const container = await metaGraph.createInstagramReelsContainer({
    igUserId: account.igUserId,
    pageAccessToken: account.pageAccessToken,
    videoUrl,
    caption: post.caption,
    coverUrl
  });
  await metaGraph.waitForMediaContainerReady({
    containerId: container.id,
    pageAccessToken: account.pageAccessToken,
    pollIntervalMs: metaGraph.VIDEO_CONTAINER_POLL_INTERVAL_MS,
    timeoutMs: metaGraph.VIDEO_CONTAINER_POLL_TIMEOUT_MS
  });
  const published = await metaGraph.publishInstagramMediaContainer({
    igUserId: account.igUserId,
    pageAccessToken: account.pageAccessToken,
    creationId: container.id
  });
  return published.id;
}

// Carrossel no FACEBOOK (82ª rodada): mesma validação de quantidade de
// imagens do Instagram (2 a 10, limite da própria Meta pra post
// multi-foto), mas o MECANISMO é outro -- sem container "pai" nenhum, é
// um post comum do Feed com as fotos (ainda não publicadas sozinhas)
// referenciadas via `attached_media` -- ver comentário completo em
// utils/metaGraphClient.js.
async function publishFacebookCarousel(post, account) {
  const files = post.files || [];
  if (files.length < CAROUSEL_MIN_ITEMS || files.length > CAROUSEL_MAX_ITEMS) {
    throw new metaGraph.MetaGraphError(
      `Carrossel precisa de ${CAROUSEL_MIN_ITEMS} a ${CAROUSEL_MAX_ITEMS} imagens pra publicar no Facebook -- esse post tem ${files.length}. Ajuste as imagens e edite o agendamento pra tentar de novo.`
    );
  }
  const photoIds = [];
  for (const file of files) {
    const imageUrl = `${APP_BASE_URL}${file.url}`;
    const photo = await metaGraph.createFacebookUnpublishedPhoto({ pageId: account.pageId, pageAccessToken: account.pageAccessToken, imageUrl });
    photoIds.push(photo.id);
  }
  const published = await metaGraph.publishFacebookMultiPhotoPost({
    pageId: account.pageId,
    pageAccessToken: account.pageAccessToken,
    message: post.caption,
    photoIds
  });
  return published.id;
}

// Reels no FACEBOOK (82ª rodada): fluxo de 3 passos da "Video Reels API"
// própria do Facebook (bem diferente da Content Publishing API do
// Instagram) -- abrir sessão, mandar o vídeo pro upload (apontando pra
// URL pública, nunca o binário), fechar com `video_state:'PUBLISHED'` --
// ver comentário completo em utils/metaGraphClient.js. Mesma validação de
// "exatamente 1 vídeo" do Reels do Instagram.
async function publishFacebookReels(post, account) {
  const files = post.files || [];
  if (files.length !== 1) {
    throw new metaGraph.MetaGraphError(
      `Reels precisa de exatamente 1 vídeo pra publicar -- esse post tem ${files.length} arquivo(s). Ajuste o criativo e edite o agendamento pra tentar de novo.`
    );
  }
  const file = files[0];
  if (!isVideoFile(file)) {
    throw new metaGraph.MetaGraphError(
      `O arquivo desse Reels não parece ser um vídeo (${file.name || file.url || 'sem nome'}) -- formatos aceitos: MP4 ou MOV. Confirme o criativo e edite o agendamento pra tentar de novo.`
    );
  }
  const videoUrl = `${APP_BASE_URL}${file.url}`;
  const { video_id: videoId, upload_url: uploadUrl } = await metaGraph.startFacebookVideoReelsUpload({
    pageId: account.pageId,
    pageAccessToken: account.pageAccessToken
  });
  await metaGraph.uploadFacebookVideoByUrl({ uploadUrl, pageAccessToken: account.pageAccessToken, fileUrl: videoUrl });
  await metaGraph.finishFacebookVideoReels({
    pageId: account.pageId,
    pageAccessToken: account.pageAccessToken,
    videoId,
    description: post.caption
  });
  // Diferente do Instagram (media_publish devolve o id do post de vez),
  // o "finish" do Reels do Facebook não devolve nenhum id de post próprio
  // -- o `video_id` da própria sessão de upload é o objeto certo pra
  // buscar o permalink depois (getPermalink já sabe pedir
  // `permalink_url` de qualquer objectId, vídeo incluso).
  return videoId;
}

// Storie no FACEBOOK (82ª rodada): foto usa o mesmo upload "não
// publicado" do Carrossel seguido de `/photo_stories`; vídeo usa o MESMO
// fluxo de 3 passos do Reels, só que no endpoint `/video_stories` (sem
// `video_state`, que é exclusivo do Reels) -- ver comentário completo em
// utils/metaGraphClient.js. Mesma validação de "exatamente 1 arquivo,
// foto OU vídeo" do Storie do Instagram -- e, igual ao Instagram, a Meta
// não aceita legenda nenhuma pra Storie (nem de foto nem de vídeo); a
// legenda da Papoi continua só anotação interna.
async function publishFacebookStory(post, account) {
  const files = post.files || [];
  if (files.length !== 1) {
    throw new metaGraph.MetaGraphError(
      `Storie precisa de exatamente 1 arquivo (foto OU vídeo) pra publicar -- esse post tem ${files.length}. Ajuste o criativo e edite o agendamento pra tentar de novo.`
    );
  }
  const file = files[0];
  const video = isVideoFile(file);
  const mediaUrl = `${APP_BASE_URL}${file.url}`;
  if (video) {
    const { video_id: videoId, upload_url: uploadUrl } = await metaGraph.startFacebookVideoStoryUpload({
      pageId: account.pageId,
      pageAccessToken: account.pageAccessToken
    });
    await metaGraph.uploadFacebookVideoByUrl({ uploadUrl, pageAccessToken: account.pageAccessToken, fileUrl: mediaUrl });
    const published = await metaGraph.finishFacebookVideoStory({
      pageId: account.pageId,
      pageAccessToken: account.pageAccessToken,
      videoId
    });
    return published.post_id || videoId;
  }
  const photo = await metaGraph.createFacebookUnpublishedPhoto({ pageId: account.pageId, pageAccessToken: account.pageAccessToken, imageUrl: mediaUrl });
  const published = await metaGraph.createFacebookPhotoStory({ pageId: account.pageId, pageAccessToken: account.pageAccessToken, photoId: photo.id });
  return published.post_id || photo.id;
}

// Storie (10ª melhoria): a mais simples das 4 na montagem (1 chamada só,
// igual Reels) -- mas aceita FOTO ou VÍDEO (Reels só aceita vídeo), então
// detecta pelo arquivo qual dos dois é, e usa os tempos de espera de
// vídeo só quando for vídeo mesmo (foto usa os padrões de imagem,
// bem mais rápidos). A Meta NÃO aceita legenda pra Storie -- por isso
// `createInstagramStoryContainer` nem recebe caption (ver comentário
// completo em utils/metaGraphClient.js); a Papoi continua exigindo
// legenda preenchida pra elegibilidade (mesma regra de todos os tipos,
// serve pra confirmar que o post está de fato pronto), só que ela nunca
// chega até a Meta nesse caso -- fica só de anotação interna.
async function publishInstagramStory(post, account) {
  const files = post.files || [];
  if (files.length !== 1) {
    throw new metaGraph.MetaGraphError(
      `Storie precisa de exatamente 1 arquivo (foto OU vídeo) pra publicar -- esse post tem ${files.length}. Ajuste o criativo e edite o agendamento pra tentar de novo.`
    );
  }
  const file = files[0];
  const video = isVideoFile(file);
  const mediaUrl = `${APP_BASE_URL}${file.url}`;
  const container = await metaGraph.createInstagramStoryContainer({
    igUserId: account.igUserId,
    pageAccessToken: account.pageAccessToken,
    mediaUrl,
    isVideo: video
  });
  await metaGraph.waitForMediaContainerReady({
    containerId: container.id,
    pageAccessToken: account.pageAccessToken,
    pollIntervalMs: video ? metaGraph.VIDEO_CONTAINER_POLL_INTERVAL_MS : undefined,
    timeoutMs: video ? metaGraph.VIDEO_CONTAINER_POLL_TIMEOUT_MS : undefined
  });
  const published = await metaGraph.publishInstagramMediaContainer({
    igUserId: account.igUserId,
    pageAccessToken: account.pageAccessToken,
    creationId: container.id
  });
  return published.id;
}

// 11ª melhoria (24/09/2026): ANTES, `imageUrl` era montado logo no topo
// desta função, direto de `post.files[0].url`, sem checar se `files`
// estava vazio -- inofensivo enquanto só o ciclo automático chamava
// attemptPublish (isEligible já garantia pelo menos 1 arquivo antes de
// chegar aqui), mas virou um erro cru (TypeError: Cannot read properties
// of undefined) sem nenhuma mensagem clara assim que o "publicar agora"
// manual (ver PUT /:id em routes/socialPosts.js) passou a chamar
// publishOne DIRETO, sem passar pelo isEligible -- descoberto escrevendo
// o teste de integração dessa correção (test-manual/publicarAgora.test.js).
// Agora cada branch valida os arquivos que realmente precisa, com
// mensagem própria, em vez de deixar o Node estourar sozinho.
async function attemptPublish(post, account) {
  const files = post.files || [];
  let externalPostId;
  // 82ª rodada: Carrossel/Reels/Storie ganharam mecanismo PRÓPRIO também
  // pro Facebook (antes só existiam pro Instagram) -- por isso os 3
  // primeiros `if`s agora checam só o `postType`, não mais
  // `platform === 'instagram'`, e decidem qual dos dois publicadores usar
  // (Instagram ou Facebook) dentro de cada um. O Estático continua
  // dividido por plataforma embaixo, sem mudança -- já publicava nos
  // dois desde a 55ª rodada.
  if (post.postType === 'reels') {
    externalPostId = post.platform === 'instagram' ? await publishInstagramReels(post, account) : await publishFacebookReels(post, account);
  } else if (post.postType === 'storie') {
    externalPostId = post.platform === 'instagram' ? await publishInstagramStory(post, account) : await publishFacebookStory(post, account);
  } else if (post.postType === 'carrossel') {
    externalPostId = post.platform === 'instagram' ? await publishInstagramCarousel(post, account) : await publishFacebookCarousel(post, account);
  } else if (post.platform === 'instagram') {
    if (!files.length) {
      throw new metaGraph.MetaGraphError('Esse post não tem nenhum arquivo (imagem) anexado pra publicar. Anexe um criativo e edite o agendamento pra tentar de novo.');
    }
    const imageUrl = `${APP_BASE_URL}${files[0].url}`;
    const container = await metaGraph.createInstagramMediaContainer({
      igUserId: account.igUserId,
      pageAccessToken: account.pageAccessToken,
      imageUrl,
      caption: post.caption
    });
    // 7ª correção: espera a Meta terminar de baixar/processar a imagem
    // antes de publicar -- publicar cedo demais é o que causava o erro
    // "Media ID is not available" (achado ao vivo pela Raquel, só na De
    // Bacco -- provavelmente por causa do tamanho/tempo de download da
    // imagem daquele post específico). Ver comentário completo em
    // utils/metaGraphClient.js.
    await metaGraph.waitForMediaContainerReady({
      containerId: container.id,
      pageAccessToken: account.pageAccessToken
    });
    const published = await metaGraph.publishInstagramMediaContainer({
      igUserId: account.igUserId,
      pageAccessToken: account.pageAccessToken,
      creationId: container.id
    });
    externalPostId = published.id;
  } else {
    // Facebook aceita post só de texto (sem imagem nenhuma) -- por isso
    // `imageUrl` é opcional aqui (undefined quando não tem arquivo), sem
    // erro nenhum (diferente do Instagram, onde imagem é obrigatória).
    const imageUrl = files.length ? `${APP_BASE_URL}${files[0].url}` : undefined;
    const published = await metaGraph.publishFacebookPagePost({
      pageId: account.pageId,
      pageAccessToken: account.pageAccessToken,
      message: post.caption,
      imageUrl
    });
    externalPostId = published.post_id || published.id;
  }
  let externalPermalink = null;
  try {
    externalPermalink = await metaGraph.getPermalink({ objectId: externalPostId, pageAccessToken: account.pageAccessToken });
  } catch (e) {
    // Link clicável é só um extra pra tela -- publicação já valeu mesmo
    // sem conseguir o permalink (não derruba o sucesso por causa disso).
  }
  return { externalPostId, externalPermalink };
}

// "Quem avisar" de FALHA (11ª melhoria) -- responsável marcado tem
// prioridade; sem responsável, avisa quem criou + todo mundo marcado como
// envolvido. Uma falha é acionável só por quem mexe no post, por isso
// continua restrita (gerente/coordenador não precisam ser avisados toda
// vez que uma tentativa automática falha).
function notifyRecipientIds(post) {
  return post.responsibleId
    ? [post.responsibleId]
    : Array.from(new Set([post.createdBy, ...(post.involvedUserIds || [])].filter(Boolean)));
}

// "Quem avisar" de SUCESSO (63ª rodada, "Rodada E" da Pendência 51,
// pedido da Raquel: "posts publicados devem notificar dona do post +
// coordenadora + gerente, com o link") -- mesma base de notifyRecipientIds
// acima, somada a todo mundo com cargo gerente/coordenador. Duplicada (não
// importada) de routes/socialPosts.js -- aquele arquivo EXIGE este aqui
// (`metaPublisher`), então importar de lá pra cá criaria um require
// circular (mesmo cuidado já documentado em outros pontos do código pra
// tripleSync.js).
function publishSuccessRecipientIds(post) {
  const gerenciaIds = db.get('users').value()
    .filter((u) => u.cargo === 'gerente' || u.cargo === 'coordenador')
    .map((u) => u.id);
  return Array.from(new Set([...notifyRecipientIds(post), ...gerenciaIds]));
}

// Lembrete do link de Storie (63ª rodada) -- ver comentário gêmeo
// (storieLinkReminder) em routes/socialPosts.js: a Graph API de Content
// Publishing não aceita nenhum parâmetro de link/sticker pra Story, então
// só lembra de colocar à mão no Instagram, sem prometer um sticker de
// verdade que a Papoi não consegue anexar sozinha.
function storieLinkReminder(post) {
  if (post.postType !== 'storie' || !post.link) return '';
  return ` Lembrete: a Meta não deixa anexar o link pelo publicador automático da Papoi -- adicione o link "${post.link}" no sticker de link direto no app do Instagram.`;
}

function notifyPublishFailure(post, message) {
  const label = `${PLATFORM_LABEL_PT[post.platform] || post.platform} · ${BRAND_LABEL_PT[post.brand] || post.brand}`;
  createAutoRecado({
    recipientIds: notifyRecipientIds(post),
    text: `Aviso Papoi: não consegui publicar sozinho seu post de ${label} (${post.scheduledDate}). Motivo: ${message}. Corrija e edite o agendamento para tentar de novo.`,
    postTitle: post.subject || label,
    postBrand: post.brand,
    postNetwork: post.platform,
    sourceSocialPostId: post.id
  });
}

// Recado de SUCESSO (11ª melhoria, pedido da Raquel: "a papoi n mostrou
// nenhum link após a publicação, e isso seria importante ter. Um link na
// aba recado, avisando que o post foi publicado e ao clicar no link ser
// levado até a rede social") -- até aqui só existia aviso de FALHA; quem
// publicava com sucesso não recebia nada, só via o status mudar sozinho
// se abrisse o Agendamento de novo. `externalUrl` é o link de verdade da
// Meta (pode vir `null` nas raras vezes que `getPermalink` falha -- nesse
// caso ainda avisa, só sem o link clicável).
function notifyPublishSuccess(post, externalUrl) {
  const label = `${PLATFORM_LABEL_PT[post.platform] || post.platform} · ${BRAND_LABEL_PT[post.brand] || post.brand}`;
  const linkPart = externalUrl ? ' Clique aqui pra ver o post no ar.' : ' (não consegui pegar o link direto dessa vez, mas publicou certinho.)';
  createAutoRecado({
    recipientIds: publishSuccessRecipientIds(post),
    text: `Papoi: o post de ${label} (${post.scheduledDate}) foi publicado com sucesso!${linkPart}${storieLinkReminder(post)}`,
    postTitle: post.subject || label,
    postBrand: post.brand,
    postNetwork: post.platform,
    sourceSocialPostId: post.id,
    externalUrl,
    kind: 'post_published'
  });
}

async function publishOne(post) {
  const account = findConnectedAccount(post.brand);
  // Conta pode ter sido desconectada entre a checagem da lista e aqui --
  // nesse caso simplesmente não faz nada (post continua null, tenta nas
  // próximas rodadas caso a conta seja reconectada).
  if (!account) return;

  db.get('socialPosts').find({ id: post.id }).assign({ publishStatus: 'publishing' }).write();
  try {
    const { externalPostId, externalPermalink } = await attemptPublish(post, account);
    const updates = {
      publishStatus: 'published',
      externalPostId,
      externalPermalink,
      publishError: null,
      updatedAt: new Date().toISOString()
    };
    // Publicado de verdade = publicado, ponto -- mesma cascata de conclusão
    // automática de Demandas que já existe pra quando alguém marca "Publicado"
    // manualmente (ver PUT /:id em routes/socialPosts.js), sem duplicar a
    // lógica aqui (require preguiçoso evita ciclo de require no topo do
    // arquivo).
    if (post.status !== 'publicado') updates.status = 'publicado';
    db.get('socialPosts').find({ id: post.id }).assign(updates).write();
    if (updates.status === 'publicado') {
      const { cascadeCompleteDemandas } = require('./demandCascade');
      // Sem `req` (terceiro argumento null) -- ação automática do sistema,
      // sem usuário logado; cascadeCompleteDemandas já lida com isso (só
      // pula o registro de Histórico, completa as demandas do mesmo jeito).
      cascadeCompleteDemandas(post.id, null, null);
    }
    notifyPublishSuccess(post, externalPermalink);
  } catch (e) {
    const message = e instanceof metaGraph.MetaGraphError ? e.message : (e.message || 'Erro inesperado ao publicar.');
    db.get('socialPosts').find({ id: post.id }).assign({
      publishStatus: 'failed',
      publishError: message,
      updatedAt: new Date().toISOString()
    }).write();
    notifyPublishFailure(post, message);
  }
}

let running = false;
async function checkAndPublishScheduledPosts() {
  if (running) return; // evita 2 rodadas simultâneas se uma publicação demorar mais que o intervalo
  running = true;
  try {
    const eligible = db.get('socialPosts').value().filter(isEligible);
    // Sequencial de propósito (não Promise.all) -- evita bater rate limit da
    // Graph API publicando vários posts ao mesmo tempo, e mantém os logs de
    // erro fáceis de ler um de cada vez.
    for (const post of eligible) {
      await publishOne(post);
    }
  } finally {
    running = false;
  }
}

let started = false;
function startMetaPublisherScheduler() {
  if (started) return; // idempotente, mesmo padrão do pontoReminders.js
  started = true;
  setInterval(checkAndPublishScheduledPosts, CHECK_INTERVAL_MS);
}

module.exports = {
  startMetaPublisherScheduler,
  // Exportados só pra teste automatizado poder chamar sob demanda / inspecionar,
  // sem esperar o setInterval de verdade rodar (mesmo padrão de
  // utils/pontoReminders.js).
  checkAndPublishScheduledPosts,
  isEligible,
  isDue,
  // Exportados pra routes/socialPosts.js poder publicar NA HORA quando
  // alguém marca "Publicado" manualmente num post que a Papoi sabe
  // publicar sozinha (11ª melhoria -- ver comentário completo no PUT /:id
  // de routes/socialPosts.js sobre o bug que isso corrige).
  isMetaAutoPublishSupported,
  publishOne,
  findConnectedAccount
};
