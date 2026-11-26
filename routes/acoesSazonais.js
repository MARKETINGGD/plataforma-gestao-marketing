const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const shareLinks = require('../utils/shareLinks');
const budgetRouter = require('./budget');

const router = express.Router();

// 158ª rodada, item 9/11 (#124) — migração do dashboard de Ações Sazonais
// (app Railway separado, pasta dashboard-acoes-sazonais) pra dentro da
// Papoi como módulo nativo, mesmo molde exato da migração do Tráfego Pago
// (156ª rodada, ver routes/trafegoPago.js): mesmo login/sessão da Papoi,
// dados em coleções próprias (`acoesSazonais*`, nunca em outro banco),
// permissão por usuário na chave já existente `permissions.acoesSazonais`
// (routes/auth.js — a chave já existia, só nunca controlou nada além do
// SSO do iframe antigo em public/app.js), link externo via
// utils/shareLinks.js (no lugar do token caseiro que o app separado
// usava) e histórico de ações no `auditLog` global da Papoi.
//
// Visualização: SEMPRE liberada pra qualquer pessoa logada na Papoi, igual
// o comportamento de sempre do hub de dashboards (permissão 'none' nunca
// bloqueou ABRIR/VER este dashboard, só o Orçamento é privado por
// padrão) — só existe checagem de EDIÇÃO (`requireAcoesSazonaisEdit`).
//
// ATENÇÃO, não confundir com o módulo "Expositores" já nativo da Papoi
// (routes/expositores.js / expositoresEstoque) — é outra coisa (controle
// de inventário por código). "Showroom"/"Expositores Especiais" aqui é o
// conceito do app separado (lojista + proposta + obra + orçamento), ver
// `acoesSazonaisShowrooms` abaixo.
//
// Plano técnico completo em
// claude/PLANO-MIGRACAO-ACOES-SAZONAIS-124.md (no Project da Raquel).

function accessOf(req) {
  const user = db.get('users').find({ id: req.user.id }).value();
  return user ? (user.permissions || {}).acoesSazonais || 'none' : 'none';
}

function requireAcoesSazonaisEdit(req, res, next) {
  const access = accessOf(req);
  if (access !== 'editor' && access !== 'admin') {
    return res.status(403).json({ error: 'Você não tem permissão para editar Ações Sazonais.' });
  }
  next();
}

function requireAcoesSazonaisAdmin(req, res, next) {
  if (accessOf(req) !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores de Ações Sazonais podem fazer isso.' });
  }
  next();
}

function logAcoesSazonaisAudit({ user, brand, entityType, entityId, entityLabel, action, details }) {
  logAudit({ user, entityType, entityId, entityLabel, action, details, meta: { brand } });
}

const VALID_BRANDS = ['ghelplus', 'debacco'];

// ---------- Anexos (mesma sanitização do app separado, utils/attachments.js de lá) ----------

function sanitizeAttachment(raw) {
  if (!raw || typeof raw !== 'object' || !raw.filename) return null;
  return {
    filename: String(raw.filename).trim(),
    originalName: String(raw.originalName || raw.filename).trim(),
    size: (() => { const v = parseInt(raw.size, 10); return isNaN(v) ? 0 : v; })(),
    uploadedAt: String(raw.uploadedAt || '').trim(),
    uploadedBy: String(raw.uploadedBy || '').trim()
  };
}
function sanitizeAttachmentList(raw) {
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return list.map((f) => sanitizeAttachment(f)).filter(Boolean);
}

// ================================================================
// ---------- Ações (acoesSazonaisActions) ----------
// ================================================================

const VALID_TYPES = [
  'nova_acao', 'novo_evento', 'nova_feira', 'acao_influencer',
  'rodada_negocios', 'imersoes', 'treinamentos', 'mostra',
  'campanha_vendas', 'campanha_institucional', 'relacionamento',
  'patrocinio', 'material_pdv', 'campanha_cooperada'
];
const VALID_SETORES = ['marketing', 'comercial', 'outro'];
const VALID_MODALIDADES = ['presencial', 'online', 'hibrido'];
const VALID_ESTADOS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
  'NACIONAL'
];
// "Nova Feira" continua com a regra automática de sempre (não pede fluxo no
// cadastro, o Budget decide sozinho o fluxo de Feiras/Eventos da marca).
const TYPES_WITHOUT_FLUXO = ['nova_feira'];

// Fluxos do Budget: reaproveita DIRETO routes/budget.js (FLUXOS_BY_BRAND) —
// diferente do app separado, que precisava manter uma CÓPIA manual dessa
// lista (2 repositórios sem código compartilhado); aqui, sendo o mesmo
// processo, nunca mais dessincroniza.
const { FLUXOS_BY_BRAND } = budgetRouter;

function fluxoRequiredFor(type) {
  return !TYPES_WITHOUT_FLUXO.includes(type);
}
function fluxoFeiras(brand) {
  const lista = FLUXOS_BY_BRAND[brand] || [];
  return lista.find((f) => f.toLowerCase().startsWith('feiras')) || lista[0] || '';
}

function sanitizeProdutosList(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((p) => ({
        nome: String((p && p.nome) || '').trim(),
        quantidade: (() => { const v = parseInt(p && p.quantidade, 10); return isNaN(v) ? 0 : v; })()
      }))
      .filter((p) => p.nome);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean).map((nome) => ({ nome, quantidade: 0 }));
  }
  return [];
}

