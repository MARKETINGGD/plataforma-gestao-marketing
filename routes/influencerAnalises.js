const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// Análise de Influencer (89ª rodada, pedido da Raquel: "aidicione um sub
// menu em influencers, com o nome Análise de influencer", com os campos da
// planilha "MAPEAMENTO DE INFLUENCIADORES" que ela compartilhou — duas
// abas, "Mapeamento" e "Informações importantes", exatamente os campos
// abaixo). É a etapa de PROSPECÇÃO/avaliação de uma possível influencer,
// antes de virar um cadastro de verdade em Gerenciamento de Influencers
// (routes/influencers.js). Mesmo padrão de acesso aberto já usado em
// Influencers/Demandas — qualquer pessoa logada pode usar.

const BRANDS = ['debacco', 'ghelplus'];
const STATUSES = ['em_analise', 'aprovada', 'reprovada'];

// Campos numéricos (contagem/alcance) — aceitam só número, igual ao padrão
// já usado em Budget/Expositores (type="number" step="1").
const NUMERIC_FIELDS = [
  'seguidores', 'mediaLikes', 'mediaViews', 'mediaComentarios', 'alcance',
  'faixaEtaria1317', 'faixaEtaria1824', 'faixaEtaria25Mais',
  'generoAudienciaMulheres', 'generoAudienciaHomens', 'idade'
];
// Campos de valor cobrado por formato — monetários (step 0.01), mesmo
// padrão já usado em Budget (budgetFormPlanejado/budgetFormRealizado).
const MONEY_FIELDS = [
  'valorPostFotoStories', 'valorPostVideoStories', 'valorPostAvulsoFoto',
  'valorPostAvulsoVideoReels', 'valorQuatroStories', 'valorPresencaPostStories',
  'valorYoutube', 'valorTiktok'
];
// Campos de texto livre (aba "Mapeamento", além dos numéricos acima).
const TEXT_FIELDS_MAPEAMENTO = ['nome', 'genero', 'estado', 'principaisTemas', 'cidades'];
// Campos de texto livre (aba "Informações importantes") — tudo texto livre
// de propósito (igual ao precedente de "Estado" em outras telas da
// Plataforma: campo livre, não um <select> fechado), já que são respostas
// informais que a Raquel coleta por fora, sem um vocabulário fixo.
const TEXT_FIELDS_INFO = [
  'instagramHandle', 'tiktokHandle', 'youtubeHandle', 'aniversario',
  'statusCivil', 'reforma', 'filhos', 'moraSozinho', 'local', 'tipoCabelo',
  'intoleranciasAlimentares', 'habitosAlimentares', 'alergias', 'oculosGrau',
  'animalEstimacao'
];
const TEXT_FIELDS = TEXT_FIELDS_MAPEAMENTO.concat(TEXT_FIELDS_INFO);
const ALL_FIELDS = NUMERIC_FIELDS.concat(MONEY_FIELDS, TEXT_FIELDS);

function sanitizeFields(body) {
  const out = {};
  NUMERIC_FIELDS.concat(MONEY_FIELDS).forEach((key) => {
    if (body[key] === undefined) return;
    const n = Number(body[key]);
    out[key] = (body[key] === '' || body[key] === null || Number.isNaN(n)) ? null : n;
  });
  TEXT_FIELDS.forEach((key) => {
    if (body[key] !== undefined) out[key] = (body[key] || '').toString().trim();
  });
  return out;
}

function emptyFields() {
  const out = {};
  ALL_FIELDS.forEach((key) => { out[key] = NUMERIC_FIELDS.concat(MONEY_FIELDS).includes(key) ? null : ''; });
  return out;
}

function serializeAnalise(a) {
  const out = Object.assign({
    id: a.id,
    brand: a.brand,
    status: a.status,
    createdAt: a.createdAt,
    influencerId: a.influencerId || null,
    motivoReprovacao: a.motivoReprovacao || ''
  }, emptyFields(), a);
  return out;
}

function findAnaliseOr404(req, res) {
  const a = db.get('influencerAnalises').find({ id: req.params.id }).value();
  if (!a) {
    res.status(404).json({ error: 'Análise não encontrada.' });
    return null;
  }
  return a;
}

router.get('/meta', requireAuth, (req, res) => {
  res.json({ brands: BRANDS, statuses: STATUSES, fields: ALL_FIELDS });
});

router.get('/', requireAuth, (req, res) => {
  const brand = BRANDS.includes(req.query.brand) ? req.query.brand : null;
  const status = STATUSES.includes(req.query.status) ? req.query.status : null;
  let list = db.get('influencerAnalises').value();
  if (brand) list = list.filter((a) => a.brand === brand);
  if (status) list = list.filter((a) => a.status === status);
  list = list.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ analises: list.map(serializeAnalise) });
});

router.get('/:id', requireAuth, (req, res) => {
  const a = findAnaliseOr404(req, res);
  if (!a) return;
  res.json({ analise: serializeAnalise(a) });
});

