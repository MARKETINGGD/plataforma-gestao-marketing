const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { resolveUserName } = require('../utils/names');
const { parseMoneyLabel } = require('../utils/moneyParse');
const { syncPagamentoParaBudget, removeBudgetEntriesForPagamento, updateBudgetEntriesValorPagamento } = require('../utils/pagamentosBudgetSync');

const router = express.Router();

// 100ª rodada, pedido da Raquel -- novo menu Pagamentos: Controle de
// Assinaturas, Controle de Pagamentos (abas Cartão/Mensal/Extras) e
// Terceirizados. Mesmo padrão de permissão já usado em Brindes/Budget:
// ver em (user.permissions || {}).pagamentos. Visualizar é aberto a
// qualquer pessoa logada; editar exige 'editor' ou 'admin' (ou ser super
// admin da Plataforma).
function canEdit(req) {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  const access = (user.permissions || {}).pagamentos || 'none';
  return access === 'editor' || access === 'admin';
}
function requirePagamentosEdit(req, res, next) {
  if (!canEdit(req)) return res.status(403).json({ error: 'Você não tem permissão para editar Pagamentos.' });
  next();
}

function serialize(row) {
  const out = Object.assign({}, row);
  if (out.createdBy) out.createdByName = resolveUserName(out.createdBy, out.createdByName || '');
  if (out.updatedBy) out.updatedByName = resolveUserName(out.updatedBy, out.updatedByName || '');
  return out;
}

// ========================= CONTROLE DE ASSINATURAS =========================
const assinaturasUploadsRoot = path.join(__dirname, '..', 'data', 'uploads', 'assinaturas');
const assinaturasStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(assinaturasUploadsRoot, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^\w.\-]+/g, '_'))
});
const uploadAssinatura = multer({ storage: assinaturasStorage, limits: { fileSize: 50 * 1024 * 1024 } });

router.get('/assinaturas', requireAuth, (req, res) => {
  const rows = db.get('assinaturas').value().slice().sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  res.json({ canEdit: canEdit(req), items: rows.map(serialize) });
});

router.post('/assinaturas', requireAuth, requirePagamentosEdit, (req, res) => {
  const b = req.body || {};
  if (!b.nome) return res.status(400).json({ error: 'Informe o nome da assinatura.' });
  const money = parseMoneyLabel(b.preco);
  const now = new Date().toISOString();
  const row = {
    id: nanoid(),
    nome: b.nome,
    precoRaw: b.preco || '',
    preco: money.valor,
    moeda: money.moeda,
    tipo: b.tipo || '',
    fluxo: b.fluxo || '',
    pagamento: b.pagamento || '',
    status: b.status || '',
    dataRenovacao: b.dataRenovacao || '',
    observacoes: b.observacoes || '',
    arquivos: [],
    historicalImport: false,
    createdAt: now,
    createdBy: req.user.id,
    createdByName: req.user.name,
    updatedAt: now
  };
  db.get('assinaturas').push(row).write();
  logAudit({ user: req.user, entityType: 'assinatura', entityId: row.id, entityLabel: row.nome, action: 'create' });
  res.json({ item: serialize(row) });
});

router.put('/assinaturas/:id', requireAuth, requirePagamentosEdit, (req, res) => {
  const existing = db.get('assinaturas').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Assinatura não encontrada.' });
  const b = req.body || {};
  const updates = { updatedAt: new Date().toISOString(), updatedBy: req.user.id, updatedByName: req.user.name };
  ['nome', 'tipo', 'fluxo', 'pagamento', 'status', 'dataRenovacao', 'observacoes'].forEach((k) => {
    if (b[k] !== undefined) updates[k] = b[k];
  });
  if (b.preco !== undefined) {
    const money = parseMoneyLabel(b.preco);
    updates.precoRaw = b.preco || '';
    updates.preco = money.valor;
    updates.moeda = money.moeda;
  }
  db.get('assinaturas').find({ id: existing.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'assinatura', entityId: existing.id, entityLabel: updates.nome || existing.nome, action: 'update' });
  res.json({ item: serialize(db.get('assinaturas').find({ id: existing.id }).value()) });
});

