const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { resolveUserName } = require('../utils/names');
const shareLinks = require('../utils/shareLinks');

const router = express.Router();

// Brindes — catálogo/estoque (por marca) e registro de saídas por
// representante. Catálogo inicial semeado a partir da planilha de controle
// de brindes 2026; a partir daqui os dados vivem só no banco da Plataforma.
//
// Acesso: qualquer pessoa logada pode VER (catálogo e registro de saídas);
// só quem tem permissão "brindes" = editor/admin (ou é admin da
// plataforma) pode criar/editar/excluir — permissão configurada na tela
// de Usuários.
function canEdit(req) {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  const access = (user.permissions || {}).brindes || 'none';
  return access === 'editor' || access === 'admin';
}
function requireBrindesEdit(req, res, next) {
  if (!canEdit(req)) return res.status(403).json({ error: 'Você não tem permissão para editar Brindes.' });
  next();
}

function sumStock(pr, sp, pe) {
  return (Number(pr) || 0) + (Number(sp) || 0) + (Number(pe) || 0);
}

// 62ª rodada, pedido da Raquel: "no controle geral dos brindes, em
// catálogo, são várias pessoas que fazem a atualização, por isso precisa
// ter como colocar a data da última atualização do estoque e quem
// atualizou, isso para cada região (PR, PE, SP)" -- cada item guarda,
// pra cada uma das 3 praças, quando e quem foi a última pessoa a mudar
// aquele número (ver PUT /catalog/:id abaixo). Resolve o nome ao vivo
// (mesmo padrão de resolveUserName usado em createdByName de Demandas),
// caindo pro nome gravado na hora se a pessoa não existir mais.
function serializeCatalogItem(it) {
  const out = Object.assign({}, it);
  ['PR', 'SP', 'PE'].forEach((region) => {
    const byKey = 'estoque' + region + 'UpdatedBy';
    const nameKey = 'estoque' + region + 'UpdatedByName';
    if (it[byKey]) out[nameKey] = resolveUserName(it[byKey], it[nameKey] || '');
  });
  return out;
}

// Desconto automático de estoque no Registro de Saídas de Controle Geral
// (44ª rodada, pedido da Raquel: "ao registrar uma retirada/saída no
// Controle Geral, o item retirado deve descontar do estoque
// automaticamente" — hoje era só um log, sem descontar nada). Retiradas
// Internas (routes/retiradasInternas.js) continua exatamente como estava,
// de propósito — não desconta (decisão da Raquel, mantida sem mudança).
//
// O catálogo guarda o estoque em 3 praças (PR/SP/PE) — o formulário de
// saída não pergunta de qual praça o item saiu, então a baixa é feita em
// cascata (primeiro PR, depois SP, depois PE), sem deixar nenhuma praça
// ficar negativa. Guardamos exatamente quanto foi tirado de cada praça
// (`estoqueDeduzido`) no próprio registro de saída, pra dar pra desfazer
// certinho se o registro for editado ou excluído depois — mesmo espírito
// de "reversível" já usado na sincronia Feiras→Budget (41ª rodada).
function decrementCatalogStock(catalogItemId, quantidade) {
  const qty = Math.max(0, Math.round(Number(quantidade) || 0));
  if (!catalogItemId || !qty) return null;
  const item = db.get('brindesCatalog').find({ id: catalogItemId }).value();
  if (!item) return null;
  let remaining = qty;
  const deduction = { estoquePR: 0, estoqueSP: 0, estoquePE: 0 };
  const updates = {
    estoquePR: Number(item.estoquePR) || 0,
    estoqueSP: Number(item.estoqueSP) || 0,
    estoquePE: Number(item.estoquePE) || 0
  };
  ['estoquePR', 'estoqueSP', 'estoquePE'].forEach((field) => {
    if (remaining <= 0) return;
    const take = Math.min(remaining, updates[field]);
    updates[field] -= take;
    deduction[field] = take;
    remaining -= take;
  });
  updates.estoqueTotal = sumStock(updates.estoquePR, updates.estoqueSP, updates.estoquePE);
  updates.updatedAt = new Date().toISOString();
  db.get('brindesCatalog').find({ id: catalogItemId }).assign(updates).write();
  return deduction;
}

