const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// Produtos (33ª rodada, pedido da Raquel: "no botão produtos deve ter um sub
// menu com: análise de concorrência, lançamentos de produtos"). Duas listas
// independentes, cada uma dividida por marca (De Bacco / GhelPlus), mesmo
// padrão de acesso já usado em Brindes/Expositores: qualquer pessoa logada
// pode VER, só quem tem permissão "produtos" = editor/admin (ou é admin da
// plataforma) pode criar/editar/excluir — permissão configurada na tela de
// Usuários (a chave 'produtos' já existia em PERMISSION_KEYS antes desta
// rodada, só não tinha nenhuma tela usando ela ainda).
//
// 39ª rodada, pedido da Raquel: as duas telas ganharam campos novos.
//
// Análise de Concorrência agora compara lado a lado o produto do
// concorrente COM o produto equivalente da nossa marca: além dos campos
// que já existiam do lado do concorrente (concorrente, produto, preço,
// observações, link), ganhou "diferenciais"; e ganhou um segundo grupo de
// campos inteiro, espelhado, pro nosso produto equivalente (produto,
// preço, diferenciais, observações, link) — prefixo `nosso*`/`nossa*` pra
// diferenciar dos campos do concorrente sem precisar de objeto aninhado.
//
// Lançamentos de Produtos ganhou "produto" (categoria/tipo, junto do nome
// específico que já existia), "código", "diferenciais" e "arquivos"
// (upload, mesmo padrão de Demandas: um arquivo por vez, guardado em
// `data/uploads/lancamentos/:id/`). O status trocou de
// planejado/em_andamento/lançado pra um fluxo mais realista de lançamento
// de produto físico: certificação → compra → fiscal → liberado (pedido
// explícito da Raquel). Lançamento cadastrado ANTES desta rodada, com um
// status do conjunto antigo, mantém esse valor salvo (não é migrado
// automaticamente) — só não vai bater com nenhuma das 4 opções novas do
// formulário até alguém abrir e salvar de novo escolhendo um status atual.

const BRANDS = ['debacco', 'ghelplus'];
const LANCAMENTO_STATUSES = ['certificacao', 'compra', 'fiscal', 'liberado'];

function canEdit(req) {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  const access = (user.permissions || {}).produtos || 'none';
  return access === 'editor' || access === 'admin';
}
function requireProdutosEdit(req, res, next) {
  if (!canEdit(req)) return res.status(403).json({ error: 'Você não tem permissão para editar Produtos.' });
  next();
}
function validBrand(b) {
  return BRANDS.includes(b) ? b : BRANDS[0];
}
function str(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}
function priceOrNull(v) {
  return v === null || v === undefined || v === '' ? null : Number(v);
}

// ---------- Análise de concorrência ----------
router.get('/concorrencia', requireAuth, (req, res) => {
  res.json({ items: db.get('concorrencia').value() });
});

router.post('/concorrencia', requireAuth, requireProdutosEdit, (req, res) => {
  const {
    brand, concorrente, produto, preco, diferenciais, link, observacoes,
    nossoProduto, nossoPreco, nossoDiferenciais, nossoLink, nossasObservacoes
  } = req.body || {};
  const nome = str(concorrente);
  if (!nome) return res.status(400).json({ error: 'Informe o nome do concorrente.' });
  const item = {
    id: nanoid(),
    brand: validBrand(brand),
    // ---- lado do concorrente ----
    concorrente: nome,
    produto: str(produto),
    preco: priceOrNull(preco),
    diferenciais: str(diferenciais),
    observacoes: str(observacoes),
    link: str(link) || null,
    // ---- lado "nossa marca" (39ª rodada) — mesmos campos, espelhados ----
    nossoProduto: str(nossoProduto),
    nossoPreco: priceOrNull(nossoPreco),
    nossoDiferenciais: str(nossoDiferenciais),
    nossasObservacoes: str(nossasObservacoes),
    nossoLink: str(nossoLink) || null,
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    updatedAt: new Date().toISOString()
  };
  db.get('concorrencia').push(item).write();
  logAudit({ user: req.user, entityType: 'concorrencia', entityId: item.id, entityLabel: item.concorrente, action: 'create', details: `Análise de concorrência criada: "${item.concorrente}"` });
  res.json({ item });
});