router.delete('/assinaturas/:id', requireAuth, requirePagamentosEdit, (req, res) => {
  const existing = db.get('assinaturas').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Assinatura não encontrada.' });
  db.get('assinaturas').remove({ id: req.params.id }).write();
  const dir = path.join(assinaturasUploadsRoot, existing.id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  logAudit({ user: req.user, entityType: 'assinatura', entityId: existing.id, entityLabel: existing.nome, action: 'delete' });
  res.json({ ok: true });
});

router.post('/assinaturas/:id/arquivos', requireAuth, requirePagamentosEdit, uploadAssinatura.array('files', 20), (req, res) => {
  const existing = db.get('assinaturas').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Assinatura não encontrada.' });
  const novos = (req.files || []).map((f) => ({ id: nanoid(), name: f.originalname, url: `/uploads/assinaturas/${existing.id}/${f.filename}` }));
  if (novos.length === 0) return res.status(400).json({ error: 'Selecione ao menos um arquivo.' });
  const arquivos = (existing.arquivos || []).concat(novos);
  db.get('assinaturas').find({ id: existing.id }).assign({ arquivos, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'assinatura', entityId: existing.id, entityLabel: existing.nome, action: 'update', details: `${novos.length} arquivo(s) adicionado(s)` });
  res.json({ item: serialize(db.get('assinaturas').find({ id: existing.id }).value()) });
});

router.delete('/assinaturas/:id/arquivos/:fileId', requireAuth, requirePagamentosEdit, (req, res) => {
  const existing = db.get('assinaturas').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Assinatura não encontrada.' });
  const target = (existing.arquivos || []).find((f) => f.id === req.params.fileId);
  if (!target) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  const arquivos = (existing.arquivos || []).filter((f) => f.id !== req.params.fileId);
  db.get('assinaturas').find({ id: existing.id }).assign({ arquivos, updatedAt: new Date().toISOString() }).write();
  const diskPath = path.join(__dirname, '..', 'data', target.url.replace(/^\//, ''));
  if (fs.existsSync(diskPath)) fs.rmSync(diskPath, { force: true });
  res.json({ item: serialize(db.get('assinaturas').find({ id: existing.id }).value()) });
});

// ========================= CONTROLE DE PAGAMENTOS (Cartão/Mensal/Extras) ====
const ABAS_PAGAMENTO = ['cartao', 'mensal', 'extras'];
const pagamentosUploadsRoot = path.join(__dirname, '..', 'data', 'uploads', 'pagamentos');
const pagamentosStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(pagamentosUploadsRoot, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^\w.\-]+/g, '_'))
});
const uploadPagamento = multer({ storage: pagamentosStorage, limits: { fileSize: 50 * 1024 * 1024 } });

const RECONHECIDAS = { 'de bacco': 'debacco', debacco: 'debacco', ghelplus: 'ghelplus' };
function marcasFromRaw(raw) {
  if (!raw) return [];
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean).map((s) => RECONHECIDAS[s.toLowerCase()] || null);
}

router.get('/pagamentos', requireAuth, (req, res) => {
  const { aba } = req.query;
  let rows = db.get('pagamentos').value();
  if (aba) rows = rows.filter((r) => r.aba === aba);
  rows = rows.slice().sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
  res.json({ canEdit: canEdit(req), items: rows.map(serialize) });
});

