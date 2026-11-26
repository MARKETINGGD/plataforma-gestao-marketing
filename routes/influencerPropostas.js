const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const influencersRouter = require('./influencers');
const budgetRouter = require('./budget');

const { FORMAS_PAGAMENTO } = influencersRouter;
const { FLUXOS_BY_BRAND } = budgetRouter;

const router = express.Router();

// Propostas de Influencer (158ª rodada, item #117, pedido da Raquel).
//
// Hoje (antes desta rodada): aprovar uma Análise de Influencer
// (routes/influencerAnalises.js, POST /:id/aprovar) criava o cadastro em
// Gerenciamento de Influencers DIRETO, sem etapa intermediária. Pedido
// novo insere uma etapa no meio: Análise aprovada -> vira 1 "Proposta"
// aqui, na aba "Propostas em Análise" -- só quando a PRÓPRIA Proposta é
// aprovada o influencer entra de verdade em Gerenciamento (e, por
// consequência, fica disponível pro relatório de Ações Sazonais, #116, e
// pro Budget, mesma mecânica de sempre de parcela/entrega). Se a Proposta
// for reprovada, vai pra aba "Propostas Reprovadas" -- o influencer NUNCA
// chega a ser criado nesse caso.
//
// Campos pedidos pela Raquel: links, arquivos, textos (observações),
// datas de entrega da proposta, valor total, entregas (descrição livre do
// que será entregue), período de vigência da parceria, forma de
// pagamento, influencer (nome, vem da Análise de origem). Acrescentado
// `fluxo`, não citado explicitamente no pedido mas estruturalmente
// necessário pra cumprir "o valor entra no Budget no fluxo/marca
// corretos" -- sem fluxo não tem como saber em qual categoria do Budget o
// valor deveria entrar (mesma exigência já existente pra lançar parcela
// de influencer, 155ª rodada).
//
// Assunção feita (marcada no doc da rodada, a confirmar com a Raquel):
// influencers que JÁ estavam em Gerenciamento antes desta mudança
// (criados pelo fluxo antigo, direto da Análise) ficam como estão --
// SEM proposta retroativa, grandfathered.
const BRANDS = ['debacco', 'ghelplus'];
const STATUSES = ['em_analise', 'aprovada', 'reprovada'];

function numOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function findPropostaOr404(req, res) {
  const p = db.get('influencerPropostas').find({ id: req.params.id }).value();
  if (!p) {
    res.status(404).json({ error: 'Proposta não encontrada.' });
    return null;
  }
  return p;
}

function serializeProposta(p) {
  return {
    id: p.id,
    brand: p.brand,
    analiseId: p.analiseId || null,
    nome: p.nome || '',
    email: p.email || '',
    status: p.status,
    links: p.links || [],
    arquivos: p.arquivos || [],
    observacoes: p.observacoes || '',
    entregas: p.entregas || '',
    dataEntregaProposta: p.dataEntregaProposta || null,
    vigenciaInicio: p.vigenciaInicio || null,
    vigenciaFim: p.vigenciaFim || null,
    valorTotal: p.valorTotal === undefined ? null : p.valorTotal,
    formaPagamento: p.formaPagamento || '',
    fluxo: p.fluxo || '',
    influencerId: p.influencerId || null,
    motivoReprovacao: p.motivoReprovacao || '',
    createdAt: p.createdAt,
    createdBy: p.createdBy,
    approvedAt: p.approvedAt || null,
    approvedBy: p.approvedBy || null,
    reprovedAt: p.reprovedAt || null,
    reprovedBy: p.reprovedBy || null
  };
}

