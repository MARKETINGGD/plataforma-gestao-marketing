const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// Gerenciamento de Influencers (14ª rodada) — dividido por marca (De Bacco /
// GhelPlus). Cada influencer tem sua própria "tabela" (posts), no formato da
// planilha de referência que a Raquel mandou: Formato de conteúdo, Rede,
// Status, Data da postagem, Arquivo, Observações e um segundo campo de notas.
// Qualquer pessoa logada pode usar — mesmo padrão de acesso aberto já usado
// em Demandas (não tem permissão por usuário aqui).

const BRANDS = ['debacco', 'ghelplus'];
const REDES = ['instagram', 'tiktok', 'youtube', 'facebook', 'pinterest'];
const STATUSES = ['a_publicar', 'publicada', 'cancelada'];

function validColor() { return null; } // reservado — sem cor por enquanto

// Dados pessoais + contrato (21ª rodada, pedido da Raquel: "na hora de
// cadastrar a influencer, temos que colocar os dados dela, dados pessoais,
// contrato (em arquivo)"). Tudo opcional — influencers já cadastrados antes
// dessa rodada simplesmente não têm esses campos preenchidos ainda (nunca
// apagar o que já existe, só passa a dar espaço pra completar).
function personalFields(body) {
  const out = {};
  ['cpf', 'rg', 'telefone', 'email', 'dataNascimento', 'endereco'].forEach((key) => {
    if (body[key] !== undefined) out[key] = (body[key] || '').toString().trim();
  });
  return out;
}

function serializeInfluencer(inf) {
  return {
    id: inf.id,
    brand: inf.brand,
    name: inf.name,
    cpf: inf.cpf || '',
    rg: inf.rg || '',
    telefone: inf.telefone || '',
    email: inf.email || '',
    dataNascimento: inf.dataNascimento || '',
    endereco: inf.endereco || '',
    contrato: inf.contrato || null,
    createdAt: inf.createdAt,
    hasPublicLink: !!inf.publicToken
  };
}

function findInfluencerOr404(req, res) {
  const inf = db.get('influencers').find({ id: req.params.id }).value();
  if (!inf) {
    res.status(404).json({ error: 'Influencer não encontrado.' });
    return null;
  }
  return inf;
}

router.get('/meta', requireAuth, (req, res) => {
  res.json({ brands: BRANDS, redes: REDES, statuses: STATUSES });
});

// Versão do influencer pro link externo (sem login) — só nome e marca, sem
// dados pessoais nem contrato (21ª rodada). Esse link é pensado pra
// compartilhar a tabela de postagens com quem não está na Plataforma; os
// dados pessoais/contrato adicionados nessa rodada são sensíveis e não
// devem vazar por um link que qualquer um com a URL consegue abrir.
function serializeInfluencerPublic(inf) {
  return {
    id: inf.id,
    brand: inf.brand,
    name: inf.name,
    createdAt: inf.createdAt
  };
}

// Link externo por influencer — página pública, sem login, acessada com o
// token no lugar do id (ninguém de fora da plataforma sabe o id interno).
// Fica ANTES de tudo que exige login, pra não passar pela tela de login.
router.get('/public/:token', (req, res) => {
  const inf = db.get('influencers').find({ publicToken: req.params.token }).value();
  if (!inf) return res.status(404).json({ error: 'Link inválido ou desativado.' });
  const posts = db.get('influencerPosts').filter({ influencerId: inf.id }).value();
  res.json({ influencer: serializeInfluencerPublic(inf), posts });
});

// Lista influencers de uma marca
router.get('/', requireAuth, (req, res) => {
  const brand = BRANDS.includes(req.query.brand) ? req.query.brand : null;
  let list = db.get('influencers').value();
  if (brand) list = list.filter((i) => i.brand === brand);
  res.json({ influencers: list.map(serializeInfluencer) });
});