function restoreCatalogStock(catalogItemId, deduction) {
  if (!catalogItemId || !deduction) return;
  const item = db.get('brindesCatalog').find({ id: catalogItemId }).value();
  if (!item) return; // item pode ter sido excluído do catálogo nesse meio tempo
  const updates = {
    estoquePR: (Number(item.estoquePR) || 0) + (Number(deduction.estoquePR) || 0),
    estoqueSP: (Number(item.estoqueSP) || 0) + (Number(deduction.estoqueSP) || 0),
    estoquePE: (Number(item.estoquePE) || 0) + (Number(deduction.estoquePE) || 0)
  };
  updates.estoqueTotal = sumStock(updates.estoquePR, updates.estoqueSP, updates.estoquePE);
  updates.updatedAt = new Date().toISOString();
  db.get('brindesCatalog').find({ id: catalogItemId }).assign(updates).write();
}

function catalogItem(brand, group, code, item, multiplo, valor, pr, sp, pe, status, obs) {
  return {
    id: nanoid(),
    brand,
    group,
    code,
    item,
    multiplo: multiplo || '',
    valor: valor === null || valor === undefined ? null : Number(valor),
    estoquePR: Number(pr) || 0,
    estoqueSP: Number(sp) || 0,
    estoquePE: Number(pe) || 0,
    estoqueTotal: sumStock(pr, sp, pe),
    status: status || '',
    obs: obs || '',
    updatedAt: new Date().toISOString()
  };
}

