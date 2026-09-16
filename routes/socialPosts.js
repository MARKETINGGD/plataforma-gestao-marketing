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

const PLATFORMS = ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'pinterest'];
const STATUSES = ['rascunho', 'agendado', 'publicado'];
// Tipo do post — usado no Cronograma de Marketing (aba Calendário mostra
// o tipo de cada post do dia; aba Prévia do Feed também exibe).
const POST_TYPES = ['feed', 'story', 'reels', 'carrossel', 'video', 'live'];

function serialize(p) {
  return Object.assign({}, p, { files: p.files || [], postType: p.postType || 'feed' });
}

const uploadsRoot = path.join(__dirname, '..', 'data', 'uploads', 'social');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsRoot, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, Date.now() + '-' + safe);
  }
});
// Limite alto pra caber vídeos e criativos grandes dos posts agendados.
const upload = multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB

function findOr404(req, res) {
  const post = db.get('socialPosts').find({ id: req.params.id }).value();
  if (!post) {
    res.status(404).json({ error: 'Agendamento não encontrado.' });
    return null;
  }
  return post;
}

router.get('/meta', requireAuth, (req, res) => {
  res.json({ platforms: PLATFORMS, statuses: STATUSES, postTypes: POST_TYPES });
});

router.get('/', requireAuth, (req, res) => {
  const all = db.get('socialPosts').value();
  const sorted = [...all].sort((a, b) => (a.scheduledDate || '').localeCompare(b.scheduledDate || '') || (a.scheduledTime || '').localeCompare(b.scheduledTime || ''));
  res.json({ posts: sorted.map(serialize) });
});

router.post('/', requireAuth, (req, res) => {
  const { platform, scheduledDate, scheduledTime, caption, status, postType } = req.body || {};
  if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'Escolha uma rede social válida.' });
  if (!scheduledDate) return res.status(400).json({ error: 'Escolha a data do post.' });
  const post = {
    id: nanoid(),
    platform,
    scheduledDate,
    scheduledTime: scheduledTime || '',
    caption: caption || '',
    status: STATUSES.includes(status) ? status : 'rascunho',
    postType: POST_TYPES.includes(postType) ? postType : 'feed',
    files: [],
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    createdByName: req.user.username,
    updatedAt: new Date().toISOString()
  };
  db.get('socialPosts').push(post).write();
  logAudit({ user: req.user, entityType: 'socialPost', entityId: post.id, entityLabel: `${platform} ${scheduledDate}`, action: 'create' });
  res.json({ post: serialize(post) });
});

router.put('/:id', requireAuth, (req, res) => {
  const post = findOr404(req, res);
  if (!post) return;
  const { platform, scheduledDate, scheduledTime, caption, status, postType } = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  if (platform !== undefined && PLATFORMS.includes(platform)) updates.platform = platform;
  if (scheduledDate !== undefined) updates.scheduledDate = scheduledDate;
  if (scheduledTime !== undefined) updates.scheduledTime = scheduledTime;
  if (caption !== undefined) updates.caption = caption;
  if (status !== undefined && STATUSES.includes(status)) updates.status = status;
  if (postType !== undefined && POST_TYPES.includes(postType)) updates.postType = postType;
  db.get('socialPosts').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'socialPost', entityId: post.id, entityLabel: `${post.platform} ${post.scheduledDate}`, action: 'update' });
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

router.post('/:id/files', requireAuth, upload.single('file'), (req, res) => {
  const post = findOr404(req, res);
  if (!post) return;
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
  const fileMeta = {
    id: nanoid(),
    name: req.file.originalname,
    url: `/uploads/social/${req.params.id}/${req.file.filename}`,
    size: req.file.size,
    uploadedAt: new Date().toISOString()
  };
  const files = [...(post.files || []), fileMeta];
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
    const filePath = path.join(uploadsRoot, req.params.id, path.basename(target.url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  res.json({ post: serialize(db.get('socialPosts').find({ id: req.params.id }).value()) });
});

module.exports = router;
