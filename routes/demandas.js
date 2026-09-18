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

function serialize(d) {
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
    recurring: !!d.recurring,
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
  db.get('demandas').value().forEach((d) => {
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
    if (d.lastCompletedAt && d.lastCompletedAt.slice(0, 7) === ym) {
      const pontuamNesseCard = new Set(d.assigneeIds || []);
      if (d.responsibleId) pontuamNesseCard.add(d.responsibleId);
      pontuamNesseCard.forEach(addPoint);
    }
    // (2) itens de checklist concluídos neste mês -- 1 ponto por item, à
    // parte da pontuação do card (soma, não substitui).
    (d.checklist || []).forEach((it) => {
      if (it.assigneeId && it.done && it.doneAt && it.doneAt.slice(0, 7) === ym) {
        addPoint(it.assigneeId);
      }
    });
  });
  res.json({ month: ym, counts, excludedIds: Array.from(excludedIds) });
});

router.post('/', requireAuth, (req, res) => {
  const { title, description, dueDate, assigneeIds, labelIds, status, visibility, color, recurring, link, checklistTitle, checklist, responsibleId, brand, network } = req.body || {};
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
    brand: validBrand(brand),
    network: validNetwork(network),
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
  const { title, description, dueDate, assigneeIds, labelIds, status, color, recurring, link, checklistTitle, responsibleId, brand, network } = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  if (title !== undefined) updates.title = title.trim();
  if (description !== undefined) updates.description = description;
  if (dueDate !== undefined) updates.dueDate = dueDate || null;
  if (status !== undefined && STATUSES.includes(status)) updates.status = status;
  // lastCompletedAt (36ª rodada, pedido da Raquel): guarda o momento exato
  // da conclusão, separado do `status`/`updatedAt` -- sobrevive ao "bounce"
  // de demanda recorrente (que volta sozinha pra "a_fazer" na MESMA
  // gravação, ver bloco de recorrência abaixo) e não é apagado quando a
  // demanda é arquivada depois. O REIS DO MARKETING usa esse campo (não o
  // status atual) pra saber se/quando um card foi concluído no mês --
  // antes, demanda recorrente NUNCA pontuava por essa fonte (nunca ficava
  // parada em status 'concluida'), e demanda arquivada era ignorada por
  // inteiro na pontuação.
  if (updates.status === 'concluida' && demanda.status !== 'concluida') {
    updates.lastCompletedAt = updates.updatedAt;
  }
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
  if (brand !== undefined) updates.brand = validBrand(brand);
  if (network !== undefined) updates.network = validNetwork(network);

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
  res.json({ demanda: serialize(db.get('demandas').find({ id: req.params.id }).value()) });
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