// Criada internamente por POST /:id/aprovar em routes/influencerAnalises.js
// quando uma Análise é aprovada -- não exposta como criação manual direta
// (a Proposta sempre nasce de 1 Análise aprovada, nunca do zero).
function createPropostaFromAnalise(analise, req) {
  const now = new Date().toISOString();
  const proposta = {
    id: nanoid(),
    brand: analise.brand,
    analiseId: analise.id,
    nome: analise.nome,
    email: analise.email || '',
    status: 'em_analise',
    links: [],
    arquivos: [],
    observacoes: '',
    entregas: '',
    dataEntregaProposta: null,
    vigenciaInicio: null,
    vigenciaFim: null,
    valorTotal: null,
    formaPagamento: '',
    fluxo: '',
    influencerId: null,
    motivoReprovacao: '',
    createdAt: now,
    createdBy: req.user.id
  };
  db.get('influencerPropostas').push(proposta).write();
  logAudit({ user: req.user, entityType: 'influencerProposta', entityId: proposta.id, entityLabel: proposta.nome, action: 'create', details: `Criada a partir da Análise de Influencer aprovada (${analise.id})` });
  return proposta;
}

router.get('/meta', requireAuth, (req, res) => {
  res.json({ brands: BRANDS, statuses: STATUSES, formasPagamento: FORMAS_PAGAMENTO });
});

router.get('/', requireAuth, (req, res) => {
  const brand = BRANDS.includes(req.query.brand) ? req.query.brand : null;
  const status = STATUSES.includes(req.query.status) ? req.query.status : null;
  let list = db.get('influencerPropostas').value();
  if (brand) list = list.filter((p) => p.brand === brand);
  if (status) list = list.filter((p) => p.status === status);
  list = list.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ propostas: list.map(serializeProposta) });
});

router.get('/:id', requireAuth, (req, res) => {
  const p = findPropostaOr404(req, res);
  if (!p) return;
  res.json({ proposta: serializeProposta(p) });
});

const EDITABLE_FIELDS = ['observacoes', 'entregas', 'dataEntregaProposta', 'vigenciaInicio', 'vigenciaFim', 'valorTotal', 'formaPagamento', 'fluxo'];

router.put('/:id', requireAuth, (req, res) => {
  const p = findPropostaOr404(req, res);
  if (!p) return;
  if (p.status !== 'em_analise') return res.status(400).json({ error: 'Esta proposta já foi decidida (aprovada ou reprovada) e não pode mais ser editada.' });
  const body = req.body || {};
  const patch = { updatedAt: new Date().toISOString() };
  if (body.observacoes !== undefined) patch.observacoes = (body.observacoes || '').toString();
  if (body.entregas !== undefined) patch.entregas = (body.entregas || '').toString();
  if (body.dataEntregaProposta !== undefined) patch.dataEntregaProposta = body.dataEntregaProposta || null;
  if (body.vigenciaInicio !== undefined) patch.vigenciaInicio = body.vigenciaInicio || null;
  if (body.vigenciaFim !== undefined) patch.vigenciaFim = body.vigenciaFim || null;
  if (body.valorTotal !== undefined) patch.valorTotal = numOrNull(body.valorTotal);
  if (body.formaPagamento !== undefined) {
    if (body.formaPagamento && !FORMAS_PAGAMENTO.includes(body.formaPagamento)) return res.status(400).json({ error: 'Forma de pagamento inválida.' });
    patch.formaPagamento = body.formaPagamento || '';
  }
  if (body.fluxo !== undefined) {
    const lista = FLUXOS_BY_BRAND[p.brand] || [];
    if (body.fluxo && !lista.includes(body.fluxo)) return res.status(400).json({ error: 'Fluxo inválido para esta marca.' });
    patch.fluxo = body.fluxo || '';
  }
  db.get('influencerPropostas').find({ id: p.id }).assign(patch).write();
  const updated = db.get('influencerPropostas').find({ id: p.id }).value();
  logAudit({ user: req.user, entityType: 'influencerProposta', entityId: p.id, entityLabel: updated.nome, action: 'update' });
  res.json({ proposta: serializeProposta(updated) });
});

// ---------- Links (texto livre, sem upload) ----------
router.post('/:id/links', requireAuth, (req, res) => {
  const p = findPropostaOr404(req, res);
  if (!p) return;
  if (p.status !== 'em_analise') return res.status(400).json({ error: 'Esta proposta já foi decidida.' });
  const { url, label } = req.body || {};
  if (!url || !url.toString().trim()) return res.status(400).json({ error: 'Informe o link.' });
  const link = { id: nanoid(), url: url.toString().trim(), label: (label || '').toString().trim() };
  const links = (p.links || []).concat([link]);
  db.get('influencerPropostas').find({ id: p.id }).assign({ links }).write();
  logAudit({ user: req.user, entityType: 'influencerProposta', entityId: p.id, entityLabel: p.nome, action: 'update', details: 'Link adicionado' });
  res.json({ proposta: serializeProposta(db.get('influencerPropostas').find({ id: p.id }).value()) });
});