function seedCatalogIfEmpty() {
  if (db.get('brindesCatalog').size().value() > 0) return;
  const rows = [
    // De Bacco — catálogo/estoque
    catalogItem('debacco', 'Brindes', '99.99.00066', 'Caneta Metálica', 1, 6.0, 0, 160, 50, 'OK', ''),
    catalogItem('debacco', 'Brindes', '99.99.00108', 'Prancheta', 1, 15.98, 1608, 685, 90, '', ''),
    catalogItem('debacco', 'Brindes', '99.99.00149', 'Avental', 5, 24.96, 220, 154, 45, 'comprado', ''),
    catalogItem('debacco', 'Brindes', '99.99.00153', 'Luva de Cozinha', 1, 10.8, 125, 160, 75, 'OK', ''),
    catalogItem('debacco', 'Brindes', '99.99.00174', 'Saca Rolha de Vinho Elétrico - SWA-WG08', 1, 34.77, 0, 0, 7, 'CANCELAR', ''),
    catalogItem('debacco', 'Brindes', '99.99.00189', 'Copo Stanley - AZ2024', 1, 17.0, 50, 160, 15, '', ''),
    catalogItem('debacco', 'Brindes', '99.99.00249', 'Catálogo Completo 2026', 10, 6.7, 1650, 160, 200, '', ''),
    catalogItem('debacco', 'Brindes', '99.99.00272', 'Saca Rolha de Vinho Manual', 1, 8.48, 107, 265, 10, 'comprado', 'Ver para fazer novo pedido'),
    catalogItem('debacco', 'Brindes', '99.99.00370', 'Sacola Kraft', 10, 1.83, 1180, 1105, 690, 'OK', 'Pesquisar novo modelo'),
    catalogItem('debacco', 'Brindes', '99.99.00371', 'Copo Inox Café 150ml - S-SC05-150-T2', 2, 21.59, 355, 68, 57, 'OK', 'Comprar 1.000 unitário'),
    catalogItem('debacco', 'Brindes', '99.99.00447', 'Lápis Preto 2B Normal', 1, 2.0, 680, 60, 360, '', ''),
    catalogItem('debacco', 'Brindes', '99.99.00448', 'Lápis Preto 2B Swarovski', 1, 4.5, 275, 100, 54, '', ''),
    catalogItem('debacco', 'Brindes', '99.99.00199', 'Folder lançamentos', 20, 1.64, 0, 300, 120, '', 'usar cod acesso 30.06.00082'),
    // GhelPlus — brindes e catálogos
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00064', 'Catálogo', 10, 1.95, 200, 1870, 120, 'ok', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00239', 'Folder', 25, 2.21, 0, 0, 0, 'Zerar estoque', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00060', 'Caneta Plástica', 10, 2.15, 25, 86, 100, 'ok', 'comprado — 6 mil'),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00074', 'Abridor Chaveiro', 5, 2.7, 0, 25, 30, 'ok', 'comprado — 2700'),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00091', 'Calendário', 20, 2.9, 0, 0, 0, 'ok', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00094', 'Sacola Papel Kraft', 10, 2.03, 2159, 400, 440, 'ok', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00096', 'Bloquinho Pequeno', 10, 3.0, 500, 600, 260, 'ok', 'Mudar layout / orçar'),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00098', 'Boné', 20, 14.09, 72, 20, 67, 'ok', 'Comprar — menos de 15 mil'),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00126', 'Kit Churrasco', 99, 40.0, 49, 10, 10, 'ok', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00138', 'Caneta Metálica', 5, 6.5, 152, 0, 40, 'ok', 'comprado — 2875'),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00166', 'Régua Grande', 5, 8.5, 110, 10, 35, 'ok', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00197', 'Balas', 100, 22.0, 0, 0, 0, 'ok', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00262', 'Sal Parrilla Cebola/Alecrim/Alho', 6, 6.5, 396, 33, 4, 'Compra efetuada', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00263', 'Sal Parrilla Chimichurri', 6, 6.5, 423, 18, 4, 'Compra efetuada', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00267', 'Luva Térmica', 5, 9.8, 0, 0, 0, 'Não faremos mais', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00271', 'Avental', 5, 17.0, 0, 5, 0, 'Não faremos mais', ''),
    catalogItem('ghelplus', 'Brindes e Catálogos', '99.99.00188', 'Copo Stanley - AZ2024', 1, 17.0, 849, 188, 10, '', 'Comprar 500 — falta orçar'),
    // GhelPlus — materiais de PDV
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00082', 'Adesivo de Válvula 3.1/2', 6, 0.45, 36, 300, 40, '', 'Em análise se vai ser feito'),
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00084', 'Tag de Preço', 40, 0.55, 1000, 1035, 1200, 'ok', ''),
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00111', 'Balões', 50, 0.28, 450, 1000, 1950, 'ok', ''),
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00121', 'Bobina de Foração', 1, 243.0, 2, 7, 2, 'ok', ''),
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00134', 'Clip Strip Gôndula', 25, 2.99, 0, 300, 80, '', ''),
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00151', 'Adesivo P/ Válvula 4 1/2', 4, 0.54, 0, 0, 0, '', 'Em análise se vai ser feito'),
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00161', 'Bandeirinhas', 54, 0.9, 2898, 1200, 3156, 'ok', ''),
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00162', 'Tarja de Gôndolas', 20, 0.8, 3140, 1150, 2300, 'ok', ''),
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00163', 'Mobile de Teto', 10, 1.98, 1250, 1850, 490, 'ok', ''),
    catalogItem('ghelplus', 'Materiais de PDV', '99.99.00164', 'Cubos 20 x 20 cm', 10, 3.09, 595, 1200, 200, 'ok', '')
  ];
  db.get('brindesCatalog').push(...rows).write();
}
seedCatalogIfEmpty();

// ---------- catálogo/estoque ----------
router.get('/catalog', requireAuth, (req, res) => {
  const { brand } = req.query;
  let rows = db.get('brindesCatalog').value();
  if (brand) rows = rows.filter((r) => r.brand === brand);
  res.json({ items: rows.map(serializeCatalogItem) });
});

// "Brindes com estoque baixo" (20ª rodada, pedido da Raquel pra tela
// Início). Não existe um limite "oficial" de estoque baixo cadastrado no
// sistema — usamos 50 unidades (somando as 3 praças) como valor padrão
// documentado, ajustável aqui se a Raquel definir outro número depois.
// Item marcado como cancelado/descontinuado não entra na lista (não faz
// sentido pedir reposição de algo que não vai ser comprado de novo).
const LOW_STOCK_THRESHOLD = 50;
const DISCONTINUED_STATUSES = ['cancelar', 'não faremos mais'];
router.get('/low-stock', requireAuth, (req, res) => {
  const items = db.get('brindesCatalog').value()
    .filter((it) => it.estoqueTotal <= LOW_STOCK_THRESHOLD)
    .filter((it) => !DISCONTINUED_STATUSES.includes((it.status || '').trim().toLowerCase()))
    .sort((a, b) => a.estoqueTotal - b.estoqueTotal);
  res.json({ items, threshold: LOW_STOCK_THRESHOLD });
});