function buildPagamentoFromBody(b, aba, user) {
  const now = new Date().toISOString();
  const money = parseMoneyLabel(b.valor);
  return {
    id: nanoid(),
    aba,
    mes: b.mes || '',
    ano: b.ano ? Number(b.ano) : new Date().getFullYear(),
    fornecedor: b.fornecedor || '',
    codigoFornecedor: b.codigoFornecedor || '',
    valorRaw: b.valor || '',
    valor: money.valor,
    moeda: money.moeda,
    tipoPagamento: b.tipoPagamento || '',
    dataPagamento: b.dataPagamento || '',
    status: b.status || '',
    pago: !!b.pago,
    marcaRaw: b.marca || '',
    marcas: marcasFromRaw(b.marca),
    parcela: b.parcela || '',
    dividirFluxo: !!b.dividirFluxo,
    fluxoGerencial: b.fluxoGerencial || '',
    centroCusto: b.centroCusto || '',
    contaContabil: b.contaContabil || '',
    cartao: b.cartao || '',
    emailPara: b.emailPara || '',
    aprovada: !!b.aprovada,
    observacoes: b.observacoes || '',
    arquivos: [],
    historicalImport: false,
    budgetSynced: false,
    budgetEntryIds: [],
    createdAt: now,
    createdBy: user.id,
    createdByName: user.name,
    updatedAt: now
  };
}

router.post('/pagamentos', requireAuth, requirePagamentosEdit, (req, res) => {
  const b = req.body || {};
  const aba = b.aba;
  if (!ABAS_PAGAMENTO.includes(aba)) return res.status(400).json({ error: 'Escolha a aba (cartão, mensal ou extras).' });
  if (!b.fornecedor) return res.status(400).json({ error: 'Informe o fornecedor.' });
  const row = buildPagamentoFromBody(b, aba, req.user);
  db.get('pagamentos').push(row).write();
  logAudit({ user: req.user, entityType: 'pagamento', entityId: row.id, entityLabel: row.fornecedor, action: 'create' });
  if (row.pago) syncPagamentoParaBudget(row, req);
  res.json({ item: serialize(db.get('pagamentos').find({ id: row.id }).value()) });
});

router.put('/pagamentos/:id', requireAuth, requirePagamentosEdit, (req, res) => {
  const existing = db.get('pagamentos').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  const b = req.body || {};
  const updates = { updatedAt: new Date().toISOString(), updatedBy: req.user.id, updatedByName: req.user.name };
  ['mes', 'fornecedor', 'codigoFornecedor', 'tipoPagamento', 'dataPagamento', 'status', 'parcela', 'fluxoGerencial', 'centroCusto', 'contaContabil', 'cartao', 'emailPara', 'observacoes'].forEach((k) => {
    if (b[k] !== undefined) updates[k] = b[k];
  });
  if (b.ano !== undefined) updates.ano = Number(b.ano) || existing.ano;
  if (b.valor !== undefined) {
    const money = parseMoneyLabel(b.valor);
    updates.valorRaw = b.valor || '';
    updates.valor = money.valor;
    updates.moeda = money.moeda;
  }
  if (b.marca !== undefined) {
    updates.marcaRaw = b.marca || '';
    updates.marcas = marcasFromRaw(b.marca);
  }
  if (b.pago !== undefined) updates.pago = !!b.pago;
  if (b.aprovada !== undefined) updates.aprovada = !!b.aprovada;
  if (b.dividirFluxo !== undefined) updates.dividirFluxo = !!b.dividirFluxo;
  // Desmarcar "Pago" de um lançamento que já tinha sido sincronizado com o
  // Budget precisa desfazer o que foi criado lá -- senão o Budget fica com
  // um lançamento "fantasma" (ver utils/pagamentosBudgetSync.js). Detecta
  // ANTES de gravar, com base no estado anterior (`existing`), e já zera
  // budgetSynced/budgetEntryIds no mesmo write pra não deixar o pagamento
  // num estado intermediário inconsistente.
  const desfazendoSync = existing.pago === true && existing.budgetSynced === true && updates.pago === false;
  if (desfazendoSync) {
    updates.budgetSynced = false;
    updates.budgetEntryIds = [];
  }
  // Editar o `valor` de um pagamento que já está sincronizado precisa
  // atualizar o(s) lançamento(s) já criados no Budget (ver
  // utils/pagamentosBudgetSync.js) -- senão eles ficam com o valor antigo
  // pra sempre. Não dispara junto com `desfazendoSync` (nesse caso os
  // lançamentos já estão sendo removidos, não faz sentido atualizar antes).
  const valorMudou = b.valor !== undefined && Number(updates.valor) !== Number(existing.valor);
  const atualizandoValorSincronizado = !desfazendoSync && existing.budgetSynced === true && valorMudou;
  db.get('pagamentos').find({ id: existing.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'pagamento', entityId: existing.id, entityLabel: updates.fornecedor || existing.fornecedor, action: 'update' });
  if (desfazendoSync) removeBudgetEntriesForPagamento(existing, req);
  if (atualizandoValorSincronizado) updateBudgetEntriesValorPagamento(existing, existing.valor, updates.valor, req);
  const atualizado = db.get('pagamentos').find({ id: existing.id }).value();
  // Sincronização com o Budget (100ª rodada) -- só dispara ao marcar "Pago"
  // de um lançamento que ainda não tinha sido sincronizado (ver
  // utils/pagamentosBudgetSync.js pra todas as regras/exclusões).
  if (atualizado.pago && !atualizado.budgetSynced) syncPagamentoParaBudget(atualizado, req);
  res.json({ item: serialize(db.get('pagamentos').find({ id: existing.id }).value()) });
});

