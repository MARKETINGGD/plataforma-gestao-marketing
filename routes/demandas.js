const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { resolveUserName, resolveUserPhoto } = require('../utils/names');
const { cascadeCompleteDemandas, alsoInvolvedUserIds } = require('../utils/demandCascade');
// 36ª rodada: sincronização de 3 vias Influencers <-> Agendamento <-> Demandas
// (ver utils/tripleSync.js). Seguro exigir aqui -- tripleSync.js não exige
// demandas.js de volta, então não cria require circular.
const { markSocialPostPublished, deleteInfluencerTriad } = require('../utils/tripleSync');

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
// Marca (37ª rodada, pedido da Raquel): opcional -- mostra o ícone da marca
// no início do título do card. Demanda criada automaticamente a partir de
// um agendamento/ação de influencer já vem com isso preenchido sozinha
// (ver createDemandCardsForNewInvolved em routes/socialPosts.js); quem cria
// direto na aba Demandas pode escolher (ou deixar em branco). Mesmos 4
// valores usados em Agendamento (routes/socialPosts.js BRANDS).
const BRANDS = ['debacco', 'ghelplus', 'duranox', 'boutiqueinox'];
// Rede (38ª rodada, pedido da Raquel: "quando a demanda for criada na
// página de demandas, coloque além do ícone da marca, o ícone da rede,
// precisa ter a opção de escolha de rede, porque às vezes são criadas
// demandas de rede ali") -- antes o campo `network` só era preenchido
// sozinho quando a demanda vinha de um agendamento (ver
// createDemandCardsForNewInvolved em routes/socialPosts.js); agora quem
// cria direto na aba Demandas também pode escolher (ou deixar em branco).
// Mesmos valores usados em Agendamento (routes/socialPosts.js PLATFORMS).
const NETWORKS = ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'pinterest', 'newsletter', 'influencer', 'blog'];
// Recorrência (44ª rodada, pedido da Raquel: "demandas recorrentes hoje só
// suportam recorrência mensal" -- pendência 16 do handoff -- adicionar
// também recorrência DIÁRIA). Antes disso era só um booleano (`recurring`)
// com bounce sempre mensal; agora é uma frequência (`recurrence`), com o
// mesmo comportamento de bounce pras duas (ao concluir, em vez de arquivar,
// o card volta sozinho pra "A Fazer" com a `dueDate` empurrada — só muda
// quanto: 1 mês pra 'mensal', 1 dia pra 'diaria').
//
// Compatibilidade retroativa, sem migração de dados: todo card criado antes
// desta rodada só tem o booleano `recurring` (sem `recurrence` nenhum) —
// `effectiveRecurrence()` abaixo trata `recurring: true` sem `recurrence`
// como 'mensal', exatamente o comportamento que esse card já tinha. Campo
// `recurring` continua sendo gravado (como antes) só por compatibilidade
// com qualquer leitura antiga desse campo — a fonte de verdade a partir de
// agora é `recurrence`.
const RECURRENCE_VALUES = ['none', 'mensal', 'semanal', 'diaria'];
const RECURRENCE_LABEL_PT = { none: 'nenhuma', mensal: 'mensal', semanal: 'semanal', diaria: 'diária' };
function validRecurrence(v) {
  return RECURRENCE_VALUES.includes(v) ? v : null;
}
function effectiveRecurrence(d) {
  if (d && d.recurrence && RECURRENCE_VALUES.includes(d.recurrence)) return d.recurrence;
  return d && d.recurring ? 'mensal' : 'none';
}

// Quem pode ver/editar uma demanda pessoal: quem criou ou quem está marcado.
// Demandas gerais continuam abertas pra qualquer pessoa logada, como antes.
function canAccess(demanda, user) {
  if (demanda.visibility !== 'pessoal') return true;
  return demanda.createdBy === user.id || (demanda.assigneeIds || []).includes(user.id);
}

// ---------- Listas pessoais da Área Pessoal (78ª rodada) ----------
// Pedido da Raquel: "na area pessoal, deve ter a opção de criar listas e
// nomear elas, hoje só tem a opção de criar cards... isso deve valer
// apenas para a area pessoal" — e, no mesmo pedido, a correção de um bug
// relacionado: "quem criou a demanda e marcou o outro colega, não precisa
// ter o card duplicado e uma lista com o nome da pessoa marcada, o card
// deve aparecer na lista pessoal de quem foi marcado e aparecer no card
// de quem marcou, apenas isso" (ver pendência #28 do handoff).
//
// Cada lista pertence a UMA pessoa (`ownerId`) — mesmo quando uma demanda
// pessoal é compartilhada com outra pessoa marcada (`assigneeIds`), as
// listas continuam 100% privadas: a Ana nunca vê o nome das listas da
// Bia, e vice-versa. `personalPlacements` (no próprio documento da
// demanda) é o que resolve isso: é um mapa `{ [userId]: listId }` —
// cada pessoa que organiza esse card no próprio quadro grava a PRÓPRIA
// escolha ali, sem mexer na escolha de mais ninguém. Quem nunca organizou
// aquele card no próprio quadro (o caso mais comum de "fui marcado por
// alguém") cai sozinho na lista padrão da própria pessoa — nunca cria
// lista nova, nunca duplica nada.
function ensureDefaultPersonalList(userId) {
  const existing = db.get('personalLists').value().filter((l) => l.ownerId === userId);
  if (existing.length > 0) return existing.slice().sort((a, b) => a.order - b.order)[0];
  const list = { id: nanoid(), ownerId: userId, name: 'Minhas tarefas', order: Date.now(), createdAt: new Date().toISOString() };
  db.get('personalLists').push(list).write();
  return list;
}

function personalListsFor(userId) {
  ensureDefaultPersonalList(userId);
  return db.get('personalLists').value().filter((l) => l.ownerId === userId).slice().sort((a, b) => a.order - b.order);
}