router.post('/catalog', requireAuth, requireBrindesEdit, (req, res) => {
  const { brand, group, code, item, multiplo, valor, estoquePR, estoqueSP, estoquePE, status, obs } = req.body || {};
  if (!brand || !item) return res.status(400).json({ error: 'Preencha marca e nome do item.' });
  const row = catalogItem(brand, group || '', code || '', item, multiplo, valor, estoquePR, estoqueSP, estoquePE, status, obs);
  db.get('brindesCatalog').push(row).write();
  logAudit({ user: req.user, entityType: 'brindeCatalogo', entityId: row.id, entityLabel: row.item, action: 'create' });
  res.json({ item: row });
});

router.put('/catalog/:id', requireAuth, requireBrindesEdit, (req, res) => {
  const existing = db.get('brindesCatalog').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Item não encontrado.' });
  const b = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  ['brand', 'group', 'code', 'item', 'multiplo', 'status', 'obs'].forEach((k) => {
    if (b[k] !== undefined) updates[k] = b[k];
  });
  if (b.valor !== undefined) updates.valor = b.valor === '' ? null : Number(b.valor);
  // 62ª rodada: carimba data/quem só na(s) praça(s) que realmente mudou de
  // número -- editar outro campo do card (ex.: "obs") não deve sujar o
  // carimbo de uma praça que nem foi tocada nessa edição.
  ['estoquePR', 'estoqueSP', 'estoquePE'].forEach((k) => {
    if (b[k] === undefined) return;
    const novo = Number(b[k]) || 0;
    updates[k] = novo;
    if (novo !== (Number(existing[k]) || 0)) {
      updates[k + 'UpdatedAt'] = new Date().toISOString();
      updates[k + 'UpdatedBy'] = req.user.id;
      updates[k + 'UpdatedByName'] = req.user.name;
    }
  });
  const pr = updates.estoquePR !== undefined ? updates.estoquePR : existing.estoquePR;
  const sp = updates.estoqueSP !== undefined ? updates.estoqueSP : existing.estoqueSP;
  const pe = updates.estoquePE !== undefined ? updates.estoquePE : existing.estoquePE;
  updates.estoqueTotal = sumStock(pr, sp, pe);
  db.get('brindesCatalog').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'brindeCatalogo', entityId: existing.id, entityLabel: existing.item, action: 'update' });
  res.json({ item: serializeCatalogItem(db.get('brindesCatalog').find({ id: req.params.id }).value()) });
});

router.delete('/catalog/:id', requireAuth, requireBrindesEdit, (req, res) => {
  const existing = db.get('brindesCatalog').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Item não encontrado.' });
  db.get('brindesCatalog').remove({ id: req.params.id }).write();
  logAudit({ user: req.user, entityType: 'brindeCatalogo', entityId: existing.id, entityLabel: existing.item, action: 'delete' });
  res.json({ ok: true });
});

// ---------- registro de saídas (controle por representante) ----------
router.get('/log', requireAuth, (req, res) => {
  const { brand } = req.query;
  let rows = db.get('brindesLog').value();
  if (brand) rows = rows.filter((r) => r.brand === brand);
  rows = rows.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  // Nome resolvido ao vivo (20ª rodada) — ver utils/names.js.
  rows = rows.map((r) => Object.assign({}, r, { createdByName: resolveUserName(r.createdBy, r.createdByName) }));
  res.json({ items: rows });
});