router.put('/concorrencia/:id', requireAuth, requireProdutosEdit, (req, res) => {
  const existing = db.get('concorrencia').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Registro não encontrado.' });
  const {
    brand, concorrente, produto, preco, diferenciais, link, observacoes,
    nossoProduto, nossoPreco, nossoDiferenciais, nossoLink, nossasObservacoes
  } = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  if (brand !== undefined) updates.brand = validBrand(brand);
  if (concorrente !== undefined) updates.concorrente = str(concorrente);
  if (produto !== undefined) updates.produto = str(produto);
  if (preco !== undefined) updates.preco = priceOrNull(preco);
  if (diferenciais !== undefined) updates.diferenciais = str(diferenciais);
  if (link !== undefined) updates.link = str(link) || null;
  if (observacoes !== undefined) updates.observacoes = str(observacoes);
  if (nossoProduto !== undefined) updates.nossoProduto = str(nossoProduto);
  if (nossoPreco !== undefined) updates.nossoPreco = priceOrNull(nossoPreco);
  if (nossoDiferenciais !== undefined) updates.nossoDiferenciais = str(nossoDiferenciais);
  if (nossoLink !== undefined) updates.nossoLink = str(nossoLink) || null;
  if (nossasObservacoes !== undefined) updates.nossasObservacoes = str(nossasObservacoes);
  db.get('concorrencia').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'concorrencia', entityId: existing.id, entityLabel: updates.concorrente || existing.concorrente, action: 'update', details: 'Análise de concorrência atualizada' });
  res.json({ item: db.get('concorrencia').find({ id: req.params.id }).value() });
});

router.delete('/concorrencia/:id', requireAuth, requireProdutosEdit, (req, res) => {
  const target = db.get('concorrencia').find({ id: req.params.id }).value();
  db.get('concorrencia').remove({ id: req.params.id }).write();
  if (target) logAudit({ user: req.user, entityType: 'concorrencia', entityId: target.id, entityLabel: target.concorrente, action: 'delete', details: `Análise de concorrência excluída: "${target.concorrente}"` });
  res.json({ ok: true });
});

// ---------- Lançamentos de produtos ----------
router.get('/lancamentos', requireAuth, (req, res) => {
  res.json({ items: db.get('lancamentosProdutos').value() });
});

router.post('/lancamentos', requireAuth, requireProdutosEdit, (req, res) => {
  const { brand, produto, nome, codigo, diferenciais, dataLancamento, status, descricao } = req.body || {};
  const nomeTrim = str(nome);
  if (!nomeTrim) return res.status(400).json({ error: 'Informe o nome do produto.' });
  const item = {
    id: nanoid(),
    brand: validBrand(brand),
    produto: str(produto),
    nome: nomeTrim,
    codigo: str(codigo),
    diferenciais: str(diferenciais),
    dataLancamento: dataLancamento || null,
    status: LANCAMENTO_STATUSES.includes(status) ? status : LANCAMENTO_STATUSES[0],
    descricao: str(descricao),
    arquivos: [],
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    updatedAt: new Date().toISOString()
  };
  db.get('lancamentosProdutos').push(item).write();
  logAudit({ user: req.user, entityType: 'lancamentoProduto', entityId: item.id, entityLabel: item.nome, action: 'create', details: `Lançamento de produto criado: "${item.nome}"` });
  res.json({ item });
});

