const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// Agendamento de Redes Sociais — por enquanto é um controle manual dos
// posts planejados (rede, data, hora, legenda, criativo, status). A ideia
// é, no futuro, conectar com as APIs da Meta (Instagram/Facebook),
// LinkedIn, TikTok, YouTube e Pinterest pra publicar direto por aqui.

// 'newsletter' entra como mais uma rede — usada pros agendamentos de
// news (layout + briefing), com nome de tipo diferente por marca (ver
// POST_TYPES abaixo).
const PLATFORMS = ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'pinterest', 'newsletter'];
const STATUSES = ['rascunho', 'agendado', 'publicado'];
// Tipo do post — usado no Cronograma de Marketing (aba Calendário mostra
// o tipo de cada post do dia; aba Prévia do Feed também exibe). g_news e
// contatto só fazem sentido com platform 'newsletter' — g_news é o nome
// usado pela GhelPlus, contatto pela De Bacco (mesma coisa, nomes
// diferentes por marca).
const POST_TYPES = ['feed', 'story', 'reels', 'carrossel', 'video', 'live', 'g_news', 'contatto'];
// Vídeo — quando o post é desse tipo (ou dessas redes), o agendamento
// ganha o campo extra "Roteiro" no formulário.
const VIDEO_POST_TYPES = ['reels', 'video'];
const VIDEO_PLATFORMS = ['tiktok', 'youtube'];
// Marca — mesmo padrão de separação usado no Orçamento (routes/budget.js),
// pra manter Agendamento e Cronograma organizados por marca.
const BRANDS = ['debacco', 'ghelplus'];

// Aprovação — usada na Prévia do Feed do Cronograma de Marketing. Todo
// mundo vê o status; só gerente, coordenador(a) ou admin da plataforma
// podem marcar (ver canApprove abaixo).
const APPROVAL_STATUSES = ['pendente', 'aprovado', 'reprovado'];

// Labels em PT usados só aqui no backend, pra montar o título/descrição do
// card de Demanda criado automaticamente quando alguém é marcado como
// pessoa envolvida num agendamento (ver createDemandCardsForNewInvolved).
const PLATFORM_LABEL_PT = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube', pinterest: 'Pinterest', newsletter: 'Newsletter' };
const POST_TYPE_LABEL_PT = { feed: 'Feed', story: 'Story', reels: 'Reels', carrossel: 'Carrossel', video: 'Vídeo', live: 'Live', g_news: 'G-NEWS', contatto: 'Contatto' };
const BRAND_LABEL_PT = { debacco: 'De Bacco', ghelplus: 'GhelPlus' };

function serialize(p) {
  return Object.assign({}, p, {
    files: p.files || [],
    layoutFiles: p.layoutFiles || [],
    briefingFile: p.briefingFile || null,
    briefingText: p.briefingText || '',
    scriptFile: p.scriptFile || null,
    scriptText: p.scriptText || '',
    scriptLink: p.scriptLink || '',
    involvedUserIds: p.involvedUserIds || [],
    changeSuggestions: p.changeSuggestions || '',
    changeSuggestionsBy: p.changeSuggestionsBy || '',
    changeSuggestionsAt: p.changeSuggestionsAt || null,
    link: p.link || '',
    postType: p.postType || 'feed',
    brand: p.brand || 'debacco',
    approvalStatus: p.approvalStatus || 'pendente',
    approvalNotes: p.approvalNotes || '',
    approvedByName: p.approvedByName || '',
    approvedAt: p.approvedAt || null
  });
}

// Sugestões de alteração mostram quem pediu e quando — só atualiza esses
// dois campos quando o TEXTO muda de verdade (não a cada save do
// agendamento), e limpa os dois se o campo for esvaziado.
function changeSuggestionsMeta(newText, previousText, req) {
  const text = (newText || '').trim();
  if (text === (previousText || '').trim()) return {};
  if (!text) return { changeSuggestionsBy: '', changeSuggestionsAt: null };
  return { changeSuggestionsBy: req.user.username, changeSuggestionsAt: new Date().toISOString() };
}