router.post('/', requireAuth, (req, res) => {
  const { brand, name } = req.body || {};
  if (!BRANDS.includes(brand)) return res.status(400).json({ error: 'Marca inválida.' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Informe o nome do influencer.' });
  const inf = Object.assign({
    id: nanoid(),
    brand,
    name: name.trim(),
    publicToken: null,
    contrato: null,
    createdAt: new Date().toISOString(),
    createdBy: req.user.id
  }, personalFields(req.body || {}));
  db.get('influencers').push(inf).write();
  logAudit({ user: req.user, entityType: 'influencer', entityId: inf.id, entityLabel: inf.name, action: 'create' });
  res.json({ influencer: serializeInfluencer(inf) });
});

router.put('/:id', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  const { name } = req.body || {};
  const updates = Object.assign({}, personalFields(req.body || {}));
  if (name && name.trim()) updates.name = name.trim();
  db.get('influencers').find({ id: inf.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'influencer', entityId: inf.id, entityLabel: updates.name || inf.name, action: 'update' });
  res.json({ influencer: serializeInfluencer(db.get('influencers').find({ id: inf.id }).value()) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  db.get('influencerPosts').remove({ influencerId: inf.id }).write();
  db.get('influencers').remove({ id: inf.id }).write();
  const dir = path.join(__dirname, '..', 'data', 'uploads', 'influencers', inf.id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  logAudit({ user: req.user, entityType: 'influencer', entityId: inf.id, entityLabel: inf.name, action: 'delete' });
  res.json({ ok: true });
});

// ---------- link externo (por influencer) ----------
router.get('/:id/public-link', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  res.json({ publicToken: inf.publicToken || null });
});

router.post('/:id/public-link/generate', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  const token = crypto.randomBytes(20).toString('hex');
  db.get('influencers').find({ id: inf.id }).assign({ publicToken: token }).write();
  logAudit({ user: req.user, entityType: 'influencer', entityId: inf.id, entityLabel: inf.name, action: 'generate_public_link' });
  res.json({ publicToken: token });
});

router.delete('/:id/public-link', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  db.get('influencers').find({ id: inf.id }).assign({ publicToken: null }).write();
  logAudit({ user: req.user, entityType: 'influencer', entityId: inf.id, entityLabel: inf.name, action: 'revoke_public_link' });
  res.json({ ok: true });
});

// ---------- tabela (posts) do influencer ----------
router.get('/:id', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  const posts = db.get('influencerPosts').filter({ influencerId: inf.id }).value();
  res.json({ influencer: serializeInfluencer(inf), posts });
});

router.post('/:id/posts', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  const { formato, rede, status, dataPostagem, observacoes, notas } = req.body || {};
  const post = {
    id: nanoid(),
    influencerId: inf.id,
    formato: (formato || '').trim(),
    rede: REDES.includes(rede) ? rede : null,
    status: STATUSES.includes(status) ? status : 'a_publicar',
    dataPostagem: dataPostagem || null,
    arquivo: null,
    observacoes: (observacoes || '').trim(),
    notas: (notas || '').trim(),
    createdAt: new Date().toISOString()
  };
  db.get('influencerPosts').push(post).write();
  logAudit({ user: req.user, entityType: 'influencerPost', entityId: post.id, entityLabel: `${inf.name} · ${post.formato}`, action: 'create' });
  res.json({ post });
});

router.put('/:id/posts/:postId', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  const post = db.get('influencerPosts').find({ id: req.params.postId, influencerId: inf.id }).value();
  if (!post) return res.status(404).json({ error: 'Item não encontrado.' });
  const { formato, rede, status, dataPostagem, observacoes, notas } = req.body || {};
  const updates = {};
  if (formato !== undefined) updates.formato = (formato || '').trim();
  if (rede !== undefined) updates.rede = REDES.includes(rede) ? rede : null;
  if (status !== undefined) updates.status = STATUSES.includes(status) ? status : post.status;
  if (dataPostagem !== undefined) updates.dataPostagem = dataPostagem || null;
  if (observacoes !== undefined) updates.observacoes = (observacoes || '').trim();
  if (notas !== undefined) updates.notas = (notas || '').trim();
  db.get('influencerPosts').find({ id: post.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'influencerPost', entityId: post.id, entityLabel: `${inf.name} · ${updates.formato || post.formato}`, action: 'update' });
  res.json({ post: db.get('influencerPosts').find({ id: post.id }).value() });
});