function personalListIdFor(demanda, userId) {
  const placements = demanda.personalPlacements || {};
  if (placements[userId] && db.get('personalLists').find({ id: placements[userId], ownerId: userId }).value()) {
    return placements[userId];
  }
  return ensureDefaultPersonalList(userId).id;
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

// Recorrência diária (44ª rodada): mesmo "bounce", só empurrando 1 dia em
// vez de 1 mês.
function addOneDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// Recorrência semanal (46ª rodada): mesmo "bounce", empurrando 7 dias —
// cai sempre no mesmo dia da semana.
function addOneWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 7);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function advanceDueDate(dateStr, recurrence) {
  if (recurrence === 'diaria') return addOneDay(dateStr);
  if (recurrence === 'semanal') return addOneWeek(dateStr);
  return addOneMonthSameDay(dateStr);
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

function validBrand(brand) {
  return BRANDS.includes(brand) ? brand : null;
}

function validNetwork(network) {
  return NETWORKS.includes(network) ? network : null;
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
        doneAt: done ? new Date().toISOString() : null,
        // Data de entrega do item (31ª rodada, pedido da Raquel: "adicione a
        // função de por a data de entrega de cada um dos itens de check
        // liste, de forma individual") — opcional, independente da data de
        // entrega do card. Mesmo padrão simples de validação já usado pra
        // dueDate do card inteiro (só aceita string não-vazia ou null).
        dueDate: (it || {}).dueDate || null
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

function serialize(d, viewerId) {
  // Quando a demanda veio de um agendamento de redes sociais (uma por
  // pessoa marcada como envolvida, ver createDemandCardsForNewInvolved em
  // routes/socialPosts.js), mostra quem mais foi marcado junto no mesmo
  // agendamento (34ª rodada, pedido da Raquel) — sem isso a marcação
  // original só existia "escondida" em cards separados de cada pessoa.
  const alsoInvolvedNames = alsoInvolvedUserIds(d).map((id) => resolveUserName(id, '')).filter(Boolean);
  // 36ª rodada, pedido da Raquel: o card precisa mostrar quem mais está
  // envolvido do MESMO jeito que aparece no Agendamento (fotinho/avatar,
  // não só o nome em texto) -- facilita reconhecer de cara e evitar
  // demanda duplicada pra quem já está marcado em outro card do mesmo
  // agendamento.
  const alsoInvolvedPeople = alsoInvolvedUserIds(d).map((id) => ({
    id, name: resolveUserName(id, ''), photoUrl: resolveUserPhoto(id)
  })).filter((p) => p.name);
  return Object.assign({}, d, {
    assigneeIds: d.assigneeIds || [],
    labelIds: d.labelIds || [],
    color: d.color || null,
    link: d.link || null,
    checklistTitle: d.checklistTitle || 'Checklist',
    brand: d.brand || null,
    network: d.network || null,
    // Responsável geral (30ª rodada, marcação passou a pontuar na 32ª):
    // pontua igual a qualquer outro marcado na demanda — ver GET
    // /reis-do-marketing abaixo.
    responsibleId: d.responsibleId || null,
    // 78ª rodada: em qual lista pessoal ESSA pessoa (quem está pedindo)
    // organiza esse card — só existe de verdade quando visibility ===
    // 'pessoal' e a chamada informou quem está vendo (ver personalListIdFor
    // acima). Sempre null pra demanda do quadro Geral.
    personalListId: (d.visibility === 'pessoal' && viewerId) ? personalListIdFor(d, viewerId) : null,
    // recurrence é a fonte de verdade a partir da 44ª rodada (mensal/
    // diária); `recurring` continua sendo devolvido, recalculado ao vivo,
    // só por compatibilidade com qualquer leitura antiga desse campo.
    recurrence: effectiveRecurrence(d),
    recurring: effectiveRecurrence(d) !== 'none',
    overdue: isOverdue(d),
    order: cardOrder(d),
    alsoInvolvedNames,
    alsoInvolvedPeople,
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
  if (updates.recurrence !== undefined && updates.recurrence !== effectiveRecurrence(before)) {
    parts.push(`recorrência: ${RECURRENCE_LABEL_PT[effectiveRecurrence(before)]} → ${RECURRENCE_LABEL_PT[updates.recurrence]}`);
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
  res.json({ demandas: filtered.map((d) => serialize(d, req.user.id)) });
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
//
// 61ª rodada, pedido da Raquel: "na tela de início, onde aparece os
// resumos, ao clicar deve mostrar os dados: Demandas atrasadas, em
// andamento, em aprovação, concluídas (mostrar quais são as demandas)" --
// além dos contadores de sempre (que continuam do mesmo jeito, ninguém
// mais depende só deles), devolve também a listinha enxuta de cada
// categoria, já pronta pra tela Início listar ao clicar e depois abrir o
// card certo (usa o mesmo `id` que o quadro geral já usa).
router.get('/summary', requireAuth, (req, res) => {
  const all = db.get('demandas').value().filter((d) => !d.archived && d.visibility !== 'pessoal');
  const summary = { a_fazer: 0, andamento: 0, aprovacao: 0, concluida: 0, atrasada: 0 };
  const lists = { a_fazer: [], andamento: [], aprovacao: [], concluida: [], atrasada: [] };
  const toLite = (d) => ({
    id: d.id,
    title: d.title,
    dueDate: d.dueDate || null,
    brand: d.brand || null,
    network: d.network || null,
    assigneeNames: (d.assigneeIds || []).map((id) => resolveUserName(id, '')).filter(Boolean)
  });
  all.forEach((d) => {
    if (STATUSES.includes(d.status)) { summary[d.status] += 1; lists[d.status].push(toLite(d)); }
    if (isOverdue(d)) { summary.atrasada += 1; lists.atrasada.push(toLite(d)); }
  });
  res.json({ summary, lists });
});

// "REIS DO MARKETING" (28ª/30ª/32ª rodada, pedido da Raquel) — ranking de
// quem mais concluiu demandas NESTE mês, pra mostrar na tela Início com
// foto e coroa pro 1º lugar.
//
// 32ª rodada: regra de pontuação reescrita do zero, a pedido explícito da
// Raquel (substitui a regra "só o checklist conta quando existe" da 30ª
// rodada). Agora são DUAS fontes de ponto, que somam entre si (não são mais
// exclusivas uma da outra):
//
// 1) Card inteiro marcado como concluído neste mês (usando `updatedAt`,
//    como sempre): pontua todo mundo marcado no card (`assigneeIds`) E
//    o "responsável geral" (`responsibleId`), se tiver um marcado — cada
//    pessoa só 1 ponto por essa conclusão, mesmo que ela seja ao mesmo
//    tempo marcada E responsável geral (não pontua em dobro pelo mesmo
//    evento). Não importa quem foi que marcou como concluído.
// 2) Cada item de checklist concluído neste mês (usando `doneAt`, gravado
//    no PUT do item): pontua 1 ponto pra quem está marcado nesse item —
//    isso agora vale SEMPRE que o item tiver responsável e tiver sido
//    concluído no mês, independente do card (inteiro) estar concluído ou
//    não, e independente da pontuação em (1).
//
// Quem CRIOU o card não ganha ponto só por isso — só pontua se também se
// enquadrar em (1) ou (2) (estiver marcado no card, for o responsável
// geral, ou estiver marcado em algum item de checklist concluído), porque
// `addPoint` só é chamado pros ids que vêm de `assigneeIds`/`responsibleId`/
// `assigneeId` do item — nunca pro `createdBy` diretamente.
//
// 31ª rodada (mantido): quem tem cargo "Gerente" ou "Coordenador(a)" some
// do gráfico e não pontua de jeito nenhum, por nenhuma das duas fontes.
//
// 36ª rodada, pedido da Raquel: demanda RECORRENTE agora pontua pela fonte
// (1) também -- antes ficava de fora, porque ao marcar como concluída ela
// volta sozinha pra "A Fazer" na mesma gravação (ver PUT /:id acima) e
// nunca ficava parada em status 'concluida', que era o que a fonte (1)
// checava. Resolvido com um campo `lastCompletedAt`, gravado no momento
// exato da conclusão e que sobrevive ao "bounce" de volta pra "A Fazer" --
// a fonte (1) agora olha pra esse campo, não pro status atual. A fonte
// (2), por usar `doneAt` do item, nunca teve essa limitação.
//
// 36ª rodada também: demanda ARQUIVADA agora continua pontuando (antes
// era ignorada por inteiro) -- desde que a conclusão em si (`lastCompletedAt`)
// tenha caído dentro do mês. Arquivar é só uma forma de tirar do quadro
// ativo, não deveria apagar ponto já ganho.
//
// 33ª rodada, pedido da Raquel: demanda do quadro PESSOAL (visibility
// 'pessoal') agora TAMBÉM pontua — antes só o quadro geral contava (mesmo
// filtro usado no /summary, que continua só-geral porque aquele card é
// especificamente sobre o quadro geral). Aqui no ranking não faz mais essa
// distinção: pontua igual, venha de onde vier.
//
// 39ª rodada, pedido da Raquel: "quando finalizamos um card que não é do
// mês vigente, ele não deve pontuar". Antes, as duas fontes só olhavam pra
// quando a conclusão aconteceu (`lastCompletedAt`/`doneAt`) — um card com
// entrega de AGOSTO, concluído com atraso em SETEMBRO, pontuava pra
// setembro do mesmo jeito que um card que era mesmo de setembro. Agora as
// duas fontes também exigem que a DATA DE ENTREGA (do card, fonte 1, ou do
// item do checklist, fonte 2) caia no mesmo mês da conclusão — só assim
// conta como "do mês vigente". Card/item SEM data de entrega continua
// pontuando normalmente (sem data, não dá pra dizer que "não é do mês
// vigente" — não fica de fora).
//
// Card RECORRENTE precisa de um campo à parte pra isso: a `dueDate` dele
// já é empurrada pro mês seguinte NA MESMA gravação em que é concluído
// (ver "PUT /:id" abaixo), então na hora que essa rota lê o card, o campo
// `dueDate` já não é mais a data de entrega que estava valendo quando ele
// foi concluído — é a da PRÓXIMA ocorrência. Por isso o `lastCompletedAt`
// agora vem acompanhado de `lastCompletedDueDate` (gravado no mesmo
// instante, com a data de entrega que valia ANTES do empurrão), e é esse
// campo que essa rota usa pra checar o mês — não a `dueDate` atual.
//
// Retroativo: como o cálculo é sempre ao vivo (não é um placar guardado),
// o ajuste já vale sozinho pra qualquer conclusão já registrada. A única
// ressalva é card RECORRENTE concluído ANTES desta rodada: esses não têm
// `lastCompletedDueDate` gravado (campo novo), então caem no fallback
// abaixo (usa a `dueDate` atual) — que pra card recorrente já vai estar
// um mês à frente da que valia na conclusão. Não afeta o card comum (não
// recorrente), cuja `dueDate` nunca muda sozinha.
//
// Importante: essa rota calcula tudo na hora, direto dos dados atuais —
// não é um placar guardado à parte. Então já vale automaticamente pra
// toda demanda concluída neste mês até agora e pra qualquer uma concluída
// daqui pra frente, sem precisar de nenhuma migração.
router.get('/reis-do-marketing', requireAuth, (req, res) => {
  const ym = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const excludedIds = new Set(
    db.get('users').value()
      .filter((u) => u.cargo === 'gerente' || u.cargo === 'coordenador')
      .map((u) => u.id)
  );
  const counts = {};
  function addPoint(id) { if (id && !excludedIds.has(id)) counts[id] = (counts[id] || 0) + 1; }
  // "É do mês vigente?" — sem data de entrega, conta (não dá pra dizer
  // que não é do mês); com data, só conta se ela cair no mesmo mês `ym`
  // da conclusão que estamos somando.
  function isMesVigente(dueDate) {
    return !dueDate || dueDate.slice(0, 7) === ym;
  }
  db.get('demandas').value().forEach((d) => {
    // 78ª rodada, pedido explícito da Raquel: demanda da Área Pessoal
    // (visibility 'pessoal') deixa de pontuar -- reverte a decisão da 33ª
    // rodada ("pontua igual, venha de onde vier"). Só o Quadro Geral
    // conta a partir de agora.
    if (d.visibility === 'pessoal') return;
    // 36ª rodada, pedido da Raquel: demanda arquivada continua pontuando,
    // desde que a conclusão em si tenha acontecido dentro do mês --
    // arquivar é só "tirar do quadro ativo", não deveria zerar ponto já
    // ganho. (Antes, `if (d.archived) return;` tirava a demanda inteira da
    // contagem, inclusive a fonte 1 abaixo.)
    //
    // (1) card inteiro concluído neste mês -- usa `lastCompletedAt` (36ª
    // rodada) em vez de `status === 'concluida' && updatedAt`: pontua
    // igual pra demanda comum (que fica parada em 'concluida') e pra
    // demanda RECORRENTE (que volta sozinha pra 'a_fazer' na mesma hora,
    // então nunca fica parada em 'concluida' -- antes disso, recorrente
    // nunca pontuava por essa fonte). Marcados + responsável geral, sem
    // duplicar ponto pra quem for as duas coisas ao mesmo tempo.
    //
    // 39ª rodada: só pontua se a data de entrega que valia na conclusão
    // (`lastCompletedDueDate`; card de antes desta rodada cai no fallback
    // pra `dueDate` atual) também for desse mesmo mês -- card sem nenhuma
    // data de entrega continua pontuando normalmente.
    if (d.lastCompletedAt && d.lastCompletedAt.slice(0, 7) === ym) {
      const dueDateNaConclusao = d.lastCompletedDueDate !== undefined ? d.lastCompletedDueDate : d.dueDate;
      if (isMesVigente(dueDateNaConclusao)) {
        const pontuamNesseCard = new Set(d.assigneeIds || []);
        if (d.responsibleId) pontuamNesseCard.add(d.responsibleId);
        pontuamNesseCard.forEach(addPoint);
      }
    }
    // (2) itens de checklist concluídos neste mês -- 1 ponto por item, à
    // parte da pontuação do card (soma, não substitui). 39ª rodada: mesma
    // regra do mês vigente, usando a data de entrega do PRÓPRIO item (o
    // item não tem recorrência, então não precisa de campo separado --
    // `dueDate` do item nunca é empurrada sozinha).
    (d.checklist || []).forEach((it) => {
      if (it.assigneeId && it.done && it.doneAt && it.doneAt.slice(0, 7) === ym && isMesVigente(it.dueDate)) {
        addPoint(it.assigneeId);
      }
    });
  });
  res.json({ month: ym, counts, excludedIds: Array.from(excludedIds) });
});

// ---------- Acompanhamento da Equipe (77ª rodada) ----------
// Pedido literal da Raquel: "quero poder pegar relatórios de cada pessoa
// da equipe, somente eu (coordenadora) e a gerente teremos acesso, queremos
// saber o que foi feito, a data de inicio, data de entrega e quantas
// pessoas estavam envolvidas. Se teve link ou doc, quero ter acesso tbm."
// Depois confirmado: quer ver TODO status (já feito, em andamento, em
// atraso), "data de início" = data de criação da demanda, e ela mesma
// acumula os dois papéis (coordenadora E admin da Plataforma).
//
// Mesma regra de acesso já usada pra aprovar/reprovar na Prévia do Feed
// (`canApprove` em routes/socialPosts.js) -- admin da Plataforma OU cargo
// gerente/coordenador. Duplicada aqui (não importada) pelo mesmo motivo de
// sempre nesta base: evitar um require cruzado entre rotas que não têm
// mais nada a ver uma com a outra.
function canViewTeamReport(req) {
  if (req.user.role === 'super_admin') return true;
  const user = db.get('users').find({ id: req.user.id }).value();
  return !!user && (user.cargo === 'gerente' || user.cargo === 'coordenador');
}

const TEAM_REPORT_STATUS_VALUES = STATUSES.concat(['atrasada']);

// "Atrasada" tem prioridade sobre o status de verdade do card pra fins
// deste relatório -- mesmo espírito do badge vermelho já usado no quadro
// geral (ver isOverdue acima): um card "Em Andamento" que já passou da
// data de entrega conta como atrasado aqui, não como "em andamento".
function teamReportStatusKey(d) {
  return isOverdue(d) ? 'atrasada' : d.status;
}

router.get('/team-report', requireAuth, (req, res) => {
  if (!canViewTeamReport(req)) {
    return res.status(403).json({ error: 'Essa área é restrita à coordenação/gerência.' });
  }
  const { userId, status, from, to, brand } = req.query;
  const statusFilter = TEAM_REPORT_STATUS_VALUES.includes(status) ? status : null;
  const brandFilter = BRANDS.includes(brand) ? brand : null;

  // Mesma exclusão do REIS DO MARKETING (ver GET /reis-do-marketing acima):
  // gerente/coordenador são quem ACOMPANHA este relatório, não quem está
  // sendo acompanhado -- ficam de fora da lista de "pessoas da equipe".
  const managementIds = new Set(
    db.get('users').value()
      .filter((u) => u.cargo === 'gerente' || u.cargo === 'coordenador')
      .map((u) => u.id)
  );
  const teamUsers = db.get('users').value().filter((u) => !managementIds.has(u.id));

  const allDemandas = db.get('demandas').value();

  // Período (`from`/`to`) e marca filtram tanto o resumo por pessoa quanto
  // a lista detalhada -- são "qual fatia de tempo/marca estamos olhando".
  // Pessoa e status filtram só a lista detalhada -- o resumo por pessoa já
  // mostra a composição por status de cada uma, então escolher 1 status ali
  // esconderia justamente a comparação que o resumo serve pra mostrar.
  function matchesPeriodAndBrand(d) {
    if (from && (!d.createdAt || d.createdAt.slice(0, 10) < from)) return false;
    if (to && (!d.createdAt || d.createdAt.slice(0, 10) > to)) return false;
    if (brandFilter && d.brand !== brandFilter) return false;
    return true;
  }

  const team = teamUsers.map((u) => {
    const mine = allDemandas.filter((d) => (d.assigneeIds || []).includes(u.id) && matchesPeriodAndBrand(d));
    const totals = { total: mine.length, a_fazer: 0, andamento: 0, aprovacao: 0, concluida: 0, atrasada: 0 };
    mine.forEach((d) => { const k = teamReportStatusKey(d); totals[k] = (totals[k] || 0) + 1; });
    return { id: u.id, name: u.name || u.username, photoUrl: u.photoUrl || null, cargo: u.cargo || '', totals };
  });

  let detail = allDemandas.filter(matchesPeriodAndBrand);
  if (userId) {
    detail = detail.filter((d) => (d.assigneeIds || []).includes(userId));
  } else {
    // Sem pessoa escolhida: mostra só demandas que envolvem pelo menos 1
    // pessoa DA EQUIPE (não as demandas pessoais só da própria coordenadora/
    // gerente, que não é o que este relatório se propõe a acompanhar).
    detail = detail.filter((d) => (d.assigneeIds || []).some((id) => !managementIds.has(id)));
  }
  if (statusFilter) {
    detail = detail.filter((d) => teamReportStatusKey(d) === statusFilter);
  }

  const demandas = detail
    .slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .map((d) => Object.assign({}, serialize(d), {
      statusKey: teamReportStatusKey(d),
      assigneeCount: (d.assigneeIds || []).length
    }));

  res.json({ team, demandas });
});

router.post('/', requireAuth, (req, res) => {
  const { title, description, dueDate, assigneeIds, labelIds, status, visibility, color, recurring, recurrence, link, checklistTitle, checklist, responsibleId, brand, network, personalListId } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Dê um título para a demanda.' });
  // Aceita tanto o campo novo (`recurrence`: 'none'/'mensal'/'diaria')
  // quanto o booleano antigo (`recurring`, mapeado pra 'mensal' — mesmo
  // comportamento de sempre), pra não quebrar nenhum chamador que ainda
  // mande só o booleano.
  const finalRecurrence = validRecurrence(recurrence) || (recurring ? 'mensal' : 'none');
  if (finalRecurrence !== 'none' && !dueDate) return res.status(400).json({ error: 'Defina uma data de entrega para usar recorrência.' });
  const finalAssigneeIds = validUserIds(assigneeIds);
  // 78ª rodada, pedido explícito da Raquel: "toda ação, demanda e afins
  // sempre deve ter um responsável" -- nenhuma demanda pode ser criada
  // sem alguém marcado com a estrela, não importa de onde ela nasça.
  // Demandas geradas automaticamente pelo servidor (Agendamento/
  // Influencer, ver createDemandCardsForNewInvolved em
  // routes/socialPosts.js) já preenchem isso sozinhas -- essa validação
  // aqui é só pra criação manual/direta, feita por uma pessoa.
  //
  // Área Pessoal sem ninguém marcado continua permitida (cai na própria
  // coluna de quem criou, ver comentário no PUT/no front) -- nesse caso
  // específico (sem nenhum envolvido pra escolher) quem criou já é,
  // sozinha, a responsável, sem precisar escolher nada na tela.
  let finalResponsibleId = responsibleId;
  if (finalAssigneeIds.length === 0) {
    finalResponsibleId = req.user.id;
  } else if (!responsibleId || !finalAssigneeIds.includes(responsibleId)) {
    return res.status(400).json({ error: 'Marque um responsável (estrela) para esta demanda.' });
  }
  const demanda = {
    id: nanoid(),
    title: title.trim(),
    description: description || '',
    status: STATUSES.includes(status) ? status : 'a_fazer',
    visibility: VISIBILITIES.includes(visibility) ? visibility : 'geral',
    archived: false,
    dueDate: dueDate || null,
    recurrence: finalRecurrence,
    recurring: finalRecurrence !== 'none',
    assigneeIds: finalAssigneeIds,
    // Responsável geral (30ª rodada, obrigatório desde a 78ª): precisa
    // estar entre os marcados na demanda, exceto no caso "sem ninguém
    // marcado" da Área Pessoal (ver comentário acima), que cai pra quem
    // criou.
    responsibleId: finalResponsibleId,
    labelIds: validLabelIds(labelIds),
    color: validColor(color),
    link: validLink(link),
    checklistTitle: validChecklistTitle(checklistTitle),
    brand: validBrand(brand),
    network: validNetwork(network),
    // 26ª rodada: o checklist agora pode ser montado antes de o card existir
    // (rascunho local no front) — o que chegar aqui já vira o checklist do
    // card assim que ele é criado, em vez de nascer sempre vazio.
    checklist: sanitizeChecklistInput(checklist),
    // 78ª rodada: em qual lista pessoal (própria de quem criou) o card
    // nasce -- só faz sentido pra visibility 'pessoal', e só grava algo
    // quando a pessoa escolheu uma lista sua de verdade (se não escolher
    // nada, ou mandar uma lista que não é dela, cai sozinho na lista
    // padrão dela, resolvido ao vivo por personalListIdFor()).
    personalPlacements: (VISIBILITIES.includes(visibility) && visibility === 'pessoal' && personalListId && db.get('personalLists').find({ id: personalListId, ownerId: req.user.id }).value())
      ? { [req.user.id]: personalListId }
      : {},
    files: [],
    // 78ª rodada, pedido explícito da Raquel: "todo novo card cadastrado
    // deve ficar em primeiro lugar na lista" -- antes usava `Date.now()`
    // (positivo), que empurrava o card novo pro FIM da lista (qualquer
    // card mais antigo tem um timestamp menor). Usando o negativo do
    // timestamp, o card novo sempre fica menor que qualquer order já
    // existente (todos positivos, sejam da criação normal de antes desta
    // rodada, sejam de arrasto manual/"ordenar por data") -- e, entre 2
    // cards novos, o mais recente ainda fica por cima do anterior (mais
    // negativo). Quem arrastar o card muda a ordem normalmente depois
    // (ver PUT /reorder abaixo) -- isso só define a posição de NASCIMENTO.
    order: -Date.now(),
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    createdByName: req.user.name,
    updatedAt: new Date().toISOString()
  };
  db.get('demandas').push(demanda).write();
  logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: 'create', meta: { visibility: demanda.visibility } });
  res.json({ demanda: serialize(demanda, req.user.id) });
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

// ---------- Listas pessoais da Área Pessoal (78ª rodada) ----------
// Rotas literais (`/personal-lists...`) DEPOIS de `/reorder` mas SEMPRE
// ANTES de `PUT /:id`/`DELETE /:id` abaixo -- mesmo cuidado de ordem de
// rotas já usado no `/reorder` acima e no `/history` lá em cima (senão o
// Express interpretaria "personal-lists" como um :id de demanda de
// verdade, e essas rotas nunca seriam alcançadas).
function serializePersonalList(l) {
  return { id: l.id, name: l.name, order: l.order };
}

router.get('/personal-lists', requireAuth, (req, res) => {
  res.json({ lists: personalListsFor(req.user.id).map(serializePersonalList) });
});

router.post('/personal-lists', requireAuth, (req, res) => {
  const name = ((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: 'Dê um nome para a lista.' });
  const maxOrder = Math.max(0, ...db.get('personalLists').value().filter((l) => l.ownerId === req.user.id).map((l) => l.order));
  const list = { id: nanoid(), ownerId: req.user.id, name, order: maxOrder + 1000, createdAt: new Date().toISOString() };
  db.get('personalLists').push(list).write();
  res.json({ list: serializePersonalList(list) });
});

router.put('/personal-lists/reorder', requireAuth, (req, res) => {
  const order = Array.isArray((req.body || {}).order) ? req.body.order : [];
  order.forEach((id, idx) => {
    const list = db.get('personalLists').find({ id, ownerId: req.user.id }).value();
    if (!list) return; // ignora id que não existe ou não é dessa pessoa
    db.get('personalLists').find({ id }).assign({ order: idx * 1000 }).write();
  });
  res.json({ ok: true });
});

router.put('/personal-lists/:id', requireAuth, (req, res) => {
  const list = db.get('personalLists').find({ id: req.params.id, ownerId: req.user.id }).value();
  if (!list) return res.status(404).json({ error: 'Lista não encontrada.' });
  const name = ((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: 'Dê um nome para a lista.' });
  db.get('personalLists').find({ id: req.params.id }).assign({ name }).write();
  res.json({ list: serializePersonalList(db.get('personalLists').find({ id: req.params.id }).value()) });
});

// Apagar uma lista nunca apaga os cards que estavam nela -- eles voltam
// pra lista padrão da própria pessoa (ensureDefaultPersonalList), igual
// já acontece pra quem nunca organizou o card em lista nenhuma. Não deixa
// apagar a última lista que resta (sempre precisa sobrar pelo menos 1,
// senão a Área Pessoal fica sem nenhuma coluna pra mostrar nada).
router.delete('/personal-lists/:id', requireAuth, (req, res) => {
  const mine = db.get('personalLists').value().filter((l) => l.ownerId === req.user.id);
  const list = mine.find((l) => l.id === req.params.id);
  if (!list) return res.status(404).json({ error: 'Lista não encontrada.' });
  if (mine.length <= 1) return res.status(400).json({ error: 'Você precisa ter pelo menos uma lista na Área Pessoal.' });
  db.get('personalLists').remove({ id: req.params.id }).write();
  db.get('demandas').value().forEach((d) => {
    if (d.personalPlacements && d.personalPlacements[req.user.id] === req.params.id) {
      const updated = Object.assign({}, d.personalPlacements);
      delete updated[req.user.id];
      db.get('demandas').find({ id: d.id }).assign({ personalPlacements: updated }).write();
    }
  });
  res.json({ ok: true });
});

// Mover um card pra outra lista pessoal (78ª rodada) -- só mexe na
// organização de QUEM PEDIU (personalPlacements é por pessoa, ver
// comentário lá em cima); nunca move o card pra fora do alcance de quem
// mais o vê. `listId` precisa ser uma lista da PRÓPRIA pessoa que pediu.
router.put('/:id/personal-list', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  if (demanda.visibility !== 'pessoal') return res.status(400).json({ error: 'Só demandas da Área Pessoal têm lista.' });
  const listId = (req.body || {}).listId;
  const list = db.get('personalLists').find({ id: listId, ownerId: req.user.id }).value();
  if (!list) return res.status(400).json({ error: 'Lista inválida.' });
  const placements = Object.assign({}, demanda.personalPlacements || {}, { [req.user.id]: listId });
  db.get('demandas').find({ id: req.params.id }).assign({ personalPlacements: placements }).write();
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value(), req.user.id) });
});

router.put('/:id', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  const { title, description, dueDate, assigneeIds, labelIds, status, color, recurring, recurrence, link, checklistTitle, responsibleId, brand, network, personalListId } = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  // 78ª rodada: mudar de lista pessoal pelo próprio modal de edição do
  // card (mesma regra da rota dedicada PUT /:id/personal-list acima --
  // só aceita uma lista que seja DA PRÓPRIA pessoa que está salvando, e só
  // mexe na organização dela, nunca na de quem mais vir esse card).
  if (personalListId !== undefined && demanda.visibility === 'pessoal') {
    const list = db.get('personalLists').find({ id: personalListId, ownerId: req.user.id }).value();
    if (list) {
      updates.personalPlacements = Object.assign({}, demanda.personalPlacements || {}, { [req.user.id]: personalListId });
    }
  }
  if (title !== undefined) updates.title = title.trim();
  if (description !== undefined) updates.description = description;
  if (dueDate !== undefined) updates.dueDate = dueDate || null;
  if (status !== undefined && STATUSES.includes(status)) updates.status = status;
  if (assigneeIds !== undefined) updates.assigneeIds = validUserIds(assigneeIds);
  // Responsável geral (30ª rodada): valida contra os marcados que vão valer
  // DEPOIS dessa atualização (novos assigneeIds, se vieram junto; senão os
  // que a demanda já tinha) — pra não perder a marcação por engano quando o
  // card é salvo sem mexer nos marcados.
  const effectiveAssigneeIdsForResp = updates.assigneeIds !== undefined ? updates.assigneeIds : (demanda.assigneeIds || []);
  if (responsibleId !== undefined) {
    updates.responsibleId = effectiveAssigneeIdsForResp.includes(responsibleId) ? responsibleId : null;
  } else if (updates.assigneeIds !== undefined && demanda.responsibleId && !updates.assigneeIds.includes(demanda.responsibleId)) {
    // Se o responsável geral atual saiu da lista de marcados nessa mesma
    // atualização, a marcação cai junto (não faz sentido sobreviver sozinha).
    updates.responsibleId = null;
  }
  // Área Pessoal sem ninguém marcado (mesmo caso do POST acima): quem
  // criou a demanda continua sendo a responsável sozinha, sem travar a
  // edição pedindo pra escolher alguém que nem existe pra marcar.
  if (effectiveAssigneeIdsForResp.length === 0 && (updates.responsibleId === null || updates.responsibleId === undefined)) {
    updates.responsibleId = demanda.createdBy || req.user.id;
  }
  // 78ª rodada, pedido da Raquel: "toda demanda deve ter um responsável
  // marcado, não importa de onde veio". A obrigatoriedade de verdade é
  // aplicada na CRIAÇÃO (ver POST acima, e o preenchimento automático em
  // createDemandCardsForNewInvolved pras demandas que nascem de
  // Agendamento/Influencer) -- aqui na edição, só recusa se essa PRÓPRIA
  // edição fosse deixar uma demanda que JÁ TINHA responsável sem nenhum
  // (removido sem substituto), pra nunca "desmarcar" por acidente. Uma
  // demanda antiga (de antes desta regra existir) que ainda não tem
  // responsável nenhum continua editável normalmente nos outros campos --
  // não trava o quadro inteiro até alguém preencher isso peça por peça.
  if (demanda.responsibleId) {
    const effectiveResponsibleId = updates.responsibleId !== undefined ? updates.responsibleId : demanda.responsibleId;
    if (!effectiveResponsibleId) {
      return res.status(400).json({ error: 'Toda demanda precisa de um responsável (estrela) marcado -- escolha um antes de salvar.' });
    }
  }
  if (labelIds !== undefined) updates.labelIds = validLabelIds(labelIds);
  if (color !== undefined) updates.color = validColor(color);
  // recurrence (campo novo) tem prioridade; recurring (booleano antigo)
  // continua aceito por compatibilidade, mapeado pra 'mensal'/'none'.
  if (recurrence !== undefined) {
    updates.recurrence = validRecurrence(recurrence) || 'none';
    updates.recurring = updates.recurrence !== 'none';
  } else if (recurring !== undefined) {
    updates.recurrence = recurring ? 'mensal' : 'none';
    updates.recurring = !!recurring;
  }
  if (link !== undefined) updates.link = validLink(link);
  if (checklistTitle !== undefined) updates.checklistTitle = validChecklistTitle(checklistTitle);
  if (brand !== undefined) updates.brand = validBrand(brand);
  if (network !== undefined) updates.network = validNetwork(network);

  // Recorrência (15ª rodada): se essa demanda é (ou está virando) recorrente,
  // precisa de data de entrega (é ela que define o "dia do mês"). Se o
  // status está sendo marcado como "Concluída", em vez de ficar concluída
  // ela volta sozinha pra "A Fazer" com a data empurrada pro mesmo dia do
  // mês seguinte — sem criar card novo.
  const effectiveRecurrenceValue = updates.recurrence !== undefined ? updates.recurrence : effectiveRecurrence(demanda);
  const effectiveDueDate = updates.dueDate !== undefined ? updates.dueDate : demanda.dueDate;
  if (effectiveRecurrenceValue !== 'none' && !effectiveDueDate) {
    return res.status(400).json({ error: 'Defina uma data de entrega para usar recorrência.' });
  }
  // lastCompletedAt (36ª rodada, pedido da Raquel): guarda o momento exato
  // da conclusão, separado do `status`/`updatedAt` -- sobrevive ao "bounce"
  // de demanda recorrente (que volta sozinha pra "a_fazer" logo abaixo) e
  // não é apagado quando a demanda é arquivada depois. O REIS DO MARKETING
  // usa esse campo (não o status atual) pra saber se/quando um card foi
  // concluído no mês -- antes, demanda recorrente NUNCA pontuava por essa
  // fonte (nunca ficava parada em status 'concluida'), e demanda arquivada
  // era ignorada por inteiro na pontuação.
  //
  // lastCompletedDueDate (39ª rodada, pedido da Raquel): guarda, JUNTO com
  // `lastCompletedAt`, a data de entrega que valia NESTE exato momento --
  // ou seja, `effectiveDueDate`, calculado ACIMA, antes do bloco de
  // recorrência logo abaixo empurrar `updates.dueDate` pro mês seguinte.
  // Precisa ser capturado aqui (e não lido depois, do banco) porque pra
  // card recorrente a `dueDate` muda na MESMA gravação em que é concluído
  // -- se o REIS DO MARKETING fosse olhar a `dueDate` atual do card, já
  // estaria vendo a data da PRÓXIMA ocorrência, não a que valia quando essa
  // conclusão aconteceu.
  if (updates.status === 'concluida' && demanda.status !== 'concluida') {
    updates.lastCompletedAt = updates.updatedAt;
    updates.lastCompletedDueDate = effectiveDueDate || null;
  }
  let recurringReset = null;
  if (updates.status === 'concluida' && effectiveRecurrenceValue !== 'none' && effectiveDueDate) {
    updates.status = 'a_fazer';
    updates.dueDate = advanceDueDate(effectiveDueDate, effectiveRecurrenceValue);
    recurringReset = updates.dueDate;
  }

  // Auto-arquivar ao concluir (40ª rodada, pedido da Raquel: "em demandas,
  // sempre que a demanda for marcada como concluida, ela deve se arquivar
  // automaticamente (para todos que estavam no card)"). Só dispara na
  // TRANSIÇÃO de verdade pra "Concluída" (`demanda.status !== 'concluida'`
  // antes dessa gravação) -- checado DEPOIS do bloco de recorrência acima,
  // porque uma demanda recorrente "concluída" volta sozinha pra "A Fazer"
  // (updates.status já foi revertido ali em cima) e não deve arquivar. As
  // demandas-irmãs do mesmo agendamento (mesmo card, "para todos que
  // estavam") são arquivadas junto logo abaixo, dentro de
  // cascadeCompleteDemandas (utils/demandCascade.js), que agora também
  // grava `archived: true`.
  if (updates.status === 'concluida' && demanda.status !== 'concluida') {
    updates.archived = true;
  }

  const details = describeChanges(demanda, updates);
  db.get('demandas').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: updates.title || demanda.title, action: 'update', details, meta: { visibility: demanda.visibility } });
  // 34ª rodada: se essa demanda veio de um agendamento de redes sociais
  // (junto com outras, uma por pessoa marcada como envolvida) e ela
  // acabou de virar "Concluída" de verdade (não o caso de recorrência
  // acima, que volta sozinha pra "A Fazer"), arrasta as demandas-irmãs do
  // mesmo agendamento junto — pedido da Raquel: concluir pra uma pessoa
  // marcada deve concluir pra todas.
  if (updates.status === 'concluida' && demanda.sourceSocialPostId) {
    cascadeCompleteDemandas(demanda.sourceSocialPostId, demanda.id, req);
    // 36ª rodada: se o agendamento de origem veio de uma ação da planilha
    // de influencers, concluir a demanda aqui também publica o
    // agendamento e a ação de influencer ligados -- "tudo se altera
    // junto", pedido da Raquel.
    const linkedPost = db.get('socialPosts').find({ id: demanda.sourceSocialPostId }).value();
    if (linkedPost && linkedPost.sourceInfluencerPostId) {
      markSocialPostPublished(demanda.sourceSocialPostId, req);
    }
  }
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value(), req.user.id), recurringReset });
});