router.delete('/:id/links/:linkId', requireAuth, (req, res) => {
  const p = findPropostaOr404(req, res);
  if (!p) return;
  const links = (p.links || []).filter((l) => l.id !== req.params.linkId);
  db.get('influencerPropostas').find({ id: p.id }).assign({ links }).write();
  logAudit({ user: req.user, entityType: 'influencerProposta', entityId: p.id, entityLabel: p.nome, action: 'update', details: 'Link removido' });
  res.json({ proposta: serializeProposta(db.get('influencerPropostas').find({ id: p.id }).value()) });
});

// ---------- Arquivos (mesmo padrão exato do mídia kit de Análise de
// Influencer, 91ª rodada: 1 arquivo por vez, lista acumulada, nunca
// substitui o anterior) ----------
const arquivosUploadsRoot = path.join(__dirname, '..', 'data', 'uploads', 'influencer-propostas');
const arquivosStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(arquivosUploadsRoot, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, Date.now() + '-' + safe);
  }
});
const uploadArquivo = multer({ storage: arquivosStorage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB, mesmo limite do mídia kit de Análise

router.post('/:id/arquivos', requireAuth, uploadArquivo.single('file'), (req, res) => {
  const p = findPropostaOr404(req, res);
  if (!p) {
    if (req.file && req.file.path) { try { fs.unlinkSync(req.file.path); } catch (e) { /* ignora */ } }
    return;
  }
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
  const fileMeta = {
    id: nanoid(),
    name: req.file.originalname,
    url: `/uploads/influencer-propostas/${p.id}/${req.file.filename}`,
    size: req.file.size,
    uploadedAt: new Date().toISOString(),
    uploadedBy: req.user.id,
    uploadedByName: req.user.name
  };
  const arquivos = [...(p.arquivos || []), fileMeta];
  db.get('influencerPropostas').find({ id: p.id }).assign({ arquivos }).write();
  logAudit({ user: req.user, entityType: 'influencerProposta', entityId: p.id, entityLabel: p.nome, action: 'update', details: `Arquivo enviado: ${fileMeta.name}` });
  res.json({ proposta: serializeProposta(db.get('influencerPropostas').find({ id: p.id }).value()) });
});

router.delete('/:id/arquivos/:fileId', requireAuth, (req, res) => {
  const p = findPropostaOr404(req, res);
  if (!p) return;
  const target = (p.arquivos || []).find((f) => f.id === req.params.fileId);
  const arquivos = (p.arquivos || []).filter((f) => f.id !== req.params.fileId);
  db.get('influencerPropostas').find({ id: p.id }).assign({ arquivos }).write();
  if (target) {
    const filePath = path.join(arquivosUploadsRoot, p.id, path.basename(target.url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    logAudit({ user: req.user, entityType: 'influencerProposta', entityId: p.id, entityLabel: p.nome, action: 'update', details: `Arquivo removido: ${target.name}` });
  }
  res.json({ proposta: serializeProposta(db.get('influencerPropostas').find({ id: p.id }).value()) });
});

// ---------- Aprovar / Reprovar ----------
//
// Aprovar: cria o cadastro em Gerenciamento de Influencers (mesmo molde
// do fluxo antigo -- dados pessoais formais ficam em branco, completáveis
// depois), com `formaPagamento`/`fluxo` já vindos da Proposta. Quando a
// forma de pagamento envolve dinheiro (pix/transferência), uma 1ª parcela
// é criada automaticamente com o valor total da Proposta -- SEMPRE como
// `pago: false` (mesma regra de sempre: só uma parcela marcada como paga
// de verdade gera lançamento em budgetEntries, 155ª rodada; nunca
// fabricamos um pagamento que ainda não aconteceu). Isso cumpre "o valor
// entra no Budget no fluxo/marca corretos" no sentido de já deixar o
// lançamento pronto pra virar Budget assim que o pagamento acontecer de
// verdade -- exatamente como já funciona pra qualquer influencer cadastrado
// manualmente. Quando a forma é "produto" (permuta), não há como inventar
// NF/data de entrega que ainda não existem -- o influencer só é criado
// com `formaPagamento: 'produto'` e a 1ª entrega real é cadastrada depois,
// manualmente, em Gerenciamento (mesmo fluxo do #115).
router.post('/:id/aprovar', requireAuth, (req, res) => {
  const p = findPropostaOr404(req, res);
  if (!p) return;
  if (p.status !== 'em_analise') return res.status(400).json({ error: 'Esta proposta já foi decidida (aprovada ou reprovada).' });
  if (!p.formaPagamento) return res.status(400).json({ error: 'Escolha a forma de pagamento antes de aprovar a proposta.' });
  if (p.formaPagamento !== 'produto' && !p.fluxo) return res.status(400).json({ error: 'Escolha o fluxo do Budget antes de aprovar a proposta.' });
  if (p.formaPagamento !== 'produto' && (p.valorTotal === null || p.valorTotal === undefined)) return res.status(400).json({ error: 'Informe o valor total da proposta antes de aprovar.' });

  const now = new Date().toISOString();
  const inf = {
    id: nanoid(),
    brand: p.brand,
    name: p.nome,
    cpf: '', rg: '', telefone: '', email: p.email || '', dataNascimento: '', endereco: '',
    publicToken: null,
    contrato: null,
    formaPagamento: p.formaPagamento,
    fluxo: p.formaPagamento === 'produto' ? '' : p.fluxo,
    parcelas: [],
    entregasProduto: [],
    createdAt: now,
    createdBy: req.user.id,
    origemAnaliseId: p.analiseId || null,
    origemPropostaId: p.id
  };

  if (p.formaPagamento !== 'produto' && p.valorTotal) {
    inf.parcelas = [{
      id: nanoid(),
      valor: p.valorTotal,
      dataPagamento: p.vigenciaInicio || p.dataEntregaProposta || null,
      pago: false,
      notaFiscal: null,
      budgetEntryId: null,
      createdAt: now,
      updatedAt: now,
      origemPropostaId: p.id
    }];
  }

  db.get('influencers').push(inf).write();
  db.get('influencerPropostas').find({ id: p.id }).assign({
    status: 'aprovada',
    influencerId: inf.id,
    approvedAt: now,
    approvedBy: req.user.id
  }).write();
  logAudit({ user: req.user, entityType: 'influencerProposta', entityId: p.id, entityLabel: p.nome, action: 'update', details: `Aprovada — criou cadastro em Gerenciamento de Influencers (${inf.id})` });
  logAudit({ user: req.user, entityType: 'influencer', entityId: inf.id, entityLabel: inf.name, action: 'create', details: `Criado a partir da Proposta de Influencer aprovada (${p.id})` });
  res.json({ proposta: serializeProposta(db.get('influencerPropostas').find({ id: p.id }).value()), influencer: inf });
});

router.post('/:id/reprovar', requireAuth, (req, res) => {
  const p = findPropostaOr404(req, res);
  if (!p) return;
  if (p.status !== 'em_analise') return res.status(400).json({ error: 'Esta proposta já foi decidida (aprovada ou reprovada).' });
  const motivo = ((req.body || {}).motivo || '').toString().trim();
  db.get('influencerPropostas').find({ id: p.id }).assign({
    status: 'reprovada',
    motivoReprovacao: motivo,
    reprovedAt: new Date().toISOString(),
    reprovedBy: req.user.id
  }).write();
  logAudit({ user: req.user, entityType: 'influencerProposta', entityId: p.id, entityLabel: p.nome, action: 'update', details: motivo ? `Reprovada — ${motivo}` : 'Reprovada' });
  res.json({ proposta: serializeProposta(db.get('influencerPropostas').find({ id: p.id }).value()) });
});

router.createPropostaFromAnalise = createPropostaFromAnalise;
module.exports = router;