function sanitizeParcelasAcao(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => ({
      data: String((p && p.data) || '').trim(),
      valor: (() => { const v = parseFloat(p && p.valor); return isNaN(v) ? 0 : v; })()
    }))
    .filter((p) => p.data);
}

function sanitizeServicos(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch (e) { list = []; }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((s) => ({
      id: (s && s.id) || nanoid(),
      titulo: String((s && s.titulo) || '').trim(),
      valor: (() => { const v = parseFloat(s && s.valor); return isNaN(v) ? 0 : v; })(),
      formaPagamento: String((s && s.formaPagamento) || '').trim(),
      parcelado: !!(s && s.parcelado),
      dataPagamento: String((s && s.dataPagamento) || '').trim(),
      parcelas: sanitizeParcelasAcao(s && s.parcelas),
      produtos: sanitizeProdutosList(s && s.produtos),
      permutaServicos: sanitizeProdutosList(s && s.permutaServicos)
    }))
    .filter((s) => s.titulo || s.valor > 0 || s.formaPagamento);
}

function sanitizeRegioes(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch (e) { list = []; }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((r) => {
      const estado = String((r && r.estado) || '').trim().toUpperCase();
      const estadoValido = VALID_ESTADOS.includes(estado) ? estado : '';
      return {
        cidade: estadoValido === 'NACIONAL' ? '' : String((r && r.cidade) || '').trim(),
        estado: estadoValido
      };
    })
    .filter((r) => r.cidade || r.estado);
}

function sanitizeMonthlyEntries(raw) {
  let entries = raw;
  if (typeof entries === 'string') {
    try { entries = JSON.parse(entries); } catch (e) { entries = []; }
  }
  if (!Array.isArray(entries)) return [];
  return entries
    .map((e) => ({
      id: (e && e.id) || nanoid(),
      month: String((e && e.month) || '').trim(),
      engajamentoRedes: (() => { const v = parseFloat(e && e.engajamentoRedes); return isNaN(v) ? 0 : v; })(),
      seguidoresGanhos: (() => { const v = parseInt(e && e.seguidoresGanhos, 10); return isNaN(v) ? 0 : v; })(),
      vendasQuantidade: (() => { const v = parseInt(e && e.vendasQuantidade, 10); return isNaN(v) ? 0 : v; })(),
      valorVendas: (() => { const v = parseFloat(e && e.valorVendas); return isNaN(v) ? 0 : v; })(),
      vendasProdutos: sanitizeProdutosList(e && e.vendasProdutos),
      acessosSite: (() => { const v = parseInt(e && e.acessosSite, 10); return isNaN(v) ? 0 : v; })(),
      pessoasCaptadas: (() => { const v = parseInt(e && e.pessoasCaptadas, 10); return isNaN(v) ? 0 : v; })(),
      regiaoMes: String((e && e.regiaoMes) || '').trim(),
      numEventos: (() => { const v = parseInt(e && e.numEventos, 10); return isNaN(v) ? 0 : v; })(),
      observacoes: String((e && e.observacoes) || '').trim()
    }))
    .filter((e) => e.month);
}

