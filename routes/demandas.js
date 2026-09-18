const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { resolveUserName, resolveUserPhoto } = require('../utils/names');

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

// Um único id de usuário válido (30ª rodada: usado pro responsável geral da
// demanda e pro responsável de cada item do checklist) — null/inválido vira
// null, nunca quebra.
function validUserId(id) {
  if (!id) return null;
  const users = db.get('users').value();
  return users.some((u) => u.id === id) ? id : null;
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

// Link opcional da demanda (26ª rodada, pedido da Raquel: "ter onde colocar
// link"). Só valida que é uma string não-vazia depois de aparada — não exige
// http(s):// pra não travar quem cola um link de app interno ou atalho.
function validLink(link) {
  if (link === undefined || link === null) return null;
  const trimmed = String(link).trim();
  return trimmed ? trimmed : null;
}

// Título do checklist (26ª rodada, pedido da Raquel: "opção de dar um
// titulo para o check list"). Vazio/ausente cai no nome padrão de sempre.
function validChecklistTitle(title) {
  const trimmed = (title === undefined || title === null) ? '' : String(title).trim();
  return trimmed || 'Checklist';
}

// Sanitiza uma lista de itens de checklist vinda do cliente ao criar o card
// (26ª rodada: agora dá pra montar o checklist ANTES de salvar o card pela
// primeira vez, então o POST precisa aceitar os itens já montados no
// rascunho). Gera um id novo do servidor pra cada item (nunca confia no id
// que o rascunho local tiver usado) e descarta itens sem texto.
function sanitizeChecklistInput(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => {
      const done = !!(it || {}).done;
      return {
        id: nanoid(),
        text: String((it || {}).text || '').trim(),
        done,
        assigneeId: validUserId((it || {}).assigneeId),
        doneAt: done ? new Date().toISOString() : null
      };
    })
    .filter((it) => it.text);
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

// Rótulos em PT do status, usados só pra montar frases legíveis no
// histórico (22ª rodada) — mesmos valores de STATUSES acima.
const STATUS_LABEL_PT = { a_fazer: 'A Fazer', andamento: 'Em Andamento', aprovacao: 'Em Aprovação', concluida: 'Concluída' };

function serialize(d) {
  return Object.assign({}, d, {
    assigneeIds: d.assigneeIds || [],
    labelIds: d.labelIds || [],
    color: d.color || null,
    link: d.link || null,
    checklistTitle: d.checklistTitle || 'Checklist',
    // Responsável geral (30ª rodada): marcação visual/organizacional dentro
    // dos marcados na demanda — não afeta a pontuação do REIS DO MARKETING,
    // que continua contando todo mundo marcado igual.
    responsibleId: d.responsibleId || null,
    recurring: !!d.recurring,
    overdue: isOverdue(d),
    order: cardOrder(d),
    // Nome/foto de quem criou, resolvidos ao vivo (20ª/22ª rodada) — ver utils/names.js.
    createdByName: resolveUserName(d.createdBy, d.createdByName),
    createdByPhoto: resolveUserPhoto(d.createdBy),
    files: (d.files || []).map((f) => Object.assign({}, f, {
      uploadedByName: resolveUserName(f.uploadedBy, f.uploadedByName)
    }))
  });
}

// Monta uma frase legível descrevendo o que mudou num PUT /:id (22ª
// rodada, pedido da Raquel: o histórico do card deve mostrar "o que foi
// feito, alterado" — não só "atualizado" sem detalhe nenhum). `updates` é
// o mesmo objeto que já vai ser gravado (inclusive depois do ajuste de
// recorrência, se for o caso) — comparado contra o card antes da mudança.
function describeChanges(before, updates) {
  const parts = [];
  if (updates.title !== undefined && updates.title !== before.title) {
    parts.push(`título alterado para "${updates.title}"`);
  }
  if (updates.status !== undefined && updates.status !== before.status) {
    parts.push(`status: ${STATUS_LABEL_PT[before.status] || before.status} → ${STATUS_LABEL_PT[updates.status] || updates.status}`);
  }
  if (updates.dueDate !== undefined && updates.dueDate !== (before.dueDate || null)) {
    parts.push(`data de entrega: ${before.dueDate || 'sem data'} → ${updates.dueDate || 'sem data'}`);
  }
  if (updates.description !== undefined && updates.description !== before.description) {
    parts.push('descrição alterada');
  }
  if (updates.assigneeIds !== undefined) {
    const beforeIds = before.assigneeIds || [];
    const added = updates.assigneeIds.filter((id) => !beforeIds.includes(id));
    const removed = beforeIds.filter((id) => !updates.assigneeIds.includes(id));
    if (added.length) parts.push(`responsável(is) adicionado(s): ${added.map((id) => resolveUserName(id, '?')).join(', ')}`);
    if (removed.length) parts.push(`responsável(is) removido(s): ${removed.map((id) => resolveUserName(id, '?')).join(', ')}`);
  }
  if (updates.labelIds !== undefined) {
    const beforeIds = before.labelIds || [];
    const changed = updates.labelIds.length !== beforeIds.length || updates.labelIds.some((id) => !beforeIds.includes(id));
    if (changed) parts.push('etiquetas alteradas');
  }
  if (updates.color !== undefined && updates.color !== (before.color || null)) {
    parts.push('cor do card alterada');
  }
  if (updates.recurring !== undefined && updates.recurring !== !!before.recurring) {
    parts.push(updates.recurring ? 'marcada como recorrente' : 'recorrência removida');
  }
  if (updates.link !== undefined && updates.link !== (before.link || null)) {
    parts.push(updates.link ? 'link alterado' : 'link removido');
  }
  if (updates.checklistTitle !== undefined && updates.checklistTitle !== (before.checklistTitle || 'Checklist')) {
    parts.push(`checklist renomeado para "${updates.checklistTitle}"`);
  }
  return parts.join('; ');
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

// Histórico do quadro geral inteiro (22ª rodada, pedido da Raquel: "no
// quadro geral, ao lado de ver arquivadas, deve ter o histórico... podemos
// ver tudo que foi feito no quadro"). Fica ANTES de "GET /:id/history" por
// segurança de rota (mesmo cuidado do "PUT /reorder" acima), mesmo não
// havendo hoje nenhuma "GET /:id" que colidisse.
//
// Só entram ações marcadas como 'geral' no momento em que aconteceram
// (campo `visibility` gravado pelo logAudit desde esta rodada, via
// `meta`) — ações de demandas pessoais nunca aparecem aqui, e ações de
// antes desta rodada (que não têm essa marcação) também ficam de fora, de
// propósito: sem a marcação não dá pra garantir que não é uma demanda
// pessoal de alguém, e privacidade vem na frente de completude aqui.
router.get('/history', requireAuth, (req, res) => {
  const entries = db.get('auditLog').value()
    .filter((e) => e.entityType === 'demanda' && e.visibility === 'geral')
    .slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 300)
    .map((e) => ({
      id: e.id,
      entityId: e.entityId,
      entityLabel: e.entityLabel,
      action: e.action,
      details: e.details || '',
      createdAt: e.createdAt,
      userName: resolveUserName(e.userId, e.username),
      userPhoto: resolveUserPhoto(e.userId)
    }));
  res.json({ history: entries });
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

// "REIS DO MARKETING" (28ª/30ª rodada, pedido da Raquel) — ranking de quem
// mais concluiu demandas NESTE mês, pra mostrar na tela Início com foto e
// coroa pro 1º lugar.
//
// 30ª rodada: passou a contar também os itens do checklist marcados com um
// responsável (assigneeId por item). Regra confirmada com a Raquel: quando
// a demanda TEM itens de checklist com responsável marcado, SÓ esses itens
// concluídos pontuam (não soma com a conclusão do card inteiro, pra não
// contar em dobro) — cada item concluído neste mês pontua pra quem está
// marcado nele, usando `doneAt` (novo, gravado no PUT do item). Só quando a
// demanda NÃO tem nenhum item de checklist com responsável é que volta a
// valer a regra antiga: card inteiro concluído neste mês pontua pra todo
// mundo marcado em assigneeIds (usando `updatedAt`, como antes).
//
// O "responsável geral" (também 30ª rodada, campo `responsibleId`) é só uma
// marcação visual/organizacional — não entra nessa conta de forma alguma;
// todo mundo marcado na demanda (ou no item) pontua igual.
//
// Demandas RECORRENTES continuam de fora: ao marcar como concluída elas
// voltam sozinhas pra "A Fazer" (ver PUT /:id acima), então nunca ficam
// paradas em status 'concluida'. Não conta demanda arquivada nem pessoal
// (mesmo critério do /summary).
router.get('/reis-do-marketing', requireAuth, (req, res) => {
  const ym = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const counts = {};
  function addPoint(id) { if (id) counts[id] = (counts[id] || 0) + 1; }
  db.get('demandas').value().forEach((d) => {
    if (d.archived || d.visibility === 'pessoal') return;
    const checklist = d.checklist || [];
    const assignedItems = checklist.filter((it) => it.assigneeId);
    if (assignedItems.length > 0) {
      assignedItems.forEach((it) => {
        if (it.done && it.doneAt && it.doneAt.slice(0, 7) === ym) addPoint(it.assigneeId);
      });
    } else if (d.status === 'concluida' && d.updatedAt && d.updatedAt.slice(0, 7) === ym) {
      (d.assigneeIds || []).forEach(addPoint);
    }
  });
  res.json({ month: ym, counts });
});

router.post('/', requireAuth, (req, res) => {
  const { title, description, dueDate, assigneeIds, labelIds, status, visibility, color, recurring, link, checklistTitle, checklist, responsibleId } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Dê um título para a demanda.' });
  if (recurring && !dueDate) return res.status(400).json({ error: 'Defina uma data de entrega para usar recorrência.' });
  const finalAssigneeIds = validUserIds(assigneeIds);
  const demanda = {
    id: nanoid(),
    title: title.trim(),
    description: description || '',
    status: STATUSES.includes(status) ? status : 'a_fazer',
    visibility: VISIBILITIES.includes(visibility) ? visibility : 'geral',
    archived: false,
    dueDate: dueDate || null,
    recurring: !!recurring,
    assigneeIds: finalAssigneeIds,
    // Responsável geral (30ª rodada): precisa estar entre os marcados na
    // demanda, senão não faz sentido (não dá pra marcar como responsável
    // alguém que nem está no card).
    responsibleId: finalAssigneeIds.includes(responsibleId) ? responsibleId : null,
    labelIds: validLabelIds(labelIds),
    color: validColor(color),
    link: validLink(link),
    checklistTitle: validChecklistTitle(checklistTitle),
    // 26ª rodada: o checklist agora pode ser montado antes de o card existir
    // (rascunho local no front) — o que chegar aqui já vira o checklist do
    // card assim que ele é criado, em vez de nascer sempre vazio.
    checklist: sanitizeChecklistInput(checklist),
    files: [],
    order: Date.now(),
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    createdByName: req.user.name,
    updatedAt: new Date().toISOString()
  };
  db.get('demandas').push(demanda).write();
  logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: 'create', meta: { visibility: demanda.visibility } });
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
  const { title, description, dueDate, assigneeIds, labelIds, status, color, recurring, link, checklistTitle, responsibleId } = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  if (title !== undefined) updates.title = title.trim();
  if (description !== undefined) updates.description = description;
  if (dueDate !== undefined) updates.dueDate = dueDate || null;
  if (status !== undefined && STATUSES.includes(status)) updates.status = status;
  if (assigneeIds !== undefined) updates.assigneeIds = validUserIds(assigneeIds);
  // Responsável geral (30ª rodada): valida contra os marcados que vão valer
  // DEPOIS dessa atualização (novos assigneeIds, se vieram junto; senão os
  // que a demanda já tinha) — pra não perder a marcação por engano quando o
  // card é salvo sem mexer nos marcados.
  if (responsibleId !== undefined) {
    const effectiveAssigneeIds = updates.assigneeIds !== undefined ? updates.assigneeIds : (demanda.assigneeIds || []);
    updates.responsibleId = effectiveAssigneeIds.includes(responsibleId) ? responsibleId : null;
  } else if (updates.assigneeIds !== undefined && demanda.responsibleId && !updates.assigneeIds.includes(demanda.responsibleId)) {
    // Se o responsável geral atual saiu da lista de marcados nessa mesma
    // atualização, a marcação cai junto (não faz sentido sobreviver sozinha).
    updates.responsibleId = null;
  }
  if (labelIds !== undefined) updates.labelIds = validLabelIds(labelIds);
  if (color !== undefined) updates.color = validColor(color);
  if (recurring !== undefined) updates.recurring = !!recurring;
  if (link !== undefined) updates.link = validLink(link);
  if (checklistTitle !== undefined) updates.checklistTitle = validChecklistTitle(checklistTitle);

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

  const details = describeChanges(demanda, updates);
  db.get('demandas').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: updates.title || demanda.title, action: 'update', details, meta: { visibility: demanda.visibility } });
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value()), recurringReset });
});

