const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { resolveUserName, resolveUserPhoto } = require('../utils/names');
const { cascadeCompleteDemandas } = require('../utils/demandCascade');
const { createAutoRecado, updateAutoRecadosForPost } = require('./recados');
const metaPublisher = require('../utils/metaPublisher');
const linkedinPublisher = require('../utils/linkedinPublisher');
const youtubePublisher = require('../utils/youtubePublisher');

const router = express.Router();

// Agendamento de Redes Sociais — por enquanto é um controle manual dos
// posts planejados (rede, data, hora, legenda, criativo, status). A ideia
// é, no futuro, conectar com as APIs da Meta (Instagram/Facebook),
// LinkedIn, TikTok, YouTube e Pinterest pra publicar direto por aqui.

// 'newsletter' entra como mais uma rede — usada pros agendamentos de
// news (layout + briefing), com nome de tipo diferente por marca (ver
// POST_TYPES abaixo).
// Influencer e Blog entraram na 36ª rodada, pedido da Raquel: "adicionar
// Influencer e blog" nas opções de rede -- sem regra especial nenhuma,
// contam como mais uma rede normal (igual newsletter, sem o tratamento
// por marca que newsletter tem).
const PLATFORMS = ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'pinterest', 'newsletter', 'influencer', 'blog'];
const STATUSES = ['rascunho', 'agendado', 'publicado'];
// Tipo do post — lista definida pela Raquel (16/09, 7ª rodada). g_news e
// contatto só fazem sentido com platform 'newsletter' — g_news é o nome
// usado pela GhelPlus, contatto pela De Bacco (mesma coisa, nomes
// diferentes por marca). Os demais valem pra qualquer rede.
const POST_TYPES = ['g_news', 'contatto', 'estatico', 'carrossel', 'reels', 'storie', 'video_tiktok', 'video_youtube', 'pin'];
// Vídeo — quando o post é desse tipo (ou dessas redes), o agendamento
// ganha o campo extra "Roteiro" no formulário.
const VIDEO_POST_TYPES = ['reels', 'video_tiktok', 'video_youtube'];
const VIDEO_PLATFORMS = ['tiktok', 'youtube'];
// Marca — mesmo padrão de separação usado no Orçamento (routes/budget.js),
// pra manter Agendamento e Cronograma organizados por marca. Duranox e
// Boutique Inox entraram na 20ª rodada (pedido da Raquel: "Em agendamento e
// cronograma, crie mais 2 marcas Duranox, Boutique Inox") — escopo
// deliberadamente restrito a Agendamento/Cronograma, por isso só aparecem
// aqui e não em Orçamento/Brindes/Influencers.
const BRANDS = ['debacco', 'ghelplus', 'duranox', 'boutiqueinox'];
// Limite de cards no briefing por carrossel — só pra evitar um valor
// absurdo vindo de uma requisição malformada.
const MAX_CAROUSEL_CARDS = 30;

// Aprovação — usada na Prévia do Feed do Cronograma de Marketing. Todo
// mundo vê o status; só gerente, coordenador(a) ou admin da plataforma
// podem marcar (ver canApprove abaixo).
const APPROVAL_STATUSES = ['pendente', 'aprovado', 'reprovado'];

// Labels em PT usados só aqui no backend, pra montar o título/descrição do
// card de Demanda criado automaticamente quando alguém é marcado como
// pessoa envolvida num agendamento (ver createDemandCardsForNewInvolved).
const PLATFORM_LABEL_PT = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube', pinterest: 'Pinterest', newsletter: 'Newsletter', influencer: 'Influencer', blog: 'Blog' };
const POST_TYPE_LABEL_PT = { g_news: 'G-NEWS', contatto: 'Contatto', estatico: 'Estático', carrossel: 'Carrossel', reels: 'Reels', storie: 'Storie', video_tiktok: 'Vídeo TikTok', video_youtube: 'Vídeo YouTube', pin: 'Pin' };
const BRAND_LABEL_PT = { debacco: 'De Bacco', ghelplus: 'GhelPlus', duranox: 'Duranox', boutiqueinox: 'Boutique Inox' };
// Rótulo em PT do cargo de quem aprovou (63ª rodada, "Rodada E" da
// Pendência 51, pedido da Raquel: "quando aprovado, deve atualizar o
// recado da solicitação para 'aprovado por (cargo)'") -- mesmos valores
// de CARGOS em routes/auth.js, só que traduzidos pra uma frase pronta
// (mesmo texto do CARGO_LABEL do front, mas esse arquivo é backend e não
// enxerga public/app.js).
const CARGO_LABEL_PT = { gerente: 'Gerente', analista: 'Analista', auxiliar: 'Auxiliar', coordenador: 'Coordenador(a)', designer: 'Designer', designer3d: 'Designer 3D', videomaker: 'Videomaker' };

// Migração de valores antigos de postType (taxonomia usada até a 6ª
// rodada — feed/story/reels/carrossel/video/live/g_news/contatto,
// commit ba9814a, já em produção) pra taxonomia nova da 7ª rodada.
// Aplicada só na leitura (serialize/migratePostType), sem tocar no
// dado gravado, pra não perder histórico de posts antigos.
const POST_TYPE_MIGRATION = { feed: 'estatico', story: 'storie', live: 'estatico' };
function migratePostType(p) {
  if (POST_TYPES.includes(p.postType)) return p.postType;
  if (p.postType === 'video') {
    if (p.platform === 'tiktok') return 'video_tiktok';
    if (p.platform === 'youtube') return 'video_youtube';
    return 'reels';
  }
  return POST_TYPE_MIGRATION[p.postType] || 'estatico';
}

