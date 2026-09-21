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

// Campanha Cooperada (43ª rodada, pedido da Raquel: "adicione no menu o
// botão campanha cooperada, logo abaixo de brindes") — cadastro de
// campanhas cooperadas com cliente/representante, separado por marca (De
// Bacco / GhelPlus), mesmo padrão de tela (abas por marca + botão-pai
// próprio, sem submenu — igual a Feiras) e de permissão (qualquer pessoa
// logada pode VER, só quem tem a permissão "campanhaCooperada" =
// editor/admin, ou é admin da plataforma, pode criar/editar/excluir) já
// usado no resto da Plataforma.
//
// Campos pedidos, todos num registro só (sem itens aninhados, diferente de
// Feiras): cliente, representante, produto, quantidade, motivo, orçamento
// (um documento anexo — igual ao padrão de arquivo já usado em
// Lançamentos de Produtos, só que 1 arquivo por campanha em vez de vários:
// um novo upload substitui o anterior), aprovado (sim/não), data do
// pedido, data da entrega, cobrança enviada (sim/não) e finalizado
// (sim/não).
function canEdit(req) {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  const access = (user.permissions || {}).campanhaCooperada || 'none';
  return access === 'editor' || access === 'admin';
}
function requireEdit(req, res, next) {
  if (!canEdit(req)) return res.status(403).json({ error: 'Você não tem permissão para editar Campanha Cooperada.' });
  next();
}

const BRANDS = ['debacco', 'ghelplus'];
function validBrand(brand) {
  return BRANDS.includes(brand) ? brand : null;
}
function str(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}
function toBool(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}
function toQuantidade(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
function toDate(v) {
  return v ? String(v) : null;
}
// Gerente responsável (44ª rodada, pedido da Raquel): select com a lista de
// usuários da equipe, mesmo padrão já usado em "responsável" de outras
// telas (ex.: responsável por item de checklist em Demandas) — só aceita
// um id que exista de verdade em `users`, senão vira `null` (sem gerente
// responsável), em vez de dar erro.
function validUserId(id) {
  if (!id) return null;
  return db.get('users').find({ id }).value() ? id : null;
}
function serialize(r) {
  return Object.assign({}, r, {
    responsavelId: r.responsavelId || null,
    responsavelNome: resolveUserName(r.responsavelId, '')
  });
}

router.get('/', requireAuth, (req, res) => {
  const { brand } = req.query;
  let rows = db.get('campanhasCooperadas').value();
  if (brand && brand !== 'todos') rows = rows.filter((r) => r.brand === brand);
  rows = rows.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ items: rows.map(serialize) });
});

router.post('/', requireAuth, requireEdit, (req, res) => {
  const b = req.body || {};
  const brand = validBrand(b.brand);
  if (!brand) return res.status(400).json({ error: 'Escolha a marca.' });
  const cliente = str(b.cliente);
  if (!cliente) return res.status(400).json({ error: 'Informe o cliente.' });
  const row = {
    id: nanoid(),
    brand,
    cliente,
    representante: str(b.representante),
    produto: str(b.produto),
    responsavelId: validUserId(b.responsavelId),
    quantidade: toQuantidade(b.quantidade),
    motivo: str(b.motivo),
    orcamento: null,
    aprovado: toBool(b.aprovado),
    dataPedido: toDate(b.dataPedido),
    dataEntrega: toDate(b.dataEntrega),
    cobrancaEnviada: toBool(b.cobrancaEnviada),
    finalizado: toBool(b.finalizado),
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    createdByName: req.user.name,
    updatedAt: new Date().toISOString()
  };
  db.get('campanhasCooperadas').push(row).write();
  logAudit({ user: req.user, entityType: 'campanhaCooperada', entityId: row.id, entityLabel: `${row.cliente}${row.produto ? ' · ' + row.produto : ''}`, action: 'create' });
  res.json({ item: serialize(row) });
});