router.put('/lancamentos/:id', requireAuth, requireProdutosEdit, (req, res) => {
  const existing = db.get('lancamentosProdutos').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  const { brand, produto, nome, codigo, diferenciais, dataLancamento, status, descricao } = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  if (brand !== undefined) updates.brand = validBrand(brand);
  if (produto !== undefined) updates.produto = str(produto);
  if (nome !== undefined) updates.nome = str(nome);
  if (codigo !== undefined) updates.codigo = str(codigo);
  if (diferenciais !== undefined) updates.diferenciais = str(diferenciais);
  if (dataLancamento !== undefined) updates.dataLancamento = dataLancamento || null;
  if (status !== undefined) updates.status = LANCAMENTO_STATUSES.includes(status) ? status : existing.status;
  if (descricao !== undefined) updates.descricao = str(descricao);
  db.get('lancamentosProdutos').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'lancamentoProduto', entityId: existing.id, entityLabel: updates.nome || existing.nome, action: 'update', details: 'Lançamento de produto atualizado' });
  res.json({ item: db.get('lancamentosProdutos').find({ id: req.params.id }).value() });
});

router.delete('/lancamentos/:id', requireAuth, requireProdutosEdit, (req, res) => {
  const target = db.get('lancamentosProdutos').find({ id: req.params.id }).value();
  db.get('lancamentosProdutos').remove({ id: req.params.id }).write();
  if (target) {
    const dir = path.join(__dirname, '..', 'data', 'uploads', 'lancamentos', req.params.id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    logAudit({ user: req.user, entityType: 'lancamentoProduto', entityId: target.id, entityLabel: target.nome, action: 'delete', details: `Lançamento de produto excluído: "${target.nome}"` });
  }
  res.json({ ok: true });
});

// ---------- Arquivos do lançamento (39ª rodada) ----------
// Mesmo padrão já usado em Demandas: um arquivo por vez, guardado em
// data/uploads/lancamentos/:id/, com metadados (nome, tamanho, quem
// enviou) na própria lista `arquivos` do lançamento.
const lancamentosUploadsRoot = path.join(__dirname, '..', 'data', 'uploads', 'lancamentos');
const lancamentosStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(lancamentosUploadsRoot, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, Date.now() + '-' + safe);
  }
});
const uploadLancamento = multer({ storage: lancamentosStorage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB

router.post('/lancamentos/:id/files', requireAuth, requireProdutosEdit, uploadLancamento.single('file'), (req, res) => {
  const existing = db.get('lancamentosProdutos').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
  const fileMeta = {
    id: nanoid(),
    name: req.file.originalname,
    url: `/uploads/lancamentos/${req.params.id}/${req.file.filename}`,
    size: req.file.size,
    uploadedAt: new Date().toISOString(),
    uploadedBy: req.user.id,
    uploadedByName: req.user.name
  };
  const arquivos = [...(existing.arquivos || []), fileMeta];
  db.get('lancamentosProdutos').find({ id: req.params.id }).assign({ arquivos, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'lancamentoProduto', entityId: existing.id, entityLabel: existing.nome, action: 'file_upload', details: `Arquivo enviado: ${fileMeta.name}` });
  res.json({ item: db.get('lancamentosProdutos').find({ id: req.params.id }).value() });
});

router.delete('/lancamentos/:id/files/:fileId', requireAuth, requireProdutosEdit, (req, res) => {
  const existing = db.get('lancamentosProdutos').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  const target = (existing.arquivos || []).find((f) => f.id === req.params.fileId);
  const arquivos = (existing.arquivos || []).filter((f) => f.id !== req.params.fileId);
  db.get('lancamentosProdutos').find({ id: req.params.id }).assign({ arquivos, updatedAt: new Date().toISOString() }).write();
  if (target) {
    const filePath = path.join(lancamentosUploadsRoot, req.params.id, path.basename(target.url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    logAudit({ user: req.user, entityType: 'lancamentoProduto', entityId: existing.id, entityLabel: existing.nome, action: 'file_delete', details: `Arquivo removido: ${target.name}` });
  }
  res.json({ item: db.get('lancamentosProdutos').find({ id: req.params.id }).value() });
});

module.exports = router;