router.post('/log', requireAuth, requireBrindesEdit, (req, res) => {
  const { brand, date, gerente, representante, estado, cliente, quantidade, item, motivo, obs, catalogItemId } = req.body || {};
  if (!brand || !item) return res.status(400).json({ error: 'Preencha marca e item.' });
  const finalQuantidade = Number(quantidade) || 0;
  // catalogItemId é como a Plataforma sabe de qual item do catálogo
  // descontar — sem ele (ex.: registro antigo/vindo de outro fluxo), o
  // registro é salvo normalmente, só que sem desconto (não tem de onde
  // descontar).
  let finalCatalogItemId = catalogItemId || null;
  if (finalCatalogItemId && !db.get('brindesCatalog').find({ id: finalCatalogItemId }).value()) {
    finalCatalogItemId = null;
  }
  const estoqueDeduzido = finalCatalogItemId ? decrementCatalogStock(finalCatalogItemId, finalQuantidade) : null;
  const row = {
    id: nanoid(),
    brand,
    date: date || new Date().toISOString().slice(0, 10),
    gerente: gerente || '',
    representante: representante || '',
    estado: estado || '',
    cliente: cliente || '',
    quantidade: finalQuantidade,
    item,
    catalogItemId: finalCatalogItemId,
    estoqueDeduzido,
    motivo: motivo || '',
    obs: obs || '',
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    createdByName: req.user.name
  };
  db.get('brindesLog').push(row).write();
  logAudit({ user: req.user, entityType: 'brindeSaida', entityId: row.id, entityLabel: `${row.item} · ${row.quantidade}`, action: 'create' });
  res.json({ item: row });
});

router.put('/log/:id', requireAuth, requireBrindesEdit, (req, res) => {
  const existing = db.get('brindesLog').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Registro não encontrado.' });
  const b = req.body || {};
  const updates = {};
  ['brand', 'date', 'gerente', 'representante', 'estado', 'cliente', 'item', 'motivo', 'obs'].forEach((k) => {
    if (b[k] !== undefined) updates[k] = b[k];
  });
  if (b.quantidade !== undefined) updates.quantidade = Number(b.quantidade) || 0;
  if (b.catalogItemId !== undefined) {
    updates.catalogItemId = (b.catalogItemId && db.get('brindesCatalog').find({ id: b.catalogItemId }).value()) ? b.catalogItemId : null;
  }
  // Se o item vinculado ou a quantidade mudou, desfaz o desconto antigo
  // por inteiro e aplica o novo do zero — mesmo espírito "uma edição
  // sempre apaga e recria" já usado na sincronia Feiras→Budget (41ª
  // rodada): mais simples e seguro do que calcular só a diferença.
  if (updates.catalogItemId !== undefined || updates.quantidade !== undefined) {
    restoreCatalogStock(existing.catalogItemId, existing.estoqueDeduzido);
    const newCatalogItemId = updates.catalogItemId !== undefined ? updates.catalogItemId : (existing.catalogItemId || null);
    const newQuantidade = updates.quantidade !== undefined ? updates.quantidade : existing.quantidade;
    updates.estoqueDeduzido = newCatalogItemId ? decrementCatalogStock(newCatalogItemId, newQuantidade) : null;
  }
  db.get('brindesLog').find({ id: req.params.id }).assign(updates).write();
  res.json({ item: db.get('brindesLog').find({ id: req.params.id }).value() });
});

router.delete('/log/:id', requireAuth, requireBrindesEdit, (req, res) => {
  const existing = db.get('brindesLog').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Registro não encontrado.' });
  restoreCatalogStock(existing.catalogItemId, existing.estoqueDeduzido);
  db.get('brindesLog').remove({ id: req.params.id }).write();
  res.json({ ok: true });
});

// ---------- link externo (66ª rodada, "Rodada H"; edição desde a 68ª
// rodada) ----------
// Um link por marca, só do catálogo (não do Registro de Saídas, que tem
// dado de retirada por representante). Desde a 68ª rodada, pedido
// explícito da Raquel ("deve ter a opção de apenas visualizar ou
// editar... pessoas que não acessam a planilha, precisam fazer esse
// controle"), o link pode ser gerado no modo 'edicao' -- nesse modo,
// quem abre o link (sem login nenhum) pode atualizar o ESTOQUE (PR/SP/
// PE) de cada item, exatamente o "controle" que a Raquel descreveu.
// Nenhum outro campo (nome do item, código, valor, status) é editável
// por esse link -- mesmo cuidado de escopo mínimo já documentado em
// utils/shareLinks.js. Como não existe login nesse fluxo, quem edita
// precisa informar o próprio nome a cada alteração -- fica gravado como
// "(nome) via link externo" nos mesmos carimbos por praça da 62ª rodada,
// pra sempre dar pra saber que essa mudança específica não veio de
// dentro da Papoi.
router.get('/public/:token', (req, res) => {
  const link = shareLinks.findByToken(req.params.token);
  if (!link || link.resource !== 'brindes') return res.status(404).json({ error: 'Link inválido ou desativado.' });
  const items = db.get('brindesCatalog').value().filter((r) => r.brand === link.scopeKey).map(serializeCatalogItem);
  res.json({ brand: link.scopeKey, mode: link.mode || 'leitura', items });
});