function serialize(p) {
  return Object.assign({}, p, {
    files: p.files || [],
    layoutFiles: p.layoutFiles || [],
    briefingFile: p.briefingFile || null,
    // Capa/thumbnail (45ª rodada) -- só faz sentido pra YouTube, mas o
    // campo existe pra qualquer post (fica null se não usado).
    thumbnailFile: p.thumbnailFile || null,
    briefingText: p.briefingText || '',
    scriptFile: p.scriptFile || null,
    scriptText: p.scriptText || '',
    scriptLink: p.scriptLink || '',
    involvedUserIds: p.involvedUserIds || [],
    // Responsável geral (51ª rodada, pedido da Raquel) — mesma marcação já
    // usada em Demandas, ver comentário em routes/demandas.js. É o que
    // decide quem recebe o recado de "post aprovado" (ver PUT /:id/approval
    // abaixo), em vez de todo mundo marcado como envolvido.
    responsibleId: p.responsibleId || null,
    changeSuggestions: p.changeSuggestions || '',
    changeSuggestionsAt: p.changeSuggestionsAt || null,
    // Publicação automática de verdade (54ª rodada) — só faz sentido pra
    // platform 'instagram'/'facebook' com conta Meta conectada pra marca
    // do post (ver routes/socialAccounts.js/utils/metaPublisher.js).
    // publishStatus null = ainda não tentou publicar sozinho (post comum,
    // continua 100% manual se não houver conta conectada); 'publishing' =
    // tentativa em andamento; 'published' = publicado de verdade, com
    // externalPostId/externalPermalink preenchidos; 'failed' = tentou e
    // não conseguiu, publishError tem o motivo (editar o post relevante
    // volta o status pra null, pra tentar de novo).
    publishStatus: p.publishStatus || null,
    externalPostId: p.externalPostId || null,
    externalPermalink: p.externalPermalink || null,
    publishError: p.publishError || null,
    link: p.link || '',
    subject: p.subject || '',
    postType: migratePostType(p),
    carouselBriefings: Array.isArray(p.carouselBriefings) ? p.carouselBriefings : [],
    brand: p.brand || 'debacco',
    approvalStatus: p.approvalStatus || 'pendente',
    approvalNotes: p.approvalNotes || '',
    approvedBy: p.approvedBy || null,
    approvedByName: resolveUserName(p.approvedBy, p.approvedByName),
    approvedAt: p.approvedAt || null,
    // Nomes resolvidos ao vivo (20ª rodada) — ver utils/names.js.
    createdByName: resolveUserName(p.createdBy, p.createdByName),
    createdByPhotoUrl: resolveUserPhoto(p.createdBy),
    changeSuggestionsBy: resolveUserName(p.changeSuggestionsById, p.changeSuggestionsBy)
  });
}

// Sugestões de alteração mostram quem pediu e quando — só atualiza esses
// dois campos quando o TEXTO muda de verdade (não a cada save do
// agendamento), e limpa os dois se o campo for esvaziado.
function changeSuggestionsMeta(newText, previousText, req) {
  const text = (newText || '').trim();
  if (text === (previousText || '').trim()) return {};
  if (!text) return { changeSuggestionsBy: '', changeSuggestionsById: null, changeSuggestionsAt: null };
  return { changeSuggestionsBy: req.user.name, changeSuggestionsById: req.user.id, changeSuggestionsAt: new Date().toISOString() };
}

// Só gerente, coordenador(a) ou admin da plataforma podem aprovar/reprovar
// na Prévia do Feed (pedido explícito da Raquel — "todos podem ver" o
// status, mas só esses 3 marcam).
function canApprove(req) {
  if (req.user.role === 'super_admin') return true;
  const user = db.get('users').find({ id: req.user.id }).value();
  return !!user && (user.cargo === 'gerente' || user.cargo === 'coordenador');
}

// Quem avisar quando um post é PUBLICADO (63ª rodada, "Rodada E" da
// Pendência 51, pedido da Raquel: "posts publicados devem notificar dona
// do post + coordenadora + gerente, com o link") -- responsável marcado
// tem prioridade (sem responsável, cai pro fallback de sempre: quem criou
// + todo mundo envolvido), sempre somado a todo mundo com cargo gerente/
// coordenador, sem repetir id (a mesma pessoa pode ser as duas coisas ao
// mesmo tempo). Mesma função duplicada (não importada) em
// utils/metaPublisher.js -- aquele arquivo é exigido por este aqui, então
// importar deste arquivo pra lá criaria um require circular (mesmo
// cuidado já documentado nesta rodada e em rodadas anteriores pra
// tripleSync.js).
function publishNotifyRecipientIds(post) {
  const owner = post.responsibleId
    ? [post.responsibleId]
    : [post.createdBy, ...(post.involvedUserIds || [])];
  const gerenciaIds = db.get('users').value()
    .filter((u) => u.cargo === 'gerente' || u.cargo === 'coordenador')
    .map((u) => u.id);
  return Array.from(new Set([...owner, ...gerenciaIds].filter(Boolean)));
}

// Lembrete do link de Storie (63ª rodada, pedido da Raquel: "Stories
// devem suportar um link clicável"). A Graph API de Content Publishing da
// Meta, usada pela publicação automática (utils/metaGraphClient.js), não
// tem NENHUM parâmetro documentado pra anexar um link/sticker de link ao
// publicar um Story -- isso só existe pela digitação manual dentro do
// próprio app do Instagram. Por isso a Papoi não promete um sticker de
// link de verdade no Story publicado: o campo "Link" (genérico, já
// existia) continua guardando o link que a pessoa quer usar, e o aviso de
// publicação lembra de colocá-lo à mão no Instagram quando for um Story.
function storieLinkReminder(post) {
  if (post.postType !== 'storie' || !post.link) return '';
  return ` Lembrete: a Meta não deixa anexar o link pelo publicador automático da Papoi -- adicione o link "${post.link}" no sticker de link direto no app do Instagram.`;
}