router.delete('/pagamentos/:id', requireAuth, requirePagamentosEdit, (req, res) => {
  const existing = db.get('pagamentos').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  db.get('pagamentos').remove({ id: req.params.id }).write();
  const dir = path.join(pagamentosUploadsRoot, existing.id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  logAudit({ user: req.user, entityType: 'pagamento', entityId: existing.id, entityLabel: existing.fornecedor, action: 'delete' });
  res.json({ ok: true });
});

router.post('/pagamentos/:id/arquivos', requireAuth, requirePagamentosEdit, uploadPagamento.array('files', 20), (req, res) => {
  const existing = db.get('pagamentos').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  const novos = (req.files || []).map((f) => ({ id: nanoid(), name: f.originalname, url: `/uploads/pagamentos/${existing.id}/${f.filename}` }));
  if (novos.length === 0) return res.status(400).json({ error: 'Selecione ao menos um arquivo.' });
  const arquivos = (existing.arquivos || []).concat(novos);
  db.get('pagamentos').find({ id: existing.id }).assign({ arquivos, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'pagamento', entityId: existing.id, entityLabel: existing.fornecedor, action: 'update', details: `${novos.length} arquivo(s) adicionado(s)` });
  res.json({ item: serialize(db.get('pagamentos').find({ id: existing.id }).value()) });
});

router.delete('/pagamentos/:id/arquivos/:fileId', requireAuth, requirePagamentosEdit, (req, res) => {
  const existing = db.get('pagamentos').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  const target = (existing.arquivos || []).find((f) => f.id === req.params.fileId);
  if (!target) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  const arquivos = (existing.arquivos || []).filter((f) => f.id !== req.params.fileId);
  db.get('pagamentos').find({ id: existing.id }).assign({ arquivos, updatedAt: new Date().toISOString() }).write();
  const diskPath = path.join(__dirname, '..', 'data', target.url.replace(/^\//, ''));
  if (fs.existsSync(diskPath)) fs.rmSync(diskPath, { force: true });
  res.json({ item: serialize(db.get('pagamentos').find({ id: existing.id }).value()) });
});

// ========================= TERCEIRIZADOS ====================================
// "dentro deve ter a aba documentos necessários - contratos, check list e
// pagamentos, em todos deve ter opção de add arquivos". `checklist` é a
// única das 3 seções que também guarda itens marcáveis (texto + feito),
// além de arquivos -- as outras 2 são só coleções de arquivo.
const SECOES_DOCUMENTO = ['contratos', 'checklist', 'pagamentos'];
const terceirizadosUploadsRoot = path.join(__dirname, '..', 'data', 'uploads', 'terceirizados');
const terceirizadosStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(terceirizadosUploadsRoot, req.params.id, req.params.secao);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^\w.\-]+/g, '_'))
});
const uploadTerceirizado = multer({ storage: terceirizadosStorage, limits: { fileSize: 50 * 1024 * 1024 } });