function sanitizeAction(body, existing) {
  const a = existing ? { ...existing } : {};

  const strFields = [
    'title', 'representante', 'gerente', 'oQueFoiFeito', 'regiao',
    'dataInicio', 'dataFim', 'modalidade', 'permutaLink', 'participantesLink',
    'cliente', 'formaPagamento', 'documentoLink'
  ];
  strFields.forEach((f) => {
    if (body[f] !== undefined) a[f] = String(body[f] || '').trim();
  });

  const VALID_META_TIPOS = [
    'faturamento_valor', 'faturamento_percentual', 'novos_clientes',
    'conversao_leads', 'engajamento', 'alcance', 'seguidores',
    'participantes', 'novos_leads'
  ];
  if (body.metaTipo !== undefined) {
    a.metaTipo = VALID_META_TIPOS.includes(body.metaTipo) ? body.metaTipo : '';
  }
  if (body.metaValor !== undefined) {
    const v = parseFloat(body.metaValor);
    a.metaValor = isNaN(v) ? 0 : v;
  }
  if (body.metaResultadoManual !== undefined) {
    const v = parseFloat(body.metaResultadoManual);
    a.metaResultadoManual = isNaN(v) ? 0 : v;
  }

  if (body.brand !== undefined) {
    if (!VALID_BRANDS.includes(body.brand)) throw new Error('Marca inválida');
    a.brand = body.brand;
  }
  if (body.type !== undefined) {
    if (!VALID_TYPES.includes(body.type)) throw new Error('Tipo de ação inválido');
    a.type = body.type;
  }
  if (body.fluxo !== undefined) {
    const brandForFluxo = a.brand;
    const validList = FLUXOS_BY_BRAND[brandForFluxo] || [];
    const fluxoValue = String(body.fluxo || '').trim();
    if (fluxoValue && !validList.includes(fluxoValue)) {
      throw new Error('Fluxo do orçamento inválido para esta marca.');
    }
    a.fluxo = fluxoValue;
  }
  if (body.setor !== undefined) {
    a.setor = VALID_SETORES.includes(body.setor) ? body.setor : 'outro';
  }
  if (body.modalidade !== undefined && body.modalidade && !VALID_MODALIDADES.includes(body.modalidade)) {
    a.modalidade = 'presencial';
  }

  if (body.valorInvestido !== undefined) {
    const v = parseFloat(body.valorInvestido);
    a.valorInvestido = isNaN(v) ? 0 : v;
  }
  if (body.participantes !== undefined) {
    const v = parseInt(body.participantes, 10);
    a.participantes = isNaN(v) ? 0 : v;
  }

  if (body.pagamentoDinheiro !== undefined || body.pagamentoPermuta !== undefined) {
    const din = (() => { const v = parseFloat(body.pagamentoDinheiro); return isNaN(v) ? 0 : v; })();
    const per = (() => { const v = parseFloat(body.pagamentoPermuta); return isNaN(v) ? 0 : v; })();
    a.pagamentoDinheiro = din;
    a.pagamentoPermuta = per;
  }

  // 158ª rodada, #116 (sincronia Influencers -> Ações Sazonais, confirmado
  // com a Raquel: direção Influencer->Ação): referência estruturada pro
  // registro em Gerenciamento de Influencers, só relevante pro tipo
  // 'acao_influencer'. Guardado como ID (nunca copia dados pessoais/
  // financeiros do influencer pra dentro da Ação) -- nome/contato são só
  // lidos ao vivo (ver enrichAction abaixo) pra nunca dessincronizar.
  if (body.influencerId !== undefined) {
    const val = String(body.influencerId || '').trim();
    if (val) {
      const inf = db.get('influencers').find({ id: val }).value();
      if (!inf) throw new Error('Influencer não encontrado.');
      if (a.brand && inf.brand !== a.brand) {
        throw new Error('Esse influencer pertence a outra marca.');
      }
    }
    a.influencerId = val || null;
  }

  if (body.colaboradores !== undefined) {
    a.colaboradores = Array.isArray(body.colaboradores)
      ? body.colaboradores.map((c) => String(c).trim()).filter(Boolean)
      : String(body.colaboradores || '')
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean);
  }

  if (body.redesSociaisConteudo !== undefined) a.redesSociaisConteudo = !!body.redesSociaisConteudo;
  if (body.campanhaTrafego !== undefined) a.campanhaTrafego = !!body.campanhaTrafego;

  if (body.parcelado !== undefined) a.parcelado = !!body.parcelado;
  if (body.parcelas !== undefined) a.parcelas = sanitizeParcelasAcao(body.parcelas);
  if (body.servicos !== undefined) a.servicos = sanitizeServicos(body.servicos);
  if (body.regioes !== undefined) a.regioes = sanitizeRegioes(body.regioes);

  if (body.planejado !== undefined) a.planejado = !!body.planejado;
  if (body.feita !== undefined) a.feita = !!body.feita;

  if (body.permutaArquivo !== undefined) a.permutaArquivo = sanitizeAttachmentList(body.permutaArquivo);
  if (body.participantesArquivo !== undefined) a.participantesArquivo = sanitizeAttachmentList(body.participantesArquivo);
  if (body.documentoArquivo !== undefined) a.documentoArquivo = sanitizeAttachmentList(body.documentoArquivo);

  if (body.monthlyEntries !== undefined) {
    a.monthlyEntries = sanitizeMonthlyEntries(body.monthlyEntries);
  }

  if (body.report !== undefined && typeof body.report === 'object') {
    const r = { ...(a.report || {}) };
    const rStr = ['resultadosRegionais', 'resultadosNacionais', 'feedbackCliente', 'mudancaVendas', 'observacoes'];
    rStr.forEach((f) => {
      if (body.report[f] !== undefined) r[f] = String(body.report[f] || '').trim();
    });
    if (body.report.vendasProdutos !== undefined) {
      r.vendasProdutos = sanitizeProdutosList(body.report.vendasProdutos);
    }
    if (body.report.engajamentoRedes !== undefined) {
      const v = parseFloat(body.report.engajamentoRedes);
      r.engajamentoRedes = isNaN(v) ? 0 : v;
    }
    if (body.report.seguidoresGanhos !== undefined) {
      const v = parseInt(body.report.seguidoresGanhos, 10);
      r.seguidoresGanhos = isNaN(v) ? 0 : v;
    }
    if (body.report.vendasQuantidade !== undefined) {
      const v = parseInt(body.report.vendasQuantidade, 10);
      r.vendasQuantidade = isNaN(v) ? 0 : v;
    }
    if (body.report.valorVendas !== undefined) {
      const v = parseFloat(body.report.valorVendas);
      r.valorVendas = isNaN(v) ? 0 : v;
    }
    if (body.report.acessosSite !== undefined) {
      const v = parseInt(body.report.acessosSite, 10);
      r.acessosSite = isNaN(v) ? 0 : v;
    }
    a.report = r;
  }

  if (a.servicos && a.servicos.length) {
    a.valorInvestido = a.servicos.reduce((s, sv) => s + (sv.valor || 0), 0);
    const formas = [...new Set(a.servicos.map((sv) => sv.formaPagamento).filter(Boolean))];
    a.formaPagamento = formas.join(', ');
  } else if (a.type === 'acao_influencer') {
    a.valorInvestido = (a.pagamentoDinheiro || 0) + (a.pagamentoPermuta || 0);
  }

  if (a.regioes && a.regioes.length) {
    a.regiao = a.regioes
      .map((r) => (r.estado === 'NACIONAL' ? 'Nacional' : [r.cidade, r.estado].filter(Boolean).join('- ')))
      .filter(Boolean)
      .join(', ');
  }

  if (a.monthlyEntries && a.monthlyEntries.length) {
    const r = { ...(a.report || {}) };
    r.engajamentoRedes = a.monthlyEntries.reduce((s, m) => s + (m.engajamentoRedes || 0), 0);
    r.seguidoresGanhos = a.monthlyEntries.reduce((s, m) => s + (m.seguidoresGanhos || 0), 0);
    r.vendasQuantidade = a.monthlyEntries.reduce((s, m) => s + (m.vendasQuantidade || 0), 0);
    r.valorVendas = a.monthlyEntries.reduce((s, m) => s + (m.valorVendas || 0), 0);
    r.acessosSite = a.monthlyEntries.reduce((s, m) => s + (m.acessosSite || 0), 0);
    a.report = r;
  }

  return a;
}