router.put('/:id', requireAuth, requireEdit, (req, res) => {
  const existing = db.get('campanhasCooperadas').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Campanha não encontrada.' });
  const b = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  if (b.brand !== undefined) {
    const brand = validBrand(b.brand);
    if (brand) updates.brand = brand;
  }
  if (b.cliente !== undefined) {
    const cliente = str(b.cliente);
    if (!cliente) return res.status(400).json({ error: 'Informe o cliente.' });
    updates.cliente = cliente;
  }
  if (b.representante !== undefined) updates.representante = str(b.representante);
  if (b.produto !== undefined) updates.produto = str(b.produto);
  if (b.responsavelId !== undefined) updates.responsavelId = validUserId(b.responsavelId);
  if (b.quantidade !== undefined) updates.quantidade = toQuantidade(b.quantidade);
  if (b.motivo !== undefined) updates.motivo = str(b.motivo);
  if (b.aprovado !== undefined) updates.aprovado = toBool(b.aprovado);
  if (b.dataPedido !== undefined) updates.dataPedido = toDate(b.dataPedido);
  if (b.dataEntrega !== undefined) updates.dataEntrega = toDate(b.dataEntrega);
  if (b.cobrancaEnviada !== undefined) updates.cobrancaEnviada = toBool(b.cobrancaEnviada);
  if (b.finalizado !== undefined) updates.finalizado = toBool(b.finalizado);
  db.get('campanhasCooperadas').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'campanhaCooperada', entityId: existing.id, entityLabel: updates.cliente || existing.cliente, action: 'update' });
  res.json({ item: serialize(db.get('campanhasCooperadas').find({ id: req.params.id }).value()) });
});

router.delete('/:id', requireAuth, requireEdit, (req, res) => {
  const existing = db.get('campanhasCooperadas').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Campanha não encontrada.' });
  db.get('campanhasCooperadas').remove({ id: req.params.id }).write();
  const dir = path.join(__dirname, '..', 'data', 'uploads', 'campanhas-cooperadas', req.params.id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  logAudit({ user: req.user, entityType: 'campanhaCooperada', entityId: existing.id, entityLabel: existing.cliente, action: 'delete', details: `Campanha cooperada excluída: "${existing.cliente}"` });
  res.json({ ok: true });
});

// ---------- Orçamento (documento anexo) ----------
// Mesmo padrão de upload já usado em Lançamentos de Produtos, só que aqui é
// SEMPRE 1 arquivo só por campanha ("orçamento (um doc)", pedido da
// Raquel) — um novo upload substitui o anterior (o arquivo físico antigo
// fica no disco, só o ponteiro em `orcamento` passa a apontar pro novo,
// mesmo comportamento já usado na foto de grupo do Chat, 42ª rodada).
const orcamentosUploadsRoot = path.join(__dirname, '..', 'data', 'uploads', 'campanhas-cooperadas');
const orcamentoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(orcamentosUploadsRoot, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, Date.now() + '-' + safe);
  }
});
const uploadOrcamento = multer({ storage: orcamentoStorage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB

router.post('/:id/orcamento', requireAuth, requireEdit, uploadOrcamento.single('file'), (req, res) => {
  const existing = db.get('campanhasCooperadas').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Campanha não encontrada.' });
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
  const fileMeta = {
    id: nanoid(),
    name: req.file.originalname,
    url: `/uploads/campanhas-cooperadas/${req.params.id}/${req.file.filename}`,
    size: req.file.size,
    uploadedAt: new Date().toISOString(),
    uploadedBy: req.user.id,
    uploadedByName: req.user.name
  };
  db.get('campanhasCooperadas').find({ id: req.params.id }).assign({ orcamento: fileMeta, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'campanhaCooperada', entityId: existing.id, entityLabel: existing.cliente, action: 'file_upload', details: `Orçamento enviado: ${fileMeta.name}` });
  res.json({ item: serialize(db.get('campanhasCooperadas').find({ id: req.params.id }).value()) });
});

router.delete('/:id/orcamento', requireAuth, requireEdit, (req, res) => {
  const existing = db.get('campanhasCooperadas').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Campanha não encontrada.' });
  if (existing.orcamento) {
    const filePath = path.join(orcamentosUploadsRoot, req.params.id, path.basename(existing.orcamento.url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    logAudit({ user: req.user, entityType: 'campanhaCooperada', entityId: existing.id, entityLabel: existing.cliente, action: 'file_delete', details: `Orçamento removido: ${existing.orcamento.name}` });
  }
  db.get('campanhasCooperadas').find({ id: req.params.id }).assign({ orcamento: null, updatedAt: new Date().toISOString() }).write();
  res.json({ item: serialize(db.get('campanhasCooperadas').find({ id: req.params.id }).value()) });
});

module.exports = router;