router.put('/:id/archive', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  const archived = !!(req.body || {}).archived;
  db.get('demandas').find({ id: req.params.id }).assign({ archived, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: archived ? 'archive' : 'unarchive', meta: { visibility: demanda.visibility } });
  res.json({ ok: true });
});

// Sair do card (53ª rodada, pedido da Raquel: "se eu for colocada em um
// card, e quiser sair dele, eu posso sair e aí o card some automaticamente
// da minha lista. Mas ele permanece para as demais pessoas. Independente
// da forma que o card foi criado, por demanda, por planilha de influencer,
// por agendamento"). Tira só quem pediu de `assigneeIds` (e do
// `responsibleId`, se era ela a marcada) -- o card em si nunca é tocado
// pras outras pessoas, seja lá de onde ele tiver nascido (criado direto
// aqui, ou automaticamente a partir de um Agendamento/ação de Influencer:
// pra essa rota não faz diferença nenhuma, é sempre o mesmo campo
// `assigneeIds` do mesmo tipo de registro `demanda`).
router.post('/:id/leave', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  if (!(demanda.assigneeIds || []).includes(req.user.id)) {
    return res.status(400).json({ error: 'Você não está marcado(a) nessa demanda.' });
  }
  const assigneeIds = (demanda.assigneeIds || []).filter((id) => id !== req.user.id);
  const updates = { assigneeIds, updatedAt: new Date().toISOString() };
  if (demanda.responsibleId === req.user.id) updates.responsibleId = null;
  db.get('demandas').find({ id: demanda.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: 'update', details: `${req.user.name} saiu do card`, meta: { visibility: demanda.visibility } });
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  // 53ª rodada, pedido da Raquel: antes, qualquer pessoa marcada (ou, no
  // Quadro Geral, qualquer pessoa logada) conseguia excluir a demanda pra
  // todo mundo. Agora só quem CRIOU o card pode excluir de vez -- quem só
  // foi marcado e quer se desvincular usa "Sair do card" (rota acima), que
  // não mexe em nada pra ninguém além de quem saiu.
  if (demanda.createdBy !== req.user.id) {
    return res.status(403).json({ error: 'Só quem criou a demanda pode excluí-la. Se você foi marcado(a) nela e quer sair, use "Sair do card".' });
  }
  // 36ª rodada: se essa demanda veio (via sourceSocialPostId) de um
  // agendamento criado a partir de uma ação de influencer, apagar o card
  // apaga o trio inteiro (demanda(s) irmãs + agendamento + ação de
  // influencer) -- pedido da Raquel: "se a ação é excluída... tudo que
  // está ligado a ela deve ser alterado também". Agendamento comum
  // (sem vínculo de influencer) mantém o comportamento de sempre: só a
  // própria demanda some.
  if (demanda.sourceSocialPostId) {
    const linkedPost = db.get('socialPosts').find({ id: demanda.sourceSocialPostId }).value();
    if (linkedPost && linkedPost.sourceInfluencerPostId) {
      deleteInfluencerTriad({ socialPostId: linkedPost.id }, req);
      return res.json({ ok: true });
    }
  }
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

// Comentários (78ª rodada, pedido da Raquel: "no card, deve ter a opção de
// por comentários que ficam no histórico dele") -- vira só mais uma
// entrada no MESMO auditLog do histórico acima (`action: 'comment'`), sem
// precisar de uma coleção nova nem de uma tela separada: o comentário
// aparece junto com o resto do histórico, na ordem certa, com quem
// escreveu e quando. Mesmo controle de acesso de sempre (findOr404) —
// comentar numa demanda pessoal exige poder VER ela.
router.post('/:id/comments', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  const text = ((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: 'Escreva um comentário.' });
  logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: 'comment', details: text, meta: { visibility: demanda.visibility } });
  res.json({ ok: true });
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
  // Data de entrega do item (31ª rodada) — opcional, aceita já na criação.
  const dueDate = (req.body || {}).dueDate || null;
  const item = { id: nanoid(), text, done: false, assigneeId, doneAt: null, dueDate };
  const checklist = [...(demanda.checklist || []), item];
  db.get('demandas').find({ id: req.params.id }).assign({ checklist, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: 'checklist_add', details: `Item adicionado ao checklist: "${text}"`, meta: { visibility: demanda.visibility } });
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value(), req.user.id) });
});