router.post('/', requireAuth, (req, res) => {
  const { brand } = req.body || {};
  if (!BRANDS.includes(brand)) return res.status(400).json({ error: 'Marca inválida.' });
  const fields = sanitizeFields(req.body || {});
  if (!fields.nome || !fields.nome.trim()) return res.status(400).json({ error: 'Informe o nome da influencer.' });
  const analise = Object.assign({
    id: nanoid(),
    brand,
    status: 'em_analise',
    influencerId: null,
    motivoReprovacao: '',
    createdAt: new Date().toISOString(),
    createdBy: req.user.id
  }, emptyFields(), fields);
  db.get('influencerAnalises').push(analise).write();
  logAudit({ user: req.user, entityType: 'influencerAnalise', entityId: analise.id, entityLabel: analise.nome, action: 'create' });
  res.json({ analise: serializeAnalise(analise) });
});

router.put('/:id', requireAuth, (req, res) => {
  const a = findAnaliseOr404(req, res);
  if (!a) return;
  const fields = sanitizeFields(req.body || {});
  if (fields.nome !== undefined && !fields.nome.trim()) return res.status(400).json({ error: 'Informe o nome da influencer.' });
  db.get('influencerAnalises').find({ id: a.id }).assign(fields).write();
  const updated = db.get('influencerAnalises').find({ id: a.id }).value();
  logAudit({ user: req.user, entityType: 'influencerAnalise', entityId: a.id, entityLabel: updated.nome, action: 'update' });
  res.json({ analise: serializeAnalise(updated) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const a = findAnaliseOr404(req, res);
  if (!a) return;
  db.get('influencerAnalises').remove({ id: a.id }).write();
  logAudit({ user: req.user, entityType: 'influencerAnalise', entityId: a.id, entityLabel: a.nome, action: 'delete' });
  res.json({ ok: true });
});

// Aprovar (pedido explícito da Raquel: "quando aprovada uma influencer da
// aba analise, ja deve criar automaticamnete um cadastro e uma planilha p
// ela no outra aba que ja existe") — cria direto um registro em
// `influencers`, pulando a exigência de dados pessoais (CPF/RG/telefone/
// email/data de nascimento/endereço) que só vale no cadastro MANUAL normal
// (POST /api/influencers, 78ª rodada) — aqui ainda não tem esses dados (a
// planilha de análise não pede isso), dá pra completar depois editando o
// influencer já criado (PUT /api/influencers/:id não exige esses campos).
// A "planilha" dela (tabela de ações, `influencerPosts`) já nasce vazia
// sozinha, igual a qualquer influencer novo — não precisa criar nada à
// parte pra isso.
router.post('/:id/aprovar', requireAuth, (req, res) => {
  const a = findAnaliseOr404(req, res);
  if (!a) return;
  if (a.status !== 'em_analise') return res.status(400).json({ error: 'Esta análise já foi decidida (aprovada ou reprovada).' });
  const inf = {
    id: nanoid(),
    brand: a.brand,
    name: a.nome,
    cpf: '', rg: '', telefone: '', email: '', dataNascimento: '', endereco: '',
    publicToken: null,
    contrato: null,
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    // Guarda referência de onde veio, pra quem olhar o cadastro depois
    // entender a origem (não exibido no formulário normal, só auditoria).
    origemAnaliseId: a.id
  };
  db.get('influencers').push(inf).write();
  db.get('influencerAnalises').find({ id: a.id }).assign({
    status: 'aprovada',
    influencerId: inf.id,
    approvedAt: new Date().toISOString(),
    approvedBy: req.user.id
  }).write();
  logAudit({ user: req.user, entityType: 'influencerAnalise', entityId: a.id, entityLabel: a.nome, action: 'update', details: `Aprovada — criou cadastro em Gerenciamento de Influencers (${inf.id})` });
  logAudit({ user: req.user, entityType: 'influencer', entityId: inf.id, entityLabel: inf.name, action: 'create', details: `Criado a partir da Análise de Influencer (${a.id})` });
  res.json({ analise: serializeAnalise(db.get('influencerAnalises').find({ id: a.id }).value()), influencer: inf });
});

router.post('/:id/reprovar', requireAuth, (req, res) => {
  const a = findAnaliseOr404(req, res);
  if (!a) return;
  if (a.status !== 'em_analise') return res.status(400).json({ error: 'Esta análise já foi decidida (aprovada ou reprovada).' });
  const motivo = ((req.body || {}).motivo || '').toString().trim();
  db.get('influencerAnalises').find({ id: a.id }).assign({
    status: 'reprovada',
    motivoReprovacao: motivo,
    reprovedAt: new Date().toISOString(),
    reprovedBy: req.user.id
  }).write();
  logAudit({ user: req.user, entityType: 'influencerAnalise', entityId: a.id, entityLabel: a.nome, action: 'update', details: motivo ? `Reprovada — ${motivo}` : 'Reprovada' });
  res.json({ analise: serializeAnalise(db.get('influencerAnalises').find({ id: a.id }).value()) });
});

module.exports = router;