function emptyDocumentos() {
  return {
    contratos: { files: [] },
    checklist: { items: [], files: [] },
    pagamentos: { files: [] }
  };
}
function serializeTerceirizado(row) {
  const out = serialize(row);
  out.documentos = Object.assign(emptyDocumentos(), row.documentos || {});
  SECOES_DOCUMENTO.forEach((s) => {
    out.documentos[s] = Object.assign({ files: [] }, out.documentos[s]);
    if (s === 'checklist' && !Array.isArray(out.documentos[s].items)) out.documentos[s].items = [];
  });
  return out;
}

router.get('/terceirizados', requireAuth, (req, res) => {
  const rows = db.get('terceirizados').value().slice().sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  res.json({ canEdit: canEdit(req), items: rows.map(serializeTerceirizado) });
});

router.post('/terceirizados', requireAuth, requirePagamentosEdit, (req, res) => {
  const b = req.body || {};
  if (!b.nome) return res.status(400).json({ error: 'Informe o nome do terceirizado.' });
  const now = new Date().toISOString();
  const row = {
    id: nanoid(),
    nome: b.nome,
    observacoes: b.observacoes || '',
    documentos: emptyDocumentos(),
    createdAt: now,
    createdBy: req.user.id,
    createdByName: req.user.name,
    updatedAt: now
  };
  db.get('terceirizados').push(row).write();
  logAudit({ user: req.user, entityType: 'terceirizado', entityId: row.id, entityLabel: row.nome, action: 'create' });
  res.json({ item: serializeTerceirizado(row) });
});

router.put('/terceirizados/:id', requireAuth, requirePagamentosEdit, (req, res) => {
  const existing = db.get('terceirizados').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Terceirizado não encontrado.' });
  const b = req.body || {};
  const updates = { updatedAt: new Date().toISOString(), updatedBy: req.user.id, updatedByName: req.user.name };
  if (b.nome !== undefined) updates.nome = b.nome;
  if (b.observacoes !== undefined) updates.observacoes = b.observacoes;
  db.get('terceirizados').find({ id: existing.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'terceirizado', entityId: existing.id, entityLabel: updates.nome || existing.nome, action: 'update' });
  res.json({ item: serializeTerceirizado(db.get('terceirizados').find({ id: existing.id }).value()) });
});