router.put('/:id/checklist/:itemId', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  const { text, done, assigneeId, dueDate } = req.body || {};
  const before = (demanda.checklist || []).find((it) => it.id === req.params.itemId);
  const checklist = (demanda.checklist || []).map((it) => {
    if (it.id !== req.params.itemId) return it;
    const patch = Object.assign(
      {},
      text !== undefined ? { text } : {},
      done !== undefined ? { done: !!done } : {},
      assigneeId !== undefined ? { assigneeId: validUserId(assigneeId) } : {},
      // Data de entrega do item (31ª rodada) — envia string vazia/null pra
      // limpar, igual ao padrão já usado na dueDate do card inteiro.
      dueDate !== undefined ? { dueDate: dueDate || null } : {}
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
    } else if (after && dueDate !== undefined && (after.dueDate || null) !== (before.dueDate || null)) {
      detail = `Data de entrega do item "${after.text}" ajustada para ${after.dueDate ? after.dueDate : 'sem data'}`;
    }
    if (detail) logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: 'checklist_update', details: detail, meta: { visibility: demanda.visibility } });
  }
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value(), req.user.id) });
});

router.delete('/:id/checklist/:itemId', requireAuth, (req, res) => {
  const demanda = findOr404(req, res);
  if (!demanda) return;
  const target = (demanda.checklist || []).find((it) => it.id === req.params.itemId);
  const checklist = (demanda.checklist || []).filter((it) => it.id !== req.params.itemId);
  db.get('demandas').find({ id: req.params.id }).assign({ checklist, updatedAt: new Date().toISOString() }).write();
  if (target) logAudit({ user: req.user, entityType: 'demanda', entityId: demanda.id, entityLabel: demanda.title, action: 'checklist_remove', details: `Item removido do checklist: "${target.text}"`, meta: { visibility: demanda.visibility } });
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value(), req.user.id) });
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
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value(), req.user.id) });
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
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value(), req.user.id) });
});

module.exports = router;
