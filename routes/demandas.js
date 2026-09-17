const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { resolveUserName } = require('../utils/names');

const router = express.Router();

// Acompanhamento de Demandas — quadro estilo Trello com uma lista por membro
// da equipe. Qualquer pessoa logada na Plataforma pode usar (criar, mover,
// comentar); não tem permissão por dashboard como Orçamento/Tráfego/Ações/Redes.
//
// Um card pode ser compartilhado com várias pessoas (assigneeIds) — nesse
// caso ele aparece, com os mesmos dados, na lista de cada uma delas. "Status"
// continua existindo como campo do card (não é mais o eixo do quadro) e
// alimenta os contadores da tela Início.
//
// Cada demanda tem um campo `visibility`:
// - 'geral' (padrão): quadro visto por todo mundo — pra analisar as demandas
//   de modo geral, como já era.
// - 'pessoal': só quem criou e quem foi marcado como responsável enxerga —
//   é a área pessoal de cada um, pra organizar as próprias demandas sem
//   aparecer pra quem não foi marcado.

const STATUSES = ['a_fazer', 'andamento', 'aprovacao', 'concluida'];
const VISIBILITIES = ['geral', 'pessoal'];

// Quem pode ver/editar uma demanda pessoal: quem criou ou quem está marcado.
// Demandas gerais continuam abertas pra qualquer pessoa logada, como antes.
function canAccess(demanda, user) {
  if (demanda.visibility !== 'pessoal') return true;
  return demanda.createdBy === user.id || (demanda.assigneeIds || []).includes(user.id);
}

function isOverdue(demanda) {
  if (!demanda.dueDate || demanda.status === 'concluida' || demanda.archived) return false;
  const today = new Date().toISOString().slice(0, 10);
  return demanda.dueDate < today;
}

// Demanda recorrente (15ª rodada): repete todo mês, no mesmo dia da data de
// entrega. Ao marcar como "Concluída", em vez de ficar concluída ela volta
// sozinha pra "A Fazer" com a data empurrada pro mesmo dia do mês seguinte —
// sem criar card novo nem guardar histórico (decisão da Raquel).
function addOneMonthSameDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const targetYear = m === 12 ? y + 1 : y;
  const targetMonth0 = m === 12 ? 0 : m; // já é o mês seguinte, 0-indexado
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth0 + 1, 0).getDate();
  const targetDay = Math.min(d, lastDayOfTargetMonth);
  const mm = String(targetMonth0 + 1).padStart(2, '0');
  const dd = String(targetDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

function validUserIds(ids) {
  if (!Array.isArray(ids)) return [];
  const users = db.get('users').value();
  return ids.filter((id) => users.some((u) => u.id === id));
}

function validLabelIds(ids) {
  if (!Array.isArray(ids)) return [];
  const labels = db.get('labels').value();
  return ids.filter((id) => labels.some((l) => l.id === id));
}

// Cor de fundo opcional do card (pedido da Raquel, 12ª rodada) — mesma ideia
// das etiquetas coloridas, mas aplicada ao card inteiro em vez de uma tag.
// null/vazio = sem cor (visual padrão de sempre).
function validColor(color) {
  if (!color || typeof color !== 'string') return null;
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
}

// Ordem manual do card dentro das listas do quadro (21ª rodada, pedido da
// Raquel: "os cards dentro das listas devem poder ser mudados de ordem ao
// puxar"). Um número só, não por lista — como um card pode aparecer em mais
// de uma coluna ao mesmo tempo (quando tem vários responsáveis), arrastar
// ele numa coluna reposiciona ele em todas; na prática, quase toda demanda
// tem um responsável só, então isso raramente aparece. Demandas antigas
// (antes dessa rodada) não têm esse campo gravado — pra elas, usa a data de
// criação como posição, o que mantém a ordem de sempre (mais antiga
// primeiro) sem precisar rodar nenhuma migração nos dados já existentes.
function cardOrder(d) {
  return d.order != null ? d.order : new Date(d.createdAt).getTime();
}

function serialize(d) {
  return Object.assign({}, d, {
    assigneeIds: d.assigneeIds || [],
    labelIds: d.labelIds || [],
    color: d.color || null,
    recurring: !!d.recurring,
    overdue: isOverdue(d),
    order: cardOrder(d),
    // Nome de quem criou, resolvido ao vivo (20ª rodada) — ver utils/names.js.
    createdByName: resolveUserName(d.createdBy, d.createdByName),
    files: (d.files || []).map((f) => Object.assign({}, f, {
      uploadedByName: resolveUserName(f.uploadedBy, f.uploadedByName)
    }))
  });
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
// Limite alto pra caber vídeos e arquivos grandes de criativo, não só documentos.
const upload = multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB

function findOr404(req, res) {
  const demanda = db.get('demandas').find({ id: req.params.id }).value();
  if (!demanda) {
    res.status(404).json({ error: 'Demanda não encontrada.' });
    return null;
  }
  if (!canAccess(demanda, req.user)) {
    res.status(403).json({ error: 'Essa demanda é pessoal e você não foi marcado nela.' });
    return null;
  }
  return demanda;
}

router.get('/', requireAuth, (req, res) => {
  const archived = req.query.archived === 'true';
  const scope = req.query.scope === 'pessoal' ? 'pessoal' : 'geral';
  const all = db.get('demandas').value().filter((d) => !!d.archived === archived);
  const filtered = scope === 'geral'
    ? all.filter((d) => d.visibility !== 'pessoal')
    : all.filter((d) => d.visibility === 'pessoal' && canAccess(d, req.user));
  res.json({ demandas: filtered.map(serialize) });
});

// Contadores usados no resumo da tela Início — só conta o quadro geral
// (demandas pessoais não entram nos números públicos da tela Início).
router.get('/summary', requireAuth, (req, res) => {
  const all = db.get('demandas').value().filter((d) => !d.archived && d.visibility !== 'pessoal');
  const summary = { a_fazer: 0, andamento: 0, aprovacao: 0, concluida: 0, atrasada: 0 };
  all.forEach((d) => {
    if (STATUSES.includes(d.status)) summary[d.status] += 1;
    if (isOverdue(d)) summary.atrasada += 1;
  });
  res.json({ summary });
});

router.post('/', requireAuth, (req, res) => {
  const { title, description, dueDate, assigneeIds, labelIds, status, visibility, color, recurring } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Dê um título para a demanda.' });
  if (recurring && !dueDate) return res.status(400).json({ error: 'Defina uma data de entrega para usar recorrência.' });
  const demanda = {
    id: nanoid(),
    title: title.trim(),
    description: description || '',
    status: STATUSES.includes(status) ? status : 'a_fazer',
    visibility: VISIBILITIES.includes(visibility) ? visibility : 'geral',
    archived: false,
    dueDate: dueDate || null,
    recurring: !!recurring,
    assigneeIds: validUserIds(assigneeIds),
    labelIds: validLabelIds(labelIds),
    color: validColor(color),
    checklist: [],
    files: [],
    order: Date.now(),
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    createdByName: req.user.name,
    updatedAt: new Date().toISOString()
  };
  db.get('demandas').push(demanda).write();
  logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: 'create' });
  res.json({ demanda: serialize(demanda) });
});