// 68ª rodada: atualizar o estoque de 1 item via link externo em modo
// 'edicao' -- sem requireAuth (mesmo motivo de sempre: quem chega aqui é
// um visitante sem conta na Papoi), mas com validações redobradas: o
// token precisa ser de verdade, precisa ser 'edicao' (não só 'leitura'),
// e o item precisa pertencer à MESMA marca do link (nunca deixa editar
// um item de outra marca só porque a pessoa adivinhou o id).
router.put('/public/:token/catalog/:id', (req, res) => {
  const link = shareLinks.findByToken(req.params.token);
  if (!link || link.resource !== 'brindes') return res.status(404).json({ error: 'Link inválido ou desativado.' });
  if (link.mode !== 'edicao') return res.status(403).json({ error: 'Este link é só de leitura -- peça um link de edição pra quem administra o Brindes na Papoi.' });
  const existing = db.get('brindesCatalog').find({ id: req.params.id }).value();
  if (!existing || existing.brand !== link.scopeKey) return res.status(404).json({ error: 'Item não encontrado.' });
  const { nome, estoquePR, estoqueSP, estoquePE } = req.body || {};
  const nomeTrim = (nome || '').trim();
  if (!nomeTrim) return res.status(400).json({ error: 'Informe seu nome antes de salvar -- fica registrado quem atualizou.' });
  const updates = { updatedAt: new Date().toISOString() };
  [['estoquePR', estoquePR], ['estoqueSP', estoqueSP], ['estoquePE', estoquePE]].forEach(([k, v]) => {
    if (v === undefined) return;
    const novo = Number(v) || 0;
    updates[k] = novo;
    if (novo !== (Number(existing[k]) || 0)) {
      updates[k + 'UpdatedAt'] = new Date().toISOString();
      updates[k + 'UpdatedBy'] = null;
      updates[k + 'UpdatedByName'] = `${nomeTrim} (via link externo)`;
    }
  });
  const pr = updates.estoquePR !== undefined ? updates.estoquePR : existing.estoquePR;
  const sp = updates.estoqueSP !== undefined ? updates.estoqueSP : existing.estoqueSP;
  const pe = updates.estoquePE !== undefined ? updates.estoquePE : existing.estoquePE;
  updates.estoqueTotal = sumStock(pr, sp, pe);
  db.get('brindesCatalog').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: { id: null, name: `${nomeTrim} (via link externo)` }, entityType: 'brindeCatalogo', entityId: existing.id, entityLabel: existing.item, action: 'update', details: 'Estoque atualizado por visitante via link externo (modo edição)' });
  res.json({ item: serializeCatalogItem(db.get('brindesCatalog').find({ id: req.params.id }).value()) });
});

router.get('/public-link', requireAuth, requireBrindesEdit, (req, res) => {
  const { brand } = req.query;
  const link = shareLinks.getLink('brindes', brand);
  res.json({ publicToken: link ? link.token : null, mode: link ? link.mode : null });
});
router.post('/public-link/generate', requireAuth, requireBrindesEdit, (req, res) => {
  const { brand, mode } = req.body || {};
  if (!brand) return res.status(400).json({ error: 'Escolha a marca.' });
  const token = shareLinks.generateLink('brindes', brand, req, mode);
  logAudit({ user: req.user, entityType: 'shareLink', entityId: 'brindes:' + brand, entityLabel: 'Brindes · ' + brand, action: 'generate_public_link', details: `Modo: ${mode === 'edicao' ? 'edição' : 'leitura'}` });
  res.json({ publicToken: token });
});
router.delete('/public-link', requireAuth, requireBrindesEdit, (req, res) => {
  const { brand } = req.query;
  shareLinks.revokeLink('brindes', brand);
  logAudit({ user: req.user, entityType: 'shareLink', entityId: 'brindes:' + brand, entityLabel: 'Brindes · ' + brand, action: 'revoke_public_link' });
  res.json({ ok: true });
});

module.exports = router;