router.put('/:id/archive', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  const archived = !!(req.body || {}).archived;
  db.get('demandas').find({ id: req.params.id }).assign({ archived, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: archived ? 'archive' : 'unarchive', meta: { visibility: demanda.visibility } });
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  db.get('demandas').remove({ id: req.params.id }).write();
  const dir = path.join(uploadsRoot, req.params.id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: 'delete', meta: { visibility: demanda.visibility } });
  res.json({ ok: true });
});

// Histórico de UMA demanda (card) — 22ª rodada, pedido da Raquel: "no
// card... deve aparecer o histórico daquele card, mostrando o que foi
// feito, alterado, excluído e quem foi que fez (nome e fotinho)".
// Reaproveita findOr404, que já barra quem não pode ver uma demanda
// pessoal (mesmo controle de acesso de sempre).
router.get('/:id/history', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  const entries = db.get('auditLog').value()
    .filter((e) => e.entityType === 'demanda' && e.entityId === demanda.id)
    .slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .map((e) => ({
      id: e.id,
      action: e.action,
      details: e.details || '',
      createdAt: e.createdAt,
      userName: resolveUserName(e.userId, e.username),
      userPhoto: resolveUserPhoto(e.userId)
    }));
  res.json({ history: entries });
});

// ---------- checklist ----------
router.post('/:id/checklist', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  const text = ((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: 'Escreva o item do checklist.' });
  // Responsável do item (30ª rodada): opcional, quem for marcado aqui passa
  // a pontuar no REIS DO MARKETING quando o item for concluído.
  const assigneeId = validUserId((req.body || {}).assigneeId);
  const item = { id: nanoid(), text, done: false, assigneeId, doneAt: null };
  const checklist = [...(demanda.checklist || []), item];
  db.get('demandas').find({ id: req.params.id }).assign({ checklist, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: 'checklist_add', details: `Item adicionado ao checklist: "${text}"`, meta: { visibility: demanda.visibility } });
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value()) });
});