// 158ª rodada, #116: enriquece uma Ação com o nome do influencer vinculado
// (ao vivo, nunca copiado/duplicado) -- pra EXIBIÇÃO apenas, nunca gravado
// de volta na coleção. `enrichAction` é pra tela AUTENTICADA (inclui aviso
// se o influencer foi excluído depois do vínculo); `enrichActionPublic` é
// pra view do LINK PÚBLICO -- nunca inclui o `influencerId` cru nem
// qualquer dado pessoal/financeiro do influencer (mesmo cuidado de sempre
// com dados pessoais desde a 21ª rodada), só o nome (igual
// serializeInfluencerPublic de routes/influencers.js).
function enrichAction(action) {
  if (action.type !== 'acao_influencer' || !action.influencerId) return action;
  const inf = db.get('influencers').find({ id: action.influencerId }).value();
  return {
    ...action,
    influencerNome: inf ? inf.name : '',
    influencerRemovido: !inf
  };
}

function enrichActionPublic(action) {
  if (action.type !== 'acao_influencer' || !action.influencerId) return action;
  const inf = db.get('influencers').find({ id: action.influencerId }).value();
  const { influencerId, ...rest } = action;
  return { ...rest, influencerNome: inf ? inf.name : '' };
}

// Sincronia com o Budget — antes era uma chamada HTTP pro outro serviço
// (utils/plataformaSync.js do app separado); agora é uma gravação direta
// em processo na MESMA coleção `budgetEntries` que o resto da Papoi usa
// (ver routes/budget.js) — sem ponto de falha de rede, nunca mais
// "silenciosamente não sincronizou porque um dos 2 Railway estava fora".
function syncActionToBudget(action) {
  if (!action.budgetSyncEligible) return;
  const category = fluxoRequiredFor(action.type) ? action.fluxo : fluxoFeiras(action.brand);
  let year, month;
  if (action.dataInicio) {
    const d = new Date(action.dataInicio);
    if (!isNaN(d.getTime())) { year = d.getFullYear(); month = d.getMonth() + 1; }
  }
  if (!year) {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }
  const nowIso = new Date().toISOString();
  const existing = db.get('budgetEntries').find({ sourceSystem: 'acoesSazonais', sourceId: action.id }).value();
  if (existing) {
    db.get('budgetEntries').find({ id: existing.id }).assign({
      brand: action.brand,
      category,
      year,
      month,
      realizado: action.valorInvestido === undefined || action.valorInvestido === null ? existing.realizado : Number(action.valorInvestido),
      tituloCompra: action.title !== undefined ? action.title : existing.tituloCompra,
      updatedAt: nowIso
    }).write();
    return;
  }
  db.get('budgetEntries').push({
    id: nanoid(),
    brand: action.brand,
    category,
    year,
    month,
    planejado: null,
    realizado: action.valorInvestido === undefined || action.valorInvestido === null ? null : Number(action.valorInvestido),
    notes: fluxoRequiredFor(action.type)
      ? `Lançado automaticamente a partir de uma ação cadastrada em Ações Sazonais (fluxo informado no cadastro: "${category}").`
      : 'Lançado automaticamente a partir de uma Ação "Nova Feira" em Ações Sazonais.',
    fornecedor: '',
    tituloCompra: action.title || '',
    quantidade: null,
    sourceSystem: 'acoesSazonais',
    sourceId: action.id,
    createdAt: nowIso,
    updatedAt: nowIso,
    updatedBy: 'Sincronização automática (Ações Sazonais)',
    updatedById: null
  }).write();
}
router.get('/actions', requireAuth, (req, res) => {
  let list = db.get('acoesSazonaisActions').value();
  if (req.query.brand) list = list.filter((a) => a.brand === req.query.brand);
  if (req.query.type) list = list.filter((a) => a.type === req.query.type);
  res.json({ actions: list.map(enrichAction) });
});

router.get('/actions/fluxos', requireAuth, (req, res) => {
  res.json({ fluxos: FLUXOS_BY_BRAND[req.query.brand] || [] });
});

router.get('/actions/:id', requireAuth, (req, res) => {
  const action = db.get('acoesSazonaisActions').find({ id: req.params.id }).value();
  if (!action) return res.status(404).json({ error: 'Ação não encontrada' });
  res.json({ action: enrichAction(action) });
});