router.delete('/:id/posts/:postId', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  const post = db.get('influencerPosts').find({ id: req.params.postId, influencerId: inf.id }).value();
  if (!post) return res.status(404).json({ error: 'Item não encontrado.' });
  if (post.arquivo && post.arquivo.url) {
    const filePath = path.join(__dirname, '..', 'data', 'uploads', 'influencers', inf.id, path.basename(post.arquivo.url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  db.get('influencerPosts').remove({ id: post.id }).write();
  logAudit({ user: req.user, entityType: 'influencerPost', entityId: post.id, entityLabel: `${inf.name} · ${post.formato}`, action: 'delete' });
  res.json({ ok: true });
});

// ---------- upload do arquivo (por item da tabela) ----------
const uploadsRoot = path.join(__dirname, '..', 'data', 'uploads', 'influencers');
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
const upload = multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB, mesmo limite de Demandas

router.post('/:id/posts/:postId/file', requireAuth, upload.single('file'), (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  const post = db.get('influencerPosts').find({ id: req.params.postId, influencerId: inf.id }).value();
  if (!post) return res.status(404).json({ error: 'Item não encontrado.' });
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  const arquivo = {
    url: `/uploads/influencers/${inf.id}/${req.file.filename}`,
    name: req.file.originalname,
    uploadedAt: new Date().toISOString()
  };
  db.get('influencerPosts').find({ id: post.id }).assign({ arquivo }).write();
  logAudit({ user: req.user, entityType: 'influencerPost', entityId: post.id, entityLabel: `${inf.name} · arquivo`, action: 'update', details: `Arquivo enviado: ${arquivo.name}` });
  res.json({ post: db.get('influencerPosts').find({ id: post.id }).value() });
});

// ---------- contrato do influencer (21ª rodada) ----------
// Pasta separada (uploadsRoot/<id>/contrato/) pra não se misturar com os
// arquivos dos itens da tabela, que ficam direto em uploadsRoot/<id>/.
const contractStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsRoot, req.params.id, 'contrato');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, Date.now() + '-' + safe);
  }
});
// 25MB é de sobra pra um contrato em PDF/imagem escaneada — bem menor que
// o limite de 1GB dos arquivos de post (pensado pra vídeo/criativo).
const uploadContract = multer({ storage: contractStorage, limits: { fileSize: 25 * 1024 * 1024 } });

router.post('/:id/contract', requireAuth, uploadContract.single('contract'), (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
  const contrato = {
    url: `/uploads/influencers/${inf.id}/contrato/${req.file.filename}`,
    name: req.file.originalname,
    uploadedAt: new Date().toISOString(),
    uploadedBy: req.user.id
  };
  db.get('influencers').find({ id: inf.id }).assign({ contrato }).write();
  logAudit({ user: req.user, entityType: 'influencer', entityId: inf.id, entityLabel: inf.name, action: 'update', details: `Contrato enviado: ${contrato.name}` });
  res.json({ influencer: serializeInfluencer(db.get('influencers').find({ id: inf.id }).value()) });
});

router.delete('/:id/contract', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  if (inf.contrato && inf.contrato.url) {
    const filePath = path.join(uploadsRoot, inf.id, 'contrato', path.basename(inf.contrato.url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  db.get('influencers').find({ id: inf.id }).assign({ contrato: null }).write();
  logAudit({ user: req.user, entityType: 'influencer', entityId: inf.id, entityLabel: inf.name, action: 'update', details: 'Contrato removido' });
  res.json({ influencer: serializeInfluencer(db.get('influencers').find({ id: inf.id }).value()) });
});

module.exports = router;