router.put('/:id/checklist/:itemId', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  const { text, done, assigneeId } = req.body || {};
  const before = (demanda.checklist || []).find((it) => it.id === req.params.itemId);
  const checklist = (demanda.checklist || []).map((it) => {
    if (it.id !== req.params.itemId) return it;
    const patch = Object.assign(
      {},
      text !== undefined ? { text } : {},
      done !== undefined ? { done: !!done } : {},
      assigneeId !== undefined ? { assigneeId: validUserId(assigneeId) } : {}
    );
    // doneAt (30ª rodada): marca o instante em que o item foi concluído —
    // é o que o REIS DO MARKETING usa pra saber se a conclusão foi NESTE
    // mês. Só mexe quando `done` está de fato mudando de valor (chega/sai
    // de concluído); grava/limpa junto com o done, nunca fica desalinhado.
    if (done !== undefined && !!done !== !!it.done) {
      patch.doneAt = done ? new Date().toISOString() : null;
    }
    return Object.assign({}, it, patch);
  });
  db.get('demandas').find({ id: req.params.id }).assign({ checklist, updatedAt: new Date().toISOString() }).write();
  // Histórico (22ª rodada): registra só quando algo de fato mudou (marcar/
  // desmarcar ou renomear) — evita entrada de histórico "vazia" pra
  // requisições que não alteraram nada.
  if (before) {
    const after = checklist.find((it) => it.id === req.params.itemId);
    let detail = '';
    if (after && done !== undefined && !!done !== !!before.done) {
      detail = (after.done ? 'Item do checklist marcado como concluído: ' : 'Item do checklist desmarcado: ') + `"${after.text}"`;
    } else if (after && text !== undefined && text !== before.text) {
      detail = `Item do checklist renomeado para "${after.text}"`;
    }
    if (detail) logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: 'checklist_update', details: detail, meta: { visibility: demanda.visibility } });
  }
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value()) });
});

router.delete('/:id/checklist/:itemId', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  const target = (demanda.checklist || []).find((it) => it.id === req.params.itemId);
  const checklist = (demanda.checklist || []).filter((it) => it.id !== req.params.itemId);
  db.get('demandas').find({ id: req.params.id }).assign({ checklist, updatedAt: new Date().toISOString() }).write();
  if (target) logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: 'checklist_remove', details: `Item removido do checklist: "${target.text}"`, meta: { visibility: demanda.visibility } });
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
  logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: 'file_upload', details: `Arquivo enviado: ${fileMeta.name}`, meta: { visibility: demanda.visibility } });
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
    logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: 'file_delete', details: `Arquivo removido: ${target.name}`, meta: { visibility: demanda.visibility } });
  }
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value()) });
});

module.exports = router;