// Só gerente, coordenador(a) ou admin da plataforma podem aprovar/reprovar
// na Prévia do Feed (pedido explícito da Raquel — "todos podem ver" o
// status, mas só esses 3 marcam).
function canApprove(req) {
  if (req.user.role === 'super_admin') return true;
  const user = db.get('users').find({ id: req.user.id }).value();
  return !!user && (user.cargo === 'gerente' || user.cargo === 'coordenador');
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
  const title = `Agendamento ${brandLabel} · ${platformLabel}${typeLabel ? ' (' + typeLabel + ')' : ''} · ${post.scheduledDate || 'sem data'}`;
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
      createdAt: new Date().toISOString(),
      createdBy: req.user.id,
      createdByName: req.user.username,
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

function fileMetaFrom(req, subdir) {
  return {
    id: nanoid(),
    name: req.file.originalname,
    url: `/uploads/social/${req.params.id}/${subdir}/${req.file.filename}`,
    size: req.file.size,
    uploadedAt: new Date().toISOString()
  };
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

router.post('/', requireAuth, (req, res) => {
  const { platform, scheduledDate, scheduledTime, caption, status, postType, brand, involvedUserIds, changeSuggestions, link, briefingText, scriptText, scriptLink } = req.body || {};
  if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'Escolha uma rede social válida.' });
  if (!BRANDS.includes(brand)) return res.status(400).json({ error: 'Escolha a marca (De Bacco ou GhelPlus).' });
  if (!scheduledDate) return res.status(400).json({ error: 'Escolha a data do post.' });
  const post = Object.assign({
    id: nanoid(),
    brand,
    platform,
    scheduledDate,
    scheduledTime: scheduledTime || '',
    caption: caption || '',
    status: STATUSES.includes(status) ? status : 'rascunho',
    postType: POST_TYPES.includes(postType) ? postType : 'feed',
    involvedUserIds: validInvolvedIds(involvedUserIds),
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
    createdByName: req.user.username,
    updatedAt: new Date().toISOString()
  }, changeSuggestionsMeta(changeSuggestions, '', req));
  db.get('socialPosts').push(post).write();
  createDemandCardsForNewInvolved(post, post.involvedUserIds, req);
  logAudit({ user: req.user, entityType: 'socialPost', entityId: post.id, entityLabel: `${brand} · ${platform} ${scheduledDate}`, action: 'create' });
  res.json({ post: serialize(post) });
});

router.put('/:id', requireAuth, (req, res) => {
  const post = findOr404(req, res);
  if (!post) return;
  const previousInvolvedIds = post.involvedUserIds || [];
  const { platform, scheduledDate, scheduledTime, caption, status, postType, brand, involvedUserIds, changeSuggestions, link, briefingText, scriptText, scriptLink } = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  if (platform !== undefined && PLATFORMS.includes(platform)) updates.platform = platform;
  if (brand !== undefined && BRANDS.includes(brand)) updates.brand = brand;
  if (scheduledDate !== undefined) updates.scheduledDate = scheduledDate;
  if (scheduledTime !== undefined) updates.scheduledTime = scheduledTime;
  if (caption !== undefined) updates.caption = caption;
  if (status !== undefined && STATUSES.includes(status)) updates.status = status;
  if (postType !== undefined && POST_TYPES.includes(postType)) updates.postType = postType;
  if (involvedUserIds !== undefined) updates.involvedUserIds = validInvolvedIds(involvedUserIds);
  if (changeSuggestions !== undefined) {
    updates.changeSuggestions = changeSuggestions;
    Object.assign(updates, changeSuggestionsMeta(changeSuggestions, post.changeSuggestions, req));
  }
  if (link !== undefined) updates.link = link;
  if (briefingText !== undefined) updates.briefingText = briefingText;
  if (scriptText !== undefined) updates.scriptText = scriptText;
  if (scriptLink !== undefined) updates.scriptLink = scriptLink;
  db.get('socialPosts').find({ id: req.params.id }).assign(updates).write();
  const fresh = db.get('socialPosts').find({ id: req.params.id }).value();
  if (updates.involvedUserIds !== undefined) {
    const newIds = updates.involvedUserIds.filter((id) => !previousInvolvedIds.includes(id));
    createDemandCardsForNewInvolved(fresh, newIds, req);
  }
  logAudit({ user: req.user, entityType: 'socialPost', entityId: post.id, entityLabel: `${post.platform} ${post.scheduledDate}`, action: 'update' });
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
  const updates = {
    approvalStatus,
    approvalNotes: approvalStatus === 'reprovado' ? (approvalNotes || '') : '',
    approvedByName: approvalStatus === 'pendente' ? '' : req.user.username,
    approvedAt: approvalStatus === 'pendente' ? null : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.get('socialPosts').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'socialPost', entityId: post.id, entityLabel: `${post.platform} ${post.scheduledDate}`, action: 'update', details: `Aprovação: ${approvalStatus}` });
  res.json({ post: serialize(db.get('socialPosts').find({ id: req.params.id }).value()) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const post = findOr404(req, res);
  if (!post) return;
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
  db.get('socialPosts').find({ id: req.params.id }).assign({ files, updatedAt: new Date().toISOString() }).write();
  res.json({ post: serialize(db.get('socialPosts').find({ id: req.params.id }).value()) });
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
  res.json({ post: serialize(db.get('socialPosts').find({ id: req.params.id }).value()) });
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

module.exports = router;
