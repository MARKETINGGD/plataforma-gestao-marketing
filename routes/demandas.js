const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// Acompanhamento de Demandas — quadro estilo Trello. Qualquer pessoa logada
// na Plataforma pode usar (criar, mover, comentar); não tem permissão por
// dashboard como Orçamento/Tráfego/Ações/Redes.

const STATUSES = ['a_fazer', 'andamento', 'aprovacao', 'concluida'];

function isOverdue(demanda) {
  if (!demanda.dueDate || demanda.status === 'concluida' || demanda.archived) return false;
  const today = new Date().toISOString().slice(0, 10);
  return demanda.dueDate < today;
}

function serialize(d) {
  return Object.assign({}, d, { overdue: isOverdue(d) });
}

const uploadsRoot = path.join(__dirname, '..', 'data', 'uploads', 'demandas');
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
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

function findOr404(req, res) {
  const demanda = db.get('demandas').find({ id: req.params.id }).value();
  if (!demanda) {
    res.status(404).json({ error: 'Demanda não encontrada.' });
    return null;
  }
  return demanda;
}

router.get('/', requireAuth, (req, res) => {
  const archived = req.query.archived === 'true';
  const all = db.get('demandas').value().filter((d) => !!d.archived === archived);
  res.json({ demandas: all.map(serialize) });
});

// Contadores usados no resumo da tela Início.
router.get('/summary', requireAuth, (req, res) => {
  const all = db.get('demandas').value().filter((d) => !d.archived);
  const summary = { a_fazer: 0, andamento: 0, aprovacao: 0, concluida: 0, atrasada: 0 };
  all.forEach((d) => {
    if (STATUSES.includes(d.status)) summary[d.status] += 1;
    if (isOverdue(d)) summary.atrasada += 1;
  });
  res.json({ summary });
});

router.post('/', requireAuth, (req, res) => {
  const { title, description, dueDate, assigneeId, status } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Dê um título para a demanda.' });
  const assignee = assigneeId ? db.get('users').find({ id: assigneeId }).value() : null;
  const demanda = {
    id: nanoid(),
    title: title.trim(),
    description: description || '',
    status: STATUSES.includes(status) ? status : 'a_fazer',
    archived: false,
    dueDate: dueDate || null,
    assigneeId: assignee ? assignee.id : null,
    assigneeName: assignee ? (assignee.name || assignee.username) : null,
    checklist: [],
    files: [],
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    createdByName: req.user.username,
    updatedAt: new Date().toISOString()
  };
  db.get('demandas').push(demanda).write();
  logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: 'create' });
  res.json({ demanda: serialize(demanda) });
});

router.put('/:id', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  const { title, description, dueDate, assigneeId, status } = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  if (title !== undefined) updates.title = title.trim();
  if (description !== undefined) updates.description = description;
  if (dueDate !== undefined) updates.dueDate = dueDate || null;
  if (status !== undefined && STATUSES.includes(status)) updates.status = status;
  if (assigneeId !== undefined) {
    const assignee = assigneeId ? db.get('users').find({ id: assigneeId }).value() : null;
    updates.assigneeId = assignee ? assignee.id : null;
    updates.assigneeName = assignee ? (assignee.name || assignee.username) : null;
  }
  db.get('demandas').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: 'update' });
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value()) });
});

router.put('/:id/archive', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  const archived = !!(req.body || {}).archived;
  db.get('demandas').find({ id: req.params.id }).assign({ archived, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: archived ? 'archive' : 'unarchive' });
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  db.get('demandas').remove({ id: req.params.id }).write();
  const dir = path.join(uploadsRoot, req.params.id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: 'delete' });
  res.json({ ok: true });
});

// ---------- checklist ----------
router.post('/:id/checklist', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  const text = ((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: 'Escreva o item do checklist.' });
  const item = { id: nanoid(), text, done: false };
  const checklist = [...(demanda.checklist || []), item];
  db.get('demandas').find({ id: req.params.id }).assign({ checklist, updatedAt: new Date().toISOString() }).write();
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value()) });
});

router.put('/:id/checklist/:itemId', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  const { text, done } = req.body || {};
  const checklist = (demanda.checklist || []).map((it) => {
    if (it.id !== req.params.itemId) return it;
    return Object.assign({}, it, text !== undefined ? { text } : {}, done !== undefined ? { done: !!done } : {});
  });
  db.get('demandas').find({ id: req.params.id }).assign({ checklist, updatedAt: new Date().toISOString() }).write();
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value()) });
});

router.delete('/:id/checklist/:itemId', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  const checklist = (demanda.checklist || []).filter((it) => it.id !== req.params.itemId);
  db.get('demandas').find({ id: req.params.id }).assign({ checklist, updatedAt: new Date().toISOString() }).write();
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value()) });
});

// ---------- arquivos ----------
router.post('/:id/files', requireAuth, upload.single('file'), (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
  const fileMeta = {
    id: nanoid(),
    name: req.file.originalname,
    url: `/uploads/demandas/${req.params.id}/${req.file.filename}`,
    size: req.file.size,
    uploadedAt: new Date().toISOString(),
    uploadedByName: req.user.username
  };
  const files = [...(demanda.files || []), fileMeta];
  db.get('demandas').find({ id: req.params.id }).assign({ files, updatedAt: new Date().toISOString() }).write();
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value()) });
});

router.delete('/:id/files/:fileId', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  const target = (demanda.files || []).find((f) => f.id === req.params.fileId);
  const files = (demanda.files || []).filter((f) => f.id !== req.params.fileId);
  db.get('demandas').find({ id: req.params.id }).assign({ files, updatedAt: new Date().toISOString() }).write();
  if (target) {
    const filePath = path.join(uploadsRoot, req.params.id, path.basename(target.url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value()) });
});

module.exports = router;