// Aviso de "pronto pra aprovar" (45ª rodada, pedido da Raquel: "é possivel
// que ao ter legenda e a arte do post, o sistema avise com um recado na
// tela inicial, para a coordenadora aprovar?"). Sempre que uma edição
// deixa o post com legenda E arte (criativo em `files`) preenchidos,
// dispara um recado automático (mesma estrutura de Recados já usada no
// aviso de aprovação, 44ª rodada) pra quem pode aprovar (cargo gerente ou
// coordenador — mesmo público de `canApprove` acima). Confirmado com a
// Raquel: dispara de novo a CADA edição feita nesse estado (não só na
// primeira vez que fica completo) — por isso é chamado a cada PUT/upload
// de criativo, sem guardar "já avisei antes".
// 63ª rodada, "Rodada E" da Pendência 51, pedido da Raquel: "posts com
// legenda+arquivo final (ou só arquivo final para Storie)" -- Storie não
// tem legenda de verdade na Meta (nunca vai junto na publicação, ver
// comentário na 56ª rodada), então exigir legenda preenchida pra avisar
// só atrasava avisos de Storie sem necessidade nenhuma.
function isReadyForApproval(post) {
  const hasArte = (post.files || []).length > 0;
  if (post.postType === 'storie') return hasArte;
  const hasLegenda = !!(post.caption && post.caption.trim());
  return hasLegenda && hasArte;
}
function notifyReadyForApproval(post) {
  if (!isReadyForApproval(post)) return;
  const recipientIds = db.get('users').value()
    .filter((u) => u.cargo === 'gerente' || u.cargo === 'coordenador')
    .map((u) => u.id);
  if (recipientIds.length === 0) return;
  const postTitle = post.subject && post.subject.trim()
    ? post.subject.trim()
    : `${PLATFORM_LABEL_PT[post.platform] || post.platform} · ${post.scheduledDate || 'sem data'}`;
  const readyText = post.postType === 'storie'
    ? 'Aviso Papoi: Este Story está com o arquivo final pronto, aguardando aprovação.'
    : 'Aviso Papoi: Este post está com legenda e arte prontos, aguardando aprovação.';
  createAutoRecado({
    recipientIds,
    text: readyText,
    postTitle,
    postBrand: post.brand,
    postNetwork: post.platform,
    sourceSocialPostId: post.id,
    kind: 'post_ready_for_approval'
  });
}

// Cria automaticamente, no quadro geral de Demandas, um card pra cada
// pessoa recém adicionada como envolvida num agendamento — assim ela já
// vê na própria lista que foi chamada pra aquele material, com a data.
// Só entra gente NOVA (comparado com a lista anterior), pra não spammar
// card repetido a cada edição do agendamento.
function createDemandCardsForNewInvolved(post, newIds, req) {
  if (!newIds || newIds.length === 0) return;
  const platformLabel = PLATFORM_LABEL_PT[post.platform] || post.platform;
  const typeLabel = POST_TYPE_LABEL_PT[post.postType] || '';
  const brandLabel = BRAND_LABEL_PT[post.brand] || post.brand;
  // Título do card de Demanda: pedido da Raquel é "o assunto e a data da
  // postagem" — usa o Assunto do agendamento quando preenchido; sem
  // assunto, cai no título antigo (marca/rede/tipo) pra não ficar sem
  // nome nenhum.
  const title = post.subject
    ? `${post.subject} · ${post.scheduledDate || 'sem data'}`
    : `Agendamento ${brandLabel} · ${platformLabel}${typeLabel ? ' (' + typeLabel + ')' : ''} · ${post.scheduledDate || 'sem data'}`;
  const description = 'Você foi marcado(a) como pessoa envolvida num agendamento de redes sociais.'
    + (post.caption ? ` Legenda: "${post.caption.slice(0, 200)}"` : '');
  newIds.forEach((userId) => {
    const demanda = {
      id: nanoid(),
      title,
      description,
      status: 'a_fazer',
      visibility: 'geral',
      archived: false,
      dueDate: post.scheduledDate || null,
      assigneeIds: [userId],
      labelIds: [],
      checklist: [],
      files: [],
      sourceSocialPostId: post.id,
      // Rede do agendamento de origem (36ª rodada, pedido da Raquel: "onde
      // diz o nome da rede social, deve ter o icone da rede, pequeno e
      // delicado") -- o Kanban de Demandas usa isso pra mostrar o
      // ícone/nome da rede no card, sem precisar reabrir o agendamento.
      network: post.platform || null,
      // Marca do agendamento de origem (37ª rodada, pedido da Raquel: ícone
      // da marca no início do título do card) -- post.brand já é um dos 4
      // valores válidos (mesma lista usada em routes/demandas.js BRANDS).
      brand: post.brand || null,
      createdAt: new Date().toISOString(),
      createdBy: req.user.id,
      createdByName: req.user.name,
      updatedAt: new Date().toISOString()
    };
    db.get('demandas').push(demanda).write();
  });
}

const uploadsRoot = path.join(__dirname, '..', 'data', 'uploads', 'social');

// Fábrica de instâncias do multer — cada "tipo" de anexo (criativo final,
// sugestão de layout, briefing, roteiro) fica numa subpasta separada
// dentro da pasta do post, só pra manter organizado.
function makeUpload(subdir) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(uploadsRoot, req.params.id, subdir);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
      cb(null, Date.now() + '-' + safe);
    }
  });
  // Limite alto pra caber vídeos e criativos grandes dos posts agendados.
  return multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB
}
const upload = makeUpload('creative');
const uploadLayout = makeUpload('layout');
const uploadBriefing = makeUpload('briefing');
const uploadScript = makeUpload('script');
const uploadThumbnail = makeUpload('thumbnail');

function fileMetaFrom(req, subdir) {
  return {
    id: nanoid(),
    name: req.file.originalname,
    url: `/uploads/social/${req.params.id}/${subdir}/${req.file.filename}`,
    size: req.file.size,
    uploadedAt: new Date().toISOString()
  };
}

// Publicação automática (54ª rodada): se um post tinha falhado ao tentar
// publicar sozinho (publishStatus 'failed'), e a edição mexeu em algo que
// pode ter corrigido o problema (rede, marca, data/hora, legenda), volta o
// status pra null -- assim o publicador (utils/metaPublisher.js) tenta de
// novo no próximo ciclo, em vez de ficar preso em erro pra sempre. Nunca
// mexe num post já 'published' (não tenta publicar de novo sozinho só
// porque alguém editou algo depois).
function clearFailedPublishIfContentChanged(post, updates) {
  if (post.publishStatus !== 'failed') return;
  const touchedRelevant = ['platform', 'brand', 'scheduledDate', 'scheduledTime', 'caption'].some((k) => updates[k] !== undefined);
  if (touchedRelevant) {
    updates.publishStatus = null;
    updates.publishError = null;
  }
}