router.post('/actions', requireAuth, requireAcoesSazonaisEdit, (req, res) => {
  try {
    if (!req.body.brand || !VALID_BRANDS.includes(req.body.brand)) {
      return res.status(400).json({ error: 'Marca inválida' });
    }
    if (!req.body.type || !VALID_TYPES.includes(req.body.type)) {
      return res.status(400).json({ error: 'Tipo de ação inválido' });
    }
    if (!req.body.title) {
      return res.status(400).json({ error: 'Título da ação é obrigatório' });
    }
    if (fluxoRequiredFor(req.body.type) && !String(req.body.fluxo || '').trim()) {
      return res.status(400).json({ error: 'Escolha o fluxo do orçamento para esta ação.' });
    }

    const base = sanitizeAction(req.body, {
      id: nanoid(),
      colaboradores: [],
      valorInvestido: 0,
      pagamentoDinheiro: 0,
      pagamentoPermuta: 0,
      permutaLink: '',
      participantes: 0,
      participantesLink: '',
      cliente: '',
      formaPagamento: '',
      metaTipo: '',
      metaValor: 0,
      metaResultadoManual: 0,
      setor: 'outro',
      redesSociaisConteudo: false,
      campanhaTrafego: false,
      monthlyEntries: [],
      parcelado: false,
      parcelas: [],
      servicos: [],
      regioes: [],
      planejado: true,
      feita: false,
      permutaArquivo: [],
      participantesArquivo: [],
      documentoLink: '',
      documentoArquivo: [],
      report: {
        engajamentoRedes: 0,
        seguidoresGanhos: 0,
        vendasQuantidade: 0,
        valorVendas: 0,
        vendasProdutos: [],
        acessosSite: 0,
        resultadosRegionais: '',
        resultadosNacionais: '',
        feedbackCliente: '',
        mudancaVendas: '',
        observacoes: ''
      }
    });
    base.createdAt = new Date().toISOString();
    base.updatedAt = base.createdAt;
    base.createdBy = req.user.username;
    base.updatedBy = req.user.username;
    // Marcado só na CRIAÇÃO, nunca aceito do corpo da requisição (pedido
    // explícito da Raquel no app original: ações já cadastradas não devem
    // entrar no Budget retroativamente).
    base.budgetSyncEligible = true;

    db.get('acoesSazonaisActions').push(base).write();
    logAcoesSazonaisAudit({
      user: req.user, brand: base.brand, entityType: 'acoesSazonaisAction', entityId: base.id,
      entityLabel: base.title, action: 'create', details: `Tipo: ${base.type}`
    });
    syncActionToBudget(base);
    res.status(201).json({ action: enrichAction(base) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/actions/:id', requireAuth, requireAcoesSazonaisEdit, (req, res) => {
  try {
    const existing = db.get('acoesSazonaisActions').find({ id: req.params.id }).value();
    if (!existing) return res.status(404).json({ error: 'Ação não encontrada' });

    const effectiveTypeForFluxo = req.body.type !== undefined ? req.body.type : existing.type;
    const effectiveFluxoForCheck = req.body.fluxo !== undefined ? req.body.fluxo : existing.fluxo;
    if (fluxoRequiredFor(effectiveTypeForFluxo) && !String(effectiveFluxoForCheck || '').trim()) {
      return res.status(400).json({ error: 'Escolha o fluxo do orçamento para esta ação.' });
    }

    const updated = sanitizeAction(req.body, existing);
    updated.updatedAt = new Date().toISOString();
    updated.updatedBy = req.user.username;

    db.get('acoesSazonaisActions').find({ id: req.params.id }).assign(updated).write();
    logAcoesSazonaisAudit({
      user: req.user, brand: updated.brand, entityType: 'acoesSazonaisAction', entityId: updated.id,
      entityLabel: updated.title, action: 'update', details: 'Dados ou relatório atualizados'
    });
    syncActionToBudget(updated);
    res.json({ action: enrichAction(updated) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/actions/:id', requireAuth, requireAcoesSazonaisEdit, (req, res) => {
  const existing = db.get('acoesSazonaisActions').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Ação não encontrada' });
  db.get('acoesSazonaisActions').remove({ id: req.params.id }).write();
  logAcoesSazonaisAudit({
    user: req.user, brand: existing.brand, entityType: 'acoesSazonaisAction', entityId: existing.id,
    entityLabel: existing.title, action: 'delete'
  });
  res.json({ ok: true });
});

// ================================================================
// ---------- Expositores Especiais (acoesSazonaisShowrooms) ----------
// ================================================================
// Não confundir com o módulo "Expositores" já nativo da Papoi
// (routes/expositores.js) — ver nota no topo do arquivo. Diferente de
// Ações: nunca teve nenhum sync automático com o Budget no app original
// (confirmado lendo o arquivo inteiro) — não inventar esse comportamento.

function sanitizeProdutosListShowroom(raw) { return sanitizeProdutosList(raw); }

const VALID_PARCELA_FORMAS = ['PIX', 'Boleto', 'Cartão'];
function sanitizeParcelasShowroom(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => ({
      data: String((p && p.data) || '').trim(),
      forma: VALID_PARCELA_FORMAS.includes(p && p.forma) ? p.forma : 'PIX',
      valor: (() => { const v = parseFloat(p && p.valor); return isNaN(v) ? 0 : v; })()
    }))
    .filter((p) => p.data);
}

const SHOWROOM_STR_FIELDS = [
  'lojista', 'gerente', 'representante', 'regiao',
  'dataSolicitacao', 'dataEntregaProposta', 'linkProposta', 'dataAprovacaoProposta', 'observacoesProposta',
  'dataEntregaDetalhamento', 'linkDetalhamento', 'observacoesDetalhamento',
  'dataInicioObra', 'dataFinalizacao', 'linkImagens',
  'linkOrcamento', 'dataAprovacao', 'quemAprovou', 'formaPagamento',
  'dataPagamento'
];

function sanitizeShowroom(body, existing) {
  const s = existing ? { ...existing } : {};

  SHOWROOM_STR_FIELDS.forEach((f) => {
    if (body[f] !== undefined) s[f] = String(body[f] || '').trim();
  });

  if (body.brand !== undefined) {
    if (!VALID_BRANDS.includes(body.brand)) throw new Error('Marca inválida');
    s.brand = body.brand;
  }
  if (body.valorInvestimento !== undefined) {
    const v = parseFloat(body.valorInvestimento);
    s.valorInvestimento = isNaN(v) ? 0 : v;
  }
  if (body.produtosAplicados !== undefined) {
    s.produtosAplicados = sanitizeProdutosListShowroom(body.produtosAplicados);
  }
  if (body.produtosPagamento !== undefined) {
    s.produtosPagamento = sanitizeProdutosListShowroom(body.produtosPagamento);
  }
  if (body.parcelas !== undefined) {
    s.parcelas = sanitizeParcelasShowroom(body.parcelas);
  }
  if (body.planejado !== undefined) s.planejado = !!body.planejado;

  if (body.arquivoProposta !== undefined) s.arquivoProposta = sanitizeAttachmentList(body.arquivoProposta);
  if (body.arquivoDetalhamento !== undefined) s.arquivoDetalhamento = sanitizeAttachmentList(body.arquivoDetalhamento);
  if (body.arquivoImagens !== undefined) s.arquivoImagens = sanitizeAttachmentList(body.arquivoImagens);
  if (body.arquivoOrcamento !== undefined) s.arquivoOrcamento = sanitizeAttachmentList(body.arquivoOrcamento);

  return s;
}

router.get('/showrooms', requireAuth, (req, res) => {
  let list = db.get('acoesSazonaisShowrooms').value();
  if (req.query.brand) list = list.filter((s) => s.brand === req.query.brand);
  res.json({ showrooms: list });
});

router.get('/showrooms/:id', requireAuth, (req, res) => {
  const showroom = db.get('acoesSazonaisShowrooms').find({ id: req.params.id }).value();
  if (!showroom) return res.status(404).json({ error: 'Showroom não encontrado' });
  res.json({ showroom });
});

router.post('/showrooms', requireAuth, requireAcoesSazonaisEdit, (req, res) => {
  try {
    if (!req.body.brand || !VALID_BRANDS.includes(req.body.brand)) {
      return res.status(400).json({ error: 'Marca inválida' });
    }
    if (!req.body.lojista) {
      return res.status(400).json({ error: 'Nome do lojista é obrigatório' });
    }

    const base = sanitizeShowroom(req.body, {
      id: nanoid(),
      valorInvestimento: 0,
      produtosAplicados: [],
      produtosPagamento: [],
      parcelas: [],
      planejado: true,
      arquivoProposta: [],
      arquivoDetalhamento: [],
      arquivoImagens: [],
      arquivoOrcamento: []
    });
    base.createdAt = new Date().toISOString();
    base.updatedAt = base.createdAt;
    base.createdBy = req.user.username;
    base.updatedBy = req.user.username;

    db.get('acoesSazonaisShowrooms').push(base).write();
    logAcoesSazonaisAudit({
      user: req.user, brand: base.brand, entityType: 'acoesSazonaisShowroom', entityId: base.id,
      entityLabel: base.lojista, action: 'create', details: `Região: ${base.regiao || '—'}`
    });
    res.status(201).json({ showroom: base });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/showrooms/:id', requireAuth, requireAcoesSazonaisEdit, (req, res) => {
  try {
    const existing = db.get('acoesSazonaisShowrooms').find({ id: req.params.id }).value();
    if (!existing) return res.status(404).json({ error: 'Showroom não encontrado' });

    const updated = sanitizeShowroom(req.body, existing);
    updated.updatedAt = new Date().toISOString();
    updated.updatedBy = req.user.username;

    db.get('acoesSazonaisShowrooms').find({ id: req.params.id }).assign(updated).write();
    logAcoesSazonaisAudit({
      user: req.user, brand: updated.brand, entityType: 'acoesSazonaisShowroom', entityId: updated.id,
      entityLabel: updated.lojista, action: 'update', details: 'Dados atualizados'
    });
    res.json({ showroom: updated });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/showrooms/:id', requireAuth, requireAcoesSazonaisEdit, (req, res) => {
  const existing = db.get('acoesSazonaisShowrooms').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Showroom não encontrado' });
  db.get('acoesSazonaisShowrooms').remove({ id: req.params.id }).write();
  logAcoesSazonaisAudit({
    user: req.user, brand: existing.brand, entityType: 'acoesSazonaisShowroom', entityId: existing.id,
    entityLabel: existing.lojista, action: 'delete'
  });
  res.json({ ok: true });
});

// ================================================================
// ---------- Catálogo de produtos (acoesSazonaisProducts) ----------
// ================================================================
function normalizeProductName(nome) {
  return String(nome || '').trim();
}

router.get('/products', requireAuth, (req, res) => {
  let list = db.get('acoesSazonaisProducts').value();
  if (req.query.brand) {
    if (!VALID_BRANDS.includes(req.query.brand)) {
      return res.status(400).json({ error: 'Marca inválida' });
    }
    list = list.filter((p) => p.brand === req.query.brand);
  }
  list = [...list].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  res.json({ products: list });
});

// Qualquer pessoa com acesso de edição pode cadastrar (inclusive via
// autocomplete, quando digita um nome que ainda não existe) — mesma regra
// do app original (lá bastava estar logado; aqui o equivalente é poder
// editar Ações Sazonais).
router.post('/products', requireAuth, requireAcoesSazonaisEdit, (req, res) => {
  try {
    const brand = req.body.brand;
    const nome = normalizeProductName(req.body.nome);
    if (!VALID_BRANDS.includes(brand)) {
      return res.status(400).json({ error: 'Marca inválida' });
    }
    if (!nome) {
      return res.status(400).json({ error: 'Nome do produto é obrigatório' });
    }

    const existing = db.get('acoesSazonaisProducts')
      .find((p) => p.brand === brand && p.nome.trim().toLowerCase() === nome.toLowerCase())
      .value();
    if (existing) {
      return res.status(200).json({ product: existing });
    }

    const product = {
      id: nanoid(),
      brand,
      nome,
      createdAt: new Date().toISOString(),
      createdBy: req.user.username
    };
    db.get('acoesSazonaisProducts').push(product).write();
    logAcoesSazonaisAudit({
      user: req.user, brand, entityType: 'acoesSazonaisProduct', entityId: product.id,
      entityLabel: product.nome, action: 'create'
    });
    res.status(201).json({ product });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Renomear/excluir do catálogo fica restrito a admin de Ações Sazonais
// (mesmo nível de restrição que o app original tinha, lá via requireAdmin
// do login próprio dele).
router.put('/products/:id', requireAuth, requireAcoesSazonaisAdmin, (req, res) => {
  try {
    const existing = db.get('acoesSazonaisProducts').find({ id: req.params.id }).value();
    if (!existing) return res.status(404).json({ error: 'Produto não encontrado' });

    const nome = normalizeProductName(req.body.nome);
    if (!nome) return res.status(400).json({ error: 'Nome do produto é obrigatório' });

    db.get('acoesSazonaisProducts').find({ id: req.params.id }).assign({
      nome,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.username
    }).write();

    logAcoesSazonaisAudit({
      user: req.user, brand: existing.brand, entityType: 'acoesSazonaisProduct', entityId: existing.id,
      entityLabel: nome, action: 'update', details: `Nome anterior: ${existing.nome}`
    });
    res.json({ product: db.get('acoesSazonaisProducts').find({ id: req.params.id }).value() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/products/:id', requireAuth, requireAcoesSazonaisAdmin, (req, res) => {
  const existing = db.get('acoesSazonaisProducts').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Produto não encontrado' });
  db.get('acoesSazonaisProducts').remove({ id: req.params.id }).write();
  logAcoesSazonaisAudit({
    user: req.user, brand: existing.brand, entityType: 'acoesSazonaisProduct', entityId: existing.id,
    entityLabel: existing.nome, action: 'delete'
  });
  res.json({ ok: true });
});

// ================================================================
// ---------- Orçamento anual por bucket (acoesSazonaisBudgets) ----------
// ================================================================
// Não confundir com o Budget geral da Papoi (`budgetEntries`, routes/
// budget.js) — é outro conceito (meta anual aprovada pros gráficos do
// dashboard de Ações, não lançamento financeiro individual).

const VALID_BUCKETS = [
  'acoes_feiras_eventos_mostra_rodada',
  'acoes_influencer',
  'acoes_campanha_vendas',
  'acoes_pdv',
  'acoes_treinamentos',
  'acoes_imersoes_relacionamento_treinamentos',
  'acoes_patrocinio',
  'acoes_campanha_cooperada',
  'acoes_campanha_institucional',
  'showroom_total'
];

function findAcoesBudget(brand, bucket, year) {
  return db.get('acoesSazonaisBudgets').find({ brand, bucket, year }).value();
}

router.get('/budgets', requireAuth, (req, res) => {
  let list = db.get('acoesSazonaisBudgets').value();
  if (req.query.brand) list = list.filter((b) => b.brand === req.query.brand);
  if (req.query.year) list = list.filter((b) => String(b.year) === String(req.query.year));
  res.json({ budgets: list });
});

router.put('/budgets', requireAuth, requireAcoesSazonaisEdit, (req, res) => {
  try {
    const { brand, bucket, year, valorAprovado } = req.body;
    if (!VALID_BRANDS.includes(brand)) return res.status(400).json({ error: 'Marca inválida' });
    if (!VALID_BUCKETS.includes(bucket)) return res.status(400).json({ error: 'Categoria de orçamento inválida' });
    const y = parseInt(year, 10);
    if (isNaN(y)) return res.status(400).json({ error: 'Ano inválido' });
    const v = parseFloat(valorAprovado);
    const valorFinal = isNaN(v) ? 0 : v;

    const existing = findAcoesBudget(brand, bucket, y);
    if (existing) {
      db.get('acoesSazonaisBudgets').find({ brand, bucket, year: y }).assign({
        valorAprovado: valorFinal,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user.username
      }).write();
    } else {
      db.get('acoesSazonaisBudgets').push({
        brand, bucket, year: y,
        valorAprovado: valorFinal,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: req.user.username
      }).write();
    }
    logAcoesSazonaisAudit({
      user: req.user, brand, entityType: 'acoesSazonaisBudget', entityId: brand + '-' + bucket + '-' + y,
      entityLabel: bucket, action: existing ? 'update' : 'create',
      details: 'Valor aprovado para ' + y + ': R$ ' + valorFinal
    });
    res.json({ budget: findAcoesBudget(brand, bucket, y) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ================================================================
// ---------- Histórico (reaproveita o auditLog global da Papoi) ----------
// ================================================================

router.get('/audit-log', requireAuth, (req, res) => {
  let list = db.get('auditLog').value()
    .filter((l) => typeof l.entityType === 'string' && l.entityType.indexOf('acoesSazonais') === 0);
  if (req.query.brand) list = list.filter((l) => l.brand === req.query.brand);
  list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ auditLog: list });
});

// ================================================================
// ---------- Link externo (via utils/shareLinks.js) ----------
// ================================================================
// Substitui o token caseiro (settings.js/publicToken) do app separado —
// mesmo padrão do Tráfego Pago (156ª rodada): 1 link por marca.

router.get('/public/:token', (req, res) => {
  const link = shareLinks.findByToken(req.params.token);
  if (!link || link.resource !== 'acoesSazonais') return res.status(404).json({ error: 'Link inválido ou desativado.' });
  const brand = link.scopeKey;
  const actions = db.get('acoesSazonaisActions').filter({ brand }).value().map(enrichActionPublic);
  const showrooms = db.get('acoesSazonaisShowrooms').filter({ brand }).value();
  const budgets = db.get('acoesSazonaisBudgets').filter({ brand }).value();
  res.json({ brand, actions, showrooms, budgets });
});

router.get('/public-link', requireAuth, requireAcoesSazonaisEdit, (req, res) => {
  const { brand } = req.query;
  const link = shareLinks.getLink('acoesSazonais', brand);
  res.json({ publicToken: link ? link.token : null });
});

router.post('/public-link/generate', requireAuth, requireAcoesSazonaisEdit, (req, res) => {
  const { brand } = req.body || {};
  if (!brand) return res.status(400).json({ error: 'Escolha a marca.' });
  const token = shareLinks.generateLink('acoesSazonais', brand, req);
  logAcoesSazonaisAudit({
    user: req.user, brand, entityType: 'acoesSazonaisShareLink', entityId: 'acoesSazonais:' + brand,
    entityLabel: 'Ações Sazonais · ' + brand, action: 'generate_public_link'
  });
  res.json({ publicToken: token });
});

router.delete('/public-link', requireAuth, requireAcoesSazonaisEdit, (req, res) => {
  const { brand } = req.query;
  shareLinks.revokeLink('acoesSazonais', brand);
  logAcoesSazonaisAudit({
    user: req.user, brand, entityType: 'acoesSazonaisShareLink', entityId: 'acoesSazonais:' + brand,
    entityLabel: 'Ações Sazonais · ' + brand, action: 'revoke_public_link'
  });
  res.json({ ok: true });
});

// ================================================================
// ---------- Anexos (upload de PDF/Excel/Word) ----------
// ================================================================
// Mesmos formatos/limite do app separado (utils/uploads.js de lá) —
// pasta própria dentro de data/uploads (mesma pasta persistente que o
// resto da Papoi já usa).

const acoesUploadsDir = path.join(__dirname, '..', 'data', 'uploads', 'acoes-sazonais');
if (!fs.existsSync(acoesUploadsDir)) fs.mkdirSync(acoesUploadsDir, { recursive: true });

const ALLOWED_EXTENSIONS = ['.pdf', '.xls', '.xlsx', '.doc', '.docx'];
const ALLOWED_MIMETYPES = [
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

const acoesUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, acoesUploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${nanoid()}${ext}`);
  }
});

function acoesUploadFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext) || !ALLOWED_MIMETYPES.includes(file.mimetype)) {
    return cb(new Error('Formato não permitido — envie um PDF, Excel (.xls/.xlsx) ou Word (.doc/.docx)'));
  }
  cb(null, true);
}

const acoesUpload = multer({
  storage: acoesUploadStorage,
  fileFilter: acoesUploadFileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }
});

router.post('/uploads', requireAuth, requireAcoesSazonaisEdit, (req, res) => {
  acoesUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    res.status(201).json({
      file: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        uploadedAt: new Date().toISOString(),
        uploadedBy: req.user.username
      }
    });
  });
});

router.get('/uploads/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(acoesUploadsDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado' });
  res.sendFile(filePath);
});

router.delete('/uploads/:filename', requireAuth, requireAcoesSazonaisEdit, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(acoesUploadsDir, filename);
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') return res.status(500).json({ error: 'Não foi possível remover o arquivo' });
    res.json({ ok: true });
  });
});

module.exports = router;