router.delete('/terceirizados/:id', requireAuth, requirePagamentosEdit, (req, res) => {
  const existing = db.get('terceirizados').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Terceirizado não encontrado.' });
  db.get('terceirizados').remove({ id: req.params.id }).write();
  const dir = path.join(terceirizadosUploadsRoot, existing.id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  logAudit({ user: req.user, entityType: 'terceirizado', entityId: existing.id, entityLabel: existing.nome, action: 'delete' });
  res.json({ ok: true });
});

// ---- checklist (seção "checklist" de documentos necessários) ----
router.post('/terceirizados/:id/checklist', requireAuth, requirePagamentosEdit, (req, res) => {
  const existing = db.get('terceirizados').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Terceirizado não encontrado.' });
  const text = (req.body && req.body.text) || '';
  if (!text.trim()) return res.status(400).json({ error: 'Informe o texto do item.' });
  const documentos = Object.assign(emptyDocumentos(), existing.documentos || {});
  documentos.checklist = Object.assign({ files: [] }, documentos.checklist, { items: (documentos.checklist && documentos.checklist.items) || [] });
  documentos.checklist.items = documentos.checklist.items.concat([{ id: nanoid(), text: text.trim(), done: false }]);
  db.get('terceirizados').find({ id: existing.id }).assign({ documentos, updatedAt: new Date().toISOString() }).write();
  res.json({ item: serializeTerceirizado(db.get('terceirizados').find({ id: existing.id }).value()) });
});

router.put('/terceirizados/:id/checklist/:itemId', requireAuth, requirePagamentosEdit, (req, res) => {
  const existing = db.get('terceirizados').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Terceirizado não encontrado.' });
  const documentos = Object.assign(emptyDocumentos(), existing.documentos || {});
  const items = ((documentos.checklist && documentos.checklist.items) || []).map((it) => {
    if (it.id !== req.params.itemId) return it;
    const updated = Object.assign({}, it);
    if (req.body.text !== undefined) updated.text = req.body.text;
    if (req.body.done !== undefined) updated.done = !!req.body.done;
    return updated;
  });
  documentos.checklist = Object.assign({ files: [] }, documentos.checklist, { items });
  db.get('terceirizados').find({ id: existing.id }).assign({ documentos, updatedAt: new Date().toISOString() }).write();
  res.json({ item: serializeTerceirizado(db.get('terceirizados').find({ id: existing.id }).value()) });
});

router.delete('/terceirizados/:id/checklist/:itemId', requireAuth, requirePagamentosEdit, (req, res) => {
  const existing = db.get('terceirizados').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Terceirizado não encontrado.' });
  const documentos = Object.assign(emptyDocumentos(), existing.documentos || {});
  const items = ((documentos.checklist && documentos.checklist.items) || []).filter((it) => it.id !== req.params.itemId);
  documentos.checklist = Object.assign({ files: [] }, documentos.checklist, { items });
  db.get('terceirizados').find({ id: existing.id }).assign({ documentos, updatedAt: new Date().toISOString() }).write();
  res.json({ item: serializeTerceirizado(db.get('terceirizados').find({ id: existing.id }).value()) });
});

// ---- arquivos (qualquer das 3 seções: contratos, checklist, pagamentos) ----
router.post('/terceirizados/:id/documentos/:secao/arquivos', requireAuth, requirePagamentosEdit, (req, res, next) => {
  if (!SECOES_DOCUMENTO.includes(req.params.secao)) return res.status(400).json({ error: 'Seção inválida.' });
  next();
}, uploadTerceirizado.array('files', 20), (req, res) => {
  const existing = db.get('terceirizados').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Terceirizado não encontrado.' });
  const secao = req.params.secao;
  const novos = (req.files || []).map((f) => ({ id: nanoid(), name: f.originalname, url: `/uploads/terceirizados/${existing.id}/${secao}/${f.filename}` }));
  if (novos.length === 0) return res.status(400).json({ error: 'Selecione ao menos um arquivo.' });
  const documentos = Object.assign(emptyDocumentos(), existing.documentos || {});
  documentos[secao] = Object.assign({ files: [] }, documentos[secao]);
  documentos[secao].files = (documentos[secao].files || []).concat(novos);
  db.get('terceirizados').find({ id: existing.id }).assign({ documentos, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'terceirizado', entityId: existing.id, entityLabel: existing.nome, action: 'update', details: `${novos.length} arquivo(s) adicionado(s) em ${secao}` });
  res.json({ item: serializeTerceirizado(db.get('terceirizados').find({ id: existing.id }).value()) });
});

router.delete('/terceirizados/:id/documentos/:secao/arquivos/:fileId', requireAuth, requirePagamentosEdit, (req, res) => {
  if (!SECOES_DOCUMENTO.includes(req.params.secao)) return res.status(400).json({ error: 'Seção inválida.' });
  const existing = db.get('terceirizados').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Terceirizado não encontrado.' });
  const secao = req.params.secao;
  const documentos = Object.assign(emptyDocumentos(), existing.documentos || {});
  const files = (documentos[secao] && documentos[secao].files) || [];
  const target = files.find((f) => f.id === req.params.fileId);
  if (!target) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  documentos[secao] = Object.assign({ files: [] }, documentos[secao], { files: files.filter((f) => f.id !== req.params.fileId) });
  db.get('terceirizados').find({ id: existing.id }).assign({ documentos, updatedAt: new Date().toISOString() }).write();
  const diskPath = path.join(__dirname, '..', 'data', target.url.replace(/^\//, ''));
  if (fs.existsSync(diskPath)) fs.rmSync(diskPath, { force: true });
  res.json({ item: serializeTerceirizado(db.get('terceirizados').find({ id: existing.id }).value()) });
});

router.canEdit = canEdit;
module.exports = router;