// Qual publicador automático (se algum) sabe lidar com essa combinação
// rede+marca -- generalizado na 67ª rodada (LinkedIn) a partir do que era
// só uma chamada direta a metaPublisher.isMetaAutoPublishSupported, e de
// novo na 69ª rodada (YouTube). Cada publicador continua isolado no próprio
// arquivo (utils/metaPublisher.js, utils/linkedinPublisher.js,
// utils/youtubePublisher.js) -- este helper só decide QUAL DOS TRÊS (se
// algum) usar pro post em questão, sem duplicar a lógica de cada um.
function resolveAutoPublisher(effectivePost) {
  if (metaPublisher.isMetaAutoPublishSupported(effectivePost)) return metaPublisher;
  if (linkedinPublisher.isLinkedInAutoPublishSupported(effectivePost)) return linkedinPublisher;
  if (youtubePublisher.isYouTubeAutoPublishSupported(effectivePost)) return youtubePublisher;
  return null;
}

function findOr404(req, res) {
  const post = db.get('socialPosts').find({ id: req.params.id }).value();
  if (!post) {
    res.status(404).json({ error: 'Agendamento não encontrado.' });
    return null;
  }
  return post;
}

router.get('/meta', requireAuth, (req, res) => {
  res.json({
    platforms: PLATFORMS,
    statuses: STATUSES,
    postTypes: POST_TYPES,
    brands: BRANDS,
    videoPostTypes: VIDEO_POST_TYPES,
    videoPlatforms: VIDEO_PLATFORMS,
    approvalStatuses: APPROVAL_STATUSES
  });
});

router.get('/', requireAuth, (req, res) => {
  const all = db.get('socialPosts').value();
  const sorted = [...all].sort((a, b) => (a.scheduledDate || '').localeCompare(b.scheduledDate || '') || (a.scheduledTime || '').localeCompare(b.scheduledTime || ''));
  res.json({ posts: sorted.map(serialize) });
});

function validInvolvedIds(ids) {
  if (!Array.isArray(ids)) return [];
  const users = db.get('users').value();
  return ids.filter((id) => users.some((u) => u.id === id));
}

// Briefing por card do carrossel — array de textos (Card 1, Card 2, ...).
// Filtra pra string, corta em branco e limita o tamanho contra requisição
// malformada.
function validCarouselBriefings(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_CAROUSEL_CARDS).map((s) => (typeof s === 'string' ? s : ''));
}

router.post('/', requireAuth, (req, res) => {
  const { platform, scheduledDate, scheduledTime, caption, status, postType, brand, involvedUserIds, responsibleId, changeSuggestions, link, subject, briefingText, scriptText, scriptLink, carouselBriefings } = req.body || {};
  if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'Escolha uma rede social válida.' });
  if (!BRANDS.includes(brand)) return res.status(400).json({ error: 'Escolha a marca (De Bacco, GhelPlus, Duranox ou Boutique Inox).' });
  if (!scheduledDate) return res.status(400).json({ error: 'Escolha a data do post.' });
  const finalInvolvedIds = validInvolvedIds(involvedUserIds);
  const post = Object.assign({
    id: nanoid(),
    brand,
    platform,
    scheduledDate,
    scheduledTime: scheduledTime || '',
    caption: caption || '',
    subject: subject || '',
    status: STATUSES.includes(status) ? status : 'rascunho',
    postType: POST_TYPES.includes(postType) ? postType : 'estatico',
    carouselBriefings: validCarouselBriefings(carouselBriefings),
    involvedUserIds: finalInvolvedIds,
    // Responsável geral (51ª rodada) — ver comentário em serialize() acima.
    responsibleId: finalInvolvedIds.includes(responsibleId) ? responsibleId : null,
    changeSuggestions: changeSuggestions || '',
    link: link || '',
    briefingText: briefingText || '',
    scriptText: scriptText || '',
    scriptLink: scriptLink || '',
    files: [],
    layoutFiles: [],
    briefingFile: null,
    scriptFile: null,
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    createdByName: req.user.name,
    updatedAt: new Date().toISOString()
  }, changeSuggestionsMeta(changeSuggestions, '', req));
  db.get('socialPosts').push(post).write();
  createDemandCardsForNewInvolved(post, post.involvedUserIds, req);
  // 34ª rodada: no caso raro de o post já nascer como "publicado", completa
  // de cara as demandas que acabaram de ser criadas pras pessoas marcadas.
  if (post.status === 'publicado') {
    cascadeCompleteDemandas(post.id, null, req);
  }
  logAudit({ user: req.user, entityType: 'socialPost', entityId: post.id, entityLabel: `${brand} · ${platform} ${scheduledDate}`, action: 'create' });
  res.json({ post: serialize(post) });
});