// Reordenar cards dentro de uma lista do quadro (21ª rodada) — usado tanto
// ao arrastar um card só quanto ao clicar em "Ordenar por data" (que
// reordena a lista inteira de uma vez). Recebe {items:[{id,order},...]} e
// grava só o campo order de cada um, sem mexer em mais nada do card. Fica
// ANTES de "PUT /:id" de propósito: como é uma rota fixa (sem parâmetro),
// se viesse depois "/:id" capturaria "reorder" como se fosse um id.
router.put('/reorder', requireAuth, (req, res) => {
  const items = Array.isArray((req.body || {}).items) ? req.body.items : [];
  const updated = [];
  items.forEach((it) => {
    if (!it || typeof it.id !== 'string' || typeof it.order !== 'number') return;
    const demanda = db.get('demandas').find({ id: it.id }).value();
    if (!demanda || !canAccess(demanda, req.user)) return;
    db.get('demandas').find({ id: it.id }).assign({ order: it.order }).write();
    updated.push(it.id);
  });
  res.json({ ok: true, updated });
});

router.put('/:id', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  const { title, description, dueDate, assigneeIds, labelIds, status, color, recurring } = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  if (title !== undefined) updates.title = title.trim();
  if (description !== undefined) updates.description = description;
  if (dueDate !== undefined) updates.dueDate = dueDate || null;
  if (status !== undefined && STATUSES.includes(status)) updates.status = status;
  if (assigneeIds !== undefined) updates.assigneeIds = validUserIds(assigneeIds);
  if (labelIds !== undefined) updates.labelIds = validLabelIds(labelIds);
  if (color !== undefined) updates.color = validColor(color);
  if (recurring !== undefined) updates.recurring = !!recurring;

  // Recorrência (15ª rodada): se essa demanda é (ou está virando) recorrente,
  // precisa de data de entrega (é ela que define o "dia do mês"). Se o
  // status está sendo marcado como "Concluída", em vez de ficar concluída
  // ela volta sozinha pra "A Fazer" com a data empurrada pro mesmo dia do
  // mês seguinte — sem criar card novo.
  const effectiveRecurring = updates.recurring !== undefined ? updates.recurring : !!demanda.recurring;
  const effectiveDueDate = updates.dueDate !== undefined ? updates.dueDate : demanda.dueDate;
  if (effectiveRecurring && !effectiveDueDate) {
    return res.status(400).json({ error: 'Defina uma data de entrega para usar recorrência.' });
  }
  let recurringReset = null;
  if (updates.status === 'concluida' && effectiveRecurring && effectiveDueDate) {
    updates.status = 'a_fazer';
    updates.dueDate = addOneMonthSameDay(effectiveDueDate);
    recurringReset = updates.dueDate;
  }

  db.get('demandas').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: 'update' });
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value()), recurringReset });
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
    uploadedBy: req.user.id,
    uploadedByName: req.user.name
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