router.put('/:id', requireAuth, async (req, res) => {
  const post = findOr404(req, res);
  if (!post) return;
  const previousInvolvedIds = post.involvedUserIds || [];
  // 34ª rodada: guarda o status ANTES do assign() -- o lowdb acha e
  // atualiza o mesmo objeto em memória que `post` já aponta, então
  // depois do assign(updates) o `post.status` já viria com o valor NOVO
  // (não dava mais pra comparar "era publicado antes?" usando `post`
  // depois dessa linha).
  const previousStatus = post.status;
  const { platform, scheduledDate, scheduledTime, caption, status, postType, brand, involvedUserIds, responsibleId, changeSuggestions, link, subject, briefingText, scriptText, scriptLink, carouselBriefings } = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  if (platform !== undefined && PLATFORMS.includes(platform)) updates.platform = platform;
  if (brand !== undefined && BRANDS.includes(brand)) updates.brand = brand;
  if (scheduledDate !== undefined) updates.scheduledDate = scheduledDate;
  if (scheduledTime !== undefined) updates.scheduledTime = scheduledTime;
  if (caption !== undefined) updates.caption = caption;
  if (subject !== undefined) updates.subject = subject;
  if (status !== undefined && STATUSES.includes(status)) updates.status = status;
  if (postType !== undefined && POST_TYPES.includes(postType)) updates.postType = postType;
  if (carouselBriefings !== undefined) updates.carouselBriefings = validCarouselBriefings(carouselBriefings);
  if (involvedUserIds !== undefined) updates.involvedUserIds = validInvolvedIds(involvedUserIds);
  // Responsável geral (51ª rodada) — mesmo padrão de validação/queda
  // automática já usado em Demandas e na ação de influencer (ver comentário
  // equivalente em routes/influencers.js).
  if (responsibleId !== undefined) {
    const effectiveInvolvedIds = updates.involvedUserIds !== undefined ? updates.involvedUserIds : (post.involvedUserIds || []);
    updates.responsibleId = effectiveInvolvedIds.includes(responsibleId) ? responsibleId : null;
  } else if (updates.involvedUserIds !== undefined && post.responsibleId && !updates.involvedUserIds.includes(post.responsibleId)) {
    updates.responsibleId = null;
  }
  if (changeSuggestions !== undefined) {
    updates.changeSuggestions = changeSuggestions;
    Object.assign(updates, changeSuggestionsMeta(changeSuggestions, post.changeSuggestions, req));
  }
  if (link !== undefined) updates.link = link;
  if (briefingText !== undefined) updates.briefingText = briefingText;
  if (scriptText !== undefined) updates.scriptText = scriptText;
  if (scriptLink !== undefined) updates.scriptLink = scriptLink;
  clearFailedPublishIfContentChanged(post, updates);

  // 11ª melhoria (24/09/2026, pedido/bug achado ao vivo pela Raquel: "Testei
  // storie e ele não foi postado. Coloquei para publicar e ele n publicou.")
  // -- ANTES desta correção, marcar "Publicado" na mão numa rede/tipo que a
  // Papoi já sabe publicar sozinha (Instagram/Facebook, Estático/Carrossel/
  // Reels/Storie) só trocava o rótulo `status` pra 'publicado' e completava
  // as demandas ligadas -- NUNCA chamava a Meta de verdade (isso só
  // acontece em publishOne, disparado pelo ciclo automático de 2 em 2
  // minutos em checkAndPublishScheduledPosts, que é uma coisa TOTALMENTE
  // separada do campo `status` que a pessoa mexe na tela). Resultado: a
  // tela confirmava "Publicado" (e fechava as demandas) sem nada ter saído
  // no Instagram, e sem NENHUM erro aparecer -- exatamente o que ela
  // relatou. Agora, quando alguém marca "Publicado" na mão numa combinação
  // que a Papoi publica sozinha e que ainda não foi publicada de verdade
  // (publishStatus não é 'published'/'publishing'), a Papoi tenta publicar
  // DE VERDADE na hora (mesma função usada pelo ciclo automático,
  // publishOne) -- o rótulo só vira "Publicado" se realmente publicou, e
  // se falhar a pessoa vê o erro na hora (em vez de ficar demandas fechadas
  // e nada no ar). Pra qualquer outra rede/tipo (TikTok, Facebook
  // Reels/Carrossel/Storie, etc.) nada muda -- continua sendo só uma
  // confirmação manual, como sempre foi.
  const effectivePostForMeta = {
    platform: updates.platform !== undefined ? updates.platform : post.platform,
    postType: updates.postType !== undefined ? updates.postType : post.postType,
    brand: updates.brand !== undefined ? updates.brand : post.brand
  };
  const wantsMarkPublished = updates.status === 'publicado' && previousStatus !== 'publicado';
  const alreadyHandledByMeta = post.publishStatus === 'published' || post.publishStatus === 'publishing';
  // 67ª/69ª rodada: generalizado pra também cobrir LinkedIn e YouTube -- ver
  // resolveAutoPublisher acima. `autoPublisher` é null pra qualquer rede/
  // tipo que nenhum dos três sabe publicar sozinho (TikTok, Facebook
  // Reels/Carrossel/Storie, LinkedIn com mais de 1 arquivo etc.),
  // continua 100% manual como sempre foi.
  const autoPublisher = wantsMarkPublished && !alreadyHandledByMeta ? resolveAutoPublisher(effectivePostForMeta) : null;
  const shouldPublishNow = !!autoPublisher;

  let publishedJustNow = false;
  if (shouldPublishNow) {
    const account = autoPublisher.findConnectedAccount(effectivePostForMeta.brand);
    if (!account) {
      const brandLabel = BRAND_LABEL_PT[effectivePostForMeta.brand] || effectivePostForMeta.brand;
      const contaLabel = autoPublisher === linkedinPublisher ? 'LinkedIn' : (autoPublisher === youtubePublisher ? 'do YouTube' : 'do Instagram/Facebook');
      return res.status(422).json({ error: `Não tem conta ${contaLabel} conectada pra ${brandLabel} -- conecte em Integrações antes de marcar como publicado.` });
    }
    // O status final vem do RESULTADO REAL da publicação (publishOne já
    // decide 'publicado' ou deixa em 'failed' sozinho) -- por isso grava
    // todo o resto do formulário, menos o `status` em si, antes de tentar.
    const { status: _pendingStatus, ...updatesWithoutStatus } = updates;
    db.get('socialPosts').find({ id: req.params.id }).assign(updatesWithoutStatus).write();
    const toPublish = db.get('socialPosts').find({ id: req.params.id }).value();
    await autoPublisher.publishOne(toPublish);
    const afterPublish = db.get('socialPosts').find({ id: req.params.id }).value();
    if (afterPublish.publishStatus !== 'published') {
      return res.status(422).json({ error: afterPublish.publishError || 'Não consegui publicar agora -- confira se a conta ainda está conectada e tente de novo em instantes.' });
    }
    publishedJustNow = true;
    updates.status = afterPublish.status;
  } else {
    db.get('socialPosts').find({ id: req.params.id }).assign(updates).write();
  }

  const fresh = db.get('socialPosts').find({ id: req.params.id }).value();
  if (updates.involvedUserIds !== undefined) {
    const newIds = updates.involvedUserIds.filter((id) => !previousInvolvedIds.includes(id));
    createDemandCardsForNewInvolved(fresh, newIds, req);
  }
  // 34ª rodada: marcar o agendamento como "publicado" completa sozinho
  // todas as demandas que ele criou (uma por pessoa marcada como
  // envolvida) — pedido da Raquel, mesma lógica usada quando alguém
  // conclui manualmente a demanda de uma dessas pessoas (ver
  // routes/demandas.js). Quando `publishedJustNow` é true, publishOne já
  // fez isso sozinho (11ª melhoria) -- não repete aqui pra não rodar a
  // cascata 2x.
  if (!publishedJustNow && updates.status === 'publicado' && previousStatus !== 'publicado') {
    cascadeCompleteDemandas(fresh.id, null, req);
    // 63ª rodada: marcar "Publicado" na mão (redes/tipos que a Papoi não
    // publica sozinha -- TikTok, YouTube, Facebook Reels/Carrossel/Storie
    // etc.) também avisa dona do post + coordenadora + gerente, igual à
    // publicação automática (ver notifyPublishSuccess em
    // utils/metaPublisher.js, chamada só quando `publishedJustNow` é
    // true). Sem link de verdade aqui (não veio de nenhuma API), mas
    // aproveita `fresh.link` se a pessoa tiver preenchido um à mão.
    const postTitle = fresh.subject && fresh.subject.trim()
      ? fresh.subject.trim()
      : `${PLATFORM_LABEL_PT[fresh.platform] || fresh.platform} · ${fresh.scheduledDate || 'sem data'}`;
    const label = `${PLATFORM_LABEL_PT[fresh.platform] || fresh.platform} · ${BRAND_LABEL_PT[fresh.brand] || fresh.brand}`;
    createAutoRecado({
      recipientIds: publishNotifyRecipientIds(fresh),
      text: `Papoi: o post de ${label} (${fresh.scheduledDate}) foi marcado como publicado.${storieLinkReminder(fresh)}`,
      postTitle,
      postBrand: fresh.brand,
      postNetwork: fresh.platform,
      sourceSocialPostId: fresh.id,
      externalUrl: fresh.link || null,
      kind: 'post_published'
    });
  }
  // 36ª rodada: se esse agendamento nasceu de uma ação da planilha de
  // influencers (fresh.sourceInfluencerPostId), qualquer edição feita
  // AQUI (pela aba Agendamento) precisa refletir de volta na ação de
  // influencer ligada -- pedido da Raquel: "se tiver alterações no
  // agendamento... tudo se altera junto". Escrita direta no db (sem
  // exigir utils/tripleSync.js) de propósito: tripleSync.js já exige
  // este arquivo (pra chamar createDemandCardsForNewInvolved), então
  // este arquivo exigir tripleSync.js de volta criaria um require
  // circular.
  if (fresh.sourceInfluencerPostId) {
    const infPost = db.get('influencerPosts').find({ id: fresh.sourceInfluencerPostId }).value();
    if (infPost) {
      const infUpdates = {};
      if (updates.platform !== undefined) infUpdates.rede = updates.platform;
      if (updates.scheduledDate !== undefined) infUpdates.dataPostagem = updates.scheduledDate;
      if (updates.caption !== undefined) infUpdates.observacoes = updates.caption;
      if (updates.status === 'publicado' && infPost.status !== 'publicada') infUpdates.status = 'publicada';
      if (Object.keys(infUpdates).length > 0) {
        db.get('influencerPosts').find({ id: infPost.id }).assign(infUpdates).write();
      }
    }
  }
  logAudit({ user: req.user, entityType: 'socialPost', entityId: post.id, entityLabel: `${post.platform} ${post.scheduledDate}`, action: 'update' });
  notifyReadyForApproval(fresh);
  res.json({ post: serialize(fresh) });
});

// ---------- aprovação (Prévia do Feed) ----------
router.put('/:id/approval', requireAuth, (req, res) => {
  const post = findOr404(req, res);
  if (!post) return;
  if (!canApprove(req)) {
    return res.status(403).json({ error: 'Só gerente, coordenador(a) ou administrador da plataforma podem aprovar/reprovar.' });
  }
  const { approvalStatus, approvalNotes } = req.body || {};
  if (!APPROVAL_STATUSES.includes(approvalStatus)) {
    return res.status(400).json({ error: 'Status de aprovação inválido.' });
  }
  const previousStatus = post.status;
  const updates = {
    approvalStatus,
    approvalNotes: approvalStatus === 'reprovado' ? (approvalNotes || '') : '',
    approvedByName: approvalStatus === 'pendente' ? '' : req.user.name,
    approvedBy: approvalStatus === 'pendente' ? null : req.user.id,
    approvedAt: approvalStatus === 'pendente' ? null : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  // 63ª rodada, "Rodada E" da Pendência 51, pedido da Raquel: "status
  // automático rascunho → agendado (ao aprovar) → publicado (na hora
  // marcada)" -- só sobe de "Rascunho" pra "Agendado" (nunca RECUA um post
  // que a pessoa já tinha avançado na mão, por exemplo se alguém já tinha
  // marcado como Publicado direto). A ponta "agendado → publicado na hora
  // certa" já existe desde a 55ª rodada pras combinações que a Papoi
  // publica sozinha (ciclo de 2 em 2 min em checkAndPublishScheduledPosts)
  // -- pra redes/tipos sem publicação automática (TikTok, YouTube, etc.),
  // esse passo continua manual de propósito, senão reintroduziria o bug
  // real corrigido na 56ª rodada (marcar "Publicado" sem ter publicado de
  // verdade em lugar nenhum).
  if (approvalStatus === 'aprovado' && previousStatus === 'rascunho') {
    updates.status = 'agendado';
  }
  db.get('socialPosts').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'socialPost', entityId: post.id, entityLabel: `${post.platform} ${post.scheduledDate}`, action: 'update', details: `Aprovação: ${approvalStatus}${updates.status === 'agendado' ? ' (status avançado pra Agendado automaticamente)' : ''}` });
  const fresh = db.get('socialPosts').find({ id: req.params.id }).value();
  if (approvalStatus === 'aprovado') {
    // "Aprovado por (cargo)" (63ª rodada, pedido da Raquel: "quando
    // aprovado, deve atualizar o recado da solicitação para 'aprovado por
    // (cargo)', visível só para coordenadora/gerente") -- atualiza EM CIMA
    // do(s) próprio(s) aviso(s) de "aguardando aprovação" (kind
    // 'post_ready_for_approval') já endereçado(s) só a gerente/coordenador,
    // em vez de criar um recado solto novo pra esse mesmo público.
    const approverUser = db.get('users').find({ id: req.user.id }).value();
    const cargoLabel = req.user.role === 'super_admin'
      ? 'Administrador(a)'
      : (CARGO_LABEL_PT[(approverUser || {}).cargo] || 'aprovador(a)');
    updateAutoRecadosForPost({
      sourceSocialPostId: fresh.id,
      kind: 'post_ready_for_approval',
      text: `Aviso Papoi: aprovado por ${cargoLabel} (${req.user.name}).`
    });
    // Aviso direcionado em Recados (44ª rodada, pedido da Raquel): diferente
    // do toast geral já existente desde a 42ª rodada (que qualquer pessoa
    // logada vê na hora, via polling de checkNewPostApprovals), este é um
    // recado automático endereçado só a quem criou o post ou está marcado
    // como envolvido nele — reaproveita a mesma estrutura/tela de Recados já
    // existente, sem aba nova nenhuma. Dispara em toda transição pra
    // "aprovado" (inclusive reaprovação depois de uma reprovação), igual ao
    // toast geral já fazia (esse toast geral foi restrito só ao dono do
    // post na 63ª rodada, ver checkNewPostApprovals em public/app.js).
    // 51ª rodada, pedido da Raquel: "O recado avisando que o post foi
    // aprovado, só deve aparecer para quem é o responsável pela demanda
    // (aquele que tem a estrelinha marcada), e não para todos" — agora
    // endereça só pro responsável geral marcado (fresh.responsibleId). Posts
    // sem ninguém marcado como responsável (cadastros antigos de antes dessa
    // rodada, ou alguém que simplesmente esqueceu de marcar a estrelinha)
    // caem no comportamento antigo como fallback, pra ninguém deixar de ser
    // avisado por falta de marcação.
    const recipientIds = fresh.responsibleId
      ? [fresh.responsibleId]
      : Array.from(new Set([fresh.createdBy, ...(fresh.involvedUserIds || [])].filter(Boolean)));
    const postTitle = fresh.subject && fresh.subject.trim()
      ? fresh.subject.trim()
      : `${PLATFORM_LABEL_PT[fresh.platform] || fresh.platform} · ${fresh.scheduledDate || 'sem data'}`;
    createAutoRecado({
      recipientIds,
      text: fresh.status === 'publicado'
        ? 'Aviso Papoi: Seu post foi aprovado (já está publicado).'
        : fresh.status === 'agendado'
          ? 'Aviso Papoi: Seu post foi aprovado e está agendado.'
          : 'Aviso Papoi: Seu post foi aprovado e está pronto para ser agendado.',
      postTitle,
      postBrand: fresh.brand,
      postNetwork: fresh.platform,
      sourceSocialPostId: fresh.id,
      kind: 'post_approved'
    });
  }
  res.json({ post: serialize(fresh) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const post = findOr404(req, res);
  if (!post) return;
  // 36ª rodada: se esse agendamento nasceu de uma ação de influencer,
  // apagar por aqui também apaga o trio inteiro (ação + demandas ligadas)
  // -- pedido da Raquel: "tudo que está ligado a ela deve ser alterado
  // também". Lógica inline (em vez de chamar utils/tripleSync.js) pra
  // não criar require circular (ver comentário equivalente no PUT acima).
  // Agendamento comum (sem essa origem) mantém o comportamento de
  // sempre: só o próprio post some.
  if (post.sourceInfluencerPostId) {
    const infPost = db.get('influencerPosts').find({ id: post.sourceInfluencerPostId }).value();
    const linkedDemandas = db.get('demandas').value().filter((d) => d.sourceSocialPostId === post.id);
    linkedDemandas.forEach((d) => {
      db.get('demandas').remove({ id: d.id }).write();
      const demandaDir = path.join(__dirname, '..', 'data', 'uploads', 'demandas', d.id);
      if (fs.existsSync(demandaDir)) fs.rmSync(demandaDir, { recursive: true, force: true });
      logAudit({ user: req.user, entityType: 'demanda', entityId: d.id, entityLabel: d.title, action: 'delete', details: 'Excluída automaticamente junto com o agendamento/ação de influencer de origem.', meta: { visibility: d.visibility } });
    });
    if (infPost) {
      const uploadsRootInfluencers = path.join(__dirname, '..', 'data', 'uploads', 'influencers');
      db.get('influencerPosts').remove({ id: infPost.id }).write();
      if (infPost.arquivo && infPost.arquivo.url) {
        const p = path.join(uploadsRootInfluencers, infPost.influencerId, path.basename(infPost.arquivo.url));
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      if (infPost.notaFiscal && infPost.notaFiscal.url) {
        const p = path.join(uploadsRootInfluencers, infPost.influencerId, 'nota-fiscal', path.basename(infPost.notaFiscal.url));
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      logAudit({ user: req.user, entityType: 'influencerPost', entityId: infPost.id, entityLabel: infPost.formato, action: 'delete', details: 'Excluída automaticamente junto com o agendamento/demandas ligados a ela.' });
    }
  }
  db.get('socialPosts').remove({ id: req.params.id }).write();
  const dir = path.join(uploadsRoot, req.params.id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  logAudit({ user: req.user, entityType: 'socialPost', entityId: post.id, entityLabel: `${post.platform} ${post.scheduledDate}`, action: 'delete' });
  res.json({ ok: true });
});

// ---------- criativo final (imagem/vídeo) ----------
router.post('/:id/files', requireAuth, upload.single('file'), (req, res) => {
  const post = findOr404(req, res);
  if (!post) return;
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
  const files = [...(post.files || []), fileMetaFrom(req, 'creative')];
  const fileUpdates = { files, updatedAt: new Date().toISOString() };
  // Trocar o criativo é o jeito mais comum de corrigir uma falha de
  // publicação (arte que não carregou, formato rejeitado pela Meta etc.) —
  // sempre reseta o erro aqui, sem precisar da mesma checagem de "campo
  // relevante tocado" usada no PUT geral (ver clearFailedPublishIfContentChanged).
  if (post.publishStatus === 'failed') {
    fileUpdates.publishStatus = null;
    fileUpdates.publishError = null;
  }
  db.get('socialPosts').find({ id: req.params.id }).assign(fileUpdates).write();
  const fresh = db.get('socialPosts').find({ id: req.params.id }).value();
  notifyReadyForApproval(fresh);
  res.json({ post: serialize(fresh) });
});

router.delete('/:id/files/:fileId', requireAuth, (req, res) => {
  const post = findOr404(req, res);
  if (!post) return;
  const target = (post.files || []).find((f) => f.id === req.params.fileId);
  const files = (post.files || []).filter((f) => f.id !== req.params.fileId);
  db.get('socialPosts').find({ id: req.params.id }).assign({ files, updatedAt: new Date().toISOString() }).write();
  if (target) {
    const filePath = path.join(uploadsRoot, req.params.id, 'creative', path.basename(target.url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  const fresh = db.get('socialPosts').find({ id: req.params.id }).value();
  notifyReadyForApproval(fresh);
  res.json({ post: serialize(fresh) });
});

// ---------- sugestões de layout (imagens, várias) ----------
router.post('/:id/layout-files', requireAuth, uploadLayout.single('file'), (req, res) => {
  const post = findOr404(req, res);
  if (!post) return;
  if (!req.file) return res.status(400).json({ error: 'Selecione uma imagem.' });
  const layoutFiles = [...(post.layoutFiles || []), fileMetaFrom(req, 'layout')];
  db.get('socialPosts').find({ id: req.params.id }).assign({ layoutFiles, updatedAt: new Date().toISOString() }).write();
  res.json({ post: serialize(db.get('socialPosts').find({ id: req.params.id }).value()) });
});

router.delete('/:id/layout-files/:fileId', requireAuth, (req, res) => {
  const post = findOr404(req, res);
  if (!post) return;
  const target = (post.layoutFiles || []).find((f) => f.id === req.params.fileId);
  const layoutFiles = (post.layoutFiles || []).filter((f) => f.id !== req.params.fileId);
  db.get('socialPosts').find({ id: req.params.id }).assign({ layoutFiles, updatedAt: new Date().toISOString() }).write();
  if (target) {
    const filePath = path.join(uploadsRoot, req.params.id, 'layout', path.basename(target.url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  res.json({ post: serialize(db.get('socialPosts').find({ id: req.params.id }).value()) });
});

// ---------- briefing (arquivo único — link fica no PUT normal) ----------
router.post('/:id/briefing-file', requireAuth, uploadBriefing.single('file'), (req, res) => {
  const post = findOr404(req, res);
  if (!post) return;
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
  if (post.briefingFile) {
    const oldPath = path.join(uploadsRoot, req.params.id, 'briefing', path.basename(post.briefingFile.url));
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  const briefingFile = fileMetaFrom(req, 'briefing');
  db.get('socialPosts').find({ id: req.params.id }).assign({ briefingFile, updatedAt: new Date().toISOString() }).write();
  res.json({ post: serialize(db.get('socialPosts').find({ id: req.params.id }).value()) });
});

router.delete('/:id/briefing-file', requireAuth, (req, res) => {
  const post = findOr404(req, res);
  if (!post) return;
  if (post.briefingFile) {
    const filePath = path.join(uploadsRoot, req.params.id, 'briefing', path.basename(post.briefingFile.url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  db.get('socialPosts').find({ id: req.params.id }).assign({ briefingFile: null, updatedAt: new Date().toISOString() }).write();
  res.json({ post: serialize(db.get('socialPosts').find({ id: req.params.id }).value()) });
});

// ---------- roteiro (arquivo único — só faz sentido pra vídeo) ----------
router.post('/:id/script-file', requireAuth, uploadScript.single('file'), (req, res) => {
  const post = findOr404(req, res);
  if (!post) return;
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
  if (post.scriptFile) {
    const oldPath = path.join(uploadsRoot, req.params.id, 'script', path.basename(post.scriptFile.url));
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  const scriptFile = fileMetaFrom(req, 'script');
  db.get('socialPosts').find({ id: req.params.id }).assign({ scriptFile, updatedAt: new Date().toISOString() }).write();
  res.json({ post: serialize(db.get('socialPosts').find({ id: req.params.id }).value()) });
});

router.delete('/:id/script-file', requireAuth, (req, res) => {
  const post = findOr404(req, res);
  if (!post) return;
  if (post.scriptFile) {
    const filePath = path.join(uploadsRoot, req.params.id, 'script', path.basename(post.scriptFile.url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  db.get('socialPosts').find({ id: req.params.id }).assign({ scriptFile: null, updatedAt: new Date().toISOString() }).write();
  res.json({ post: serialize(db.get('socialPosts').find({ id: req.params.id }).value()) });
});

// ---------- capa/thumbnail (arquivo único — pensado pra YouTube) ----------
// 45ª rodada, pedido da Raquel: "you tube (deve ter a thumb- que é a
// capinha...)". Mesmo padrão de arquivo único já usado em Briefing/
// Roteiro (novo upload substitui o anterior, arquivo velho é apagado do
// disco) -- funciona pra qualquer rede, não só YouTube, mas só aparece no
// formulário quando a rede escolhida é YouTube (ver public/app.js).
router.post('/:id/thumbnail-file', requireAuth, uploadThumbnail.single('file'), (req, res) => {
  const post = findOr404(req, res);
  if (!post) return;
  if (!req.file) return res.status(400).json({ error: 'Selecione uma imagem.' });
  if (post.thumbnailFile) {
    const oldPath = path.join(uploadsRoot, req.params.id, 'thumbnail', path.basename(post.thumbnailFile.url));
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  const thumbnailFile = fileMetaFrom(req, 'thumbnail');
  db.get('socialPosts').find({ id: req.params.id }).assign({ thumbnailFile, updatedAt: new Date().toISOString() }).write();
  res.json({ post: serialize(db.get('socialPosts').find({ id: req.params.id }).value()) });
});

router.delete('/:id/thumbnail-file', requireAuth, (req, res) => {
  const post = findOr404(req, res);
  if (!post) return;
  if (post.thumbnailFile) {
    const filePath = path.join(uploadsRoot, req.params.id, 'thumbnail', path.basename(post.thumbnailFile.url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  db.get('socialPosts').find({ id: req.params.id }).assign({ thumbnailFile: null, updatedAt: new Date().toISOString() }).write();
  res.json({ post: serialize(db.get('socialPosts').find({ id: req.params.id }).value()) });
});

// createDemandCardsForNewInvolved exposta (36ª rodada) pra ser
// reaproveitada por utils/tripleSync.js, quando uma ação de influencer
// cria um agendamento vinculado -- mesma função, mesmo comportamento,
// sem duplicar código.
router.createDemandCardsForNewInvolved = createDemandCardsForNewInvolved;
module.exports = router;
