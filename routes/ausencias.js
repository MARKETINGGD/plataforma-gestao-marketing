const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { resolveUserName, resolveUserPhoto } = require('../utils/names');
const { createAutoRecado } = require('./recados');

const router = express.Router();

// Ausências (104ª rodada, pedido da Raquel): "adicione tbm, em usuários,
// uma aba com um calendário e nele deve ter a opção de cadastrar os dias
// de férias, afastamentos, saidas fora do horário de cada colaborador e
// nesse calendario deve mostrar quem estava ausente naqueles dias."
// Mais 3 efeitos em cascata, implementados nesta mesma rodada:
//   1. Aviso na coluna da pessoa em Demandas quando ela está ausente HOJE
//      (ver `GET /publicas` abaixo + renderKanban() em app.js).
//   2. Aviso pra quem cria/edita uma demanda, se a entrega (dueDate) cai
//      durante a ausência de alguém marcado (checado no FRONT, com os
//      mesmos dados de `GET /publicas` -- ver $('#demCardSave').onclick
//      em app.js; é um aviso, não um bloqueio, então fica só no cliente).
//   3. Comunicado automático em Recados quando uma ausência nasce (ver
//      `anunciarAusencia` abaixo) -- broadcast pra TODO MUNDO, mesmo
//      mecanismo de recado automático do sistema já usado desde a 44ª/45ª
//      rodada (`createAutoRecado`).
//
// Acesso: igual ao resto da tela Usuários (103ª rodada) -- ver o
// calendário completo e cadastrar/editar/excluir fica restrito a quem tem
// `configuracoes: visualizar` (ou é super admin) pra VER, e exclusivo do
// super admin de verdade pra CRIAR/EDITAR/EXCLUIR (mesma decisão da 103ª:
// ações dentro de Configurações não são delegáveis por uma permissão
// simples). Só a listagem enxuta (`GET /publicas`) foge dessa regra de
// propósito -- Demandas é um módulo aberto a todo mundo, então qualquer
// pessoa logada precisa conseguir checar ausência de quem quer que seja,
// só pra mostrar o aviso (sem anexar observações/motivo, que continuam só
// na tela de Usuários).
function canViewConfiguracoes(req) {
  if (req.user.role === 'super_admin') return true;
  const user = db.get('users').find({ id: req.user.id }).value();
  const access = (user && user.permissions && user.permissions.configuracoes) || 'none';
  return access === 'visualizar' || access === 'editor' || access === 'admin';
}

const TIPOS = ['ferias', 'afastamento', 'saida'];
const TIPO_LABEL = { ferias: 'Férias', afastamento: 'Afastamento', saida: 'Saída fora do horário' };

function str(v) { return (v || '').toString().trim(); }
function validDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }
function fmtDateBR(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

function serialize(a) {
  return Object.assign({}, a, {
    userName: resolveUserName(a.userId, a.userName),
    userPhoto: resolveUserPhoto(a.userId)
  });
}

// Comunicado automático em Recados (efeito em cascata #3 acima) -- mesma
// lógica de "recado sem dono humano" já usada pros avisos automáticos de
// aprovação/publicação (ver routes/recados.js), endereçado a TODA a
// equipe (não só a quem é afetado), pra funcionar como um mural de aviso
// geral mesmo.
function anunciarAusencia(ausencia) {
  const nome = resolveUserName(ausencia.userId, ausencia.userName);
  const primeiroNome = String(nome || '').trim().split(/\s+/)[0] || nome;
  let texto;
  if (ausencia.tipo === 'saida') {
    texto = `🕐 ${primeiroNome} vai sair mais cedo / fora do horário no dia ${fmtDateBR(ausencia.dataInicio)}.`;
  } else if (ausencia.tipo === 'afastamento') {
    texto = `😷 ${primeiroNome} estará afastado(a) de ${fmtDateBR(ausencia.dataInicio)} a ${fmtDateBR(ausencia.dataFim)}.`;
  } else {
    texto = `🏖️ ${primeiroNome} estará de férias de ${fmtDateBR(ausencia.dataInicio)} a ${fmtDateBR(ausencia.dataFim)}.`;
  }
  const allUserIds = db.get('users').value().map((u) => u.id);
  if (allUserIds.length === 0) return;
  createAutoRecado({ recipientIds: allUserIds, text: texto, kind: 'ausencia_anunciada' });
}

// Listagem completa, com observações (tela Usuários → aba Ausências).
router.get('/', requireAuth, (req, res) => {
  if (!canViewConfiguracoes(req)) {
    return res.status(403).json({ error: 'Essa área é restrita -- peça pro admin liberar o acesso em Configurações.' });
  }
  const rows = db.get('ausencias').value().slice().sort((a, b) => (b.dataInicio || '').localeCompare(a.dataInicio || ''));
  res.json({ ausencias: rows.map(serialize), canEdit: !!(req.user.role === 'super_admin') });
});

// Listagem enxuta (sem observações), aberta a qualquer pessoa logada --
// ver comentário acima.
router.get('/publicas', requireAuth, (req, res) => {
  const rows = db.get('ausencias').value().map((a) => ({
    id: a.id,
    userId: a.userId,
    tipo: a.tipo,
    dataInicio: a.dataInicio,
    dataFim: a.dataFim
  }));
  res.json({ ausencias: rows });
});

router.post('/', requireAuth, requireSuperAdmin, (req, res) => {
  const b = req.body || {};
  const userId = str(b.userId);
  const user = db.get('users').find({ id: userId }).value();
  if (!user) return res.status(400).json({ error: 'Escolha um(a) colaborador(a) válido(a).' });
  const tipo = TIPOS.includes(b.tipo) ? b.tipo : null;
  if (!tipo) return res.status(400).json({ error: 'Escolha o tipo da ausência.' });
  const dataInicio = validDate(b.dataInicio);
  if (!dataInicio) return res.status(400).json({ error: 'Informe a data de início.' });
  // "Saída fora do horário" é sempre de 1 dia só -- a data final some
  // sozinha na tela (ver $('#ausenciaFormTipo').onchange em app.js), mas
  // confere aqui também (nunca confiar só na tela).
  const dataFim = tipo === 'saida' ? dataInicio : (validDate(b.dataFim) || dataInicio);
  if (dataFim < dataInicio) return res.status(400).json({ error: 'A data final não pode ser antes da data de início.' });
  const now = new Date().toISOString();
  const ausencia = {
    id: nanoid(),
    userId,
    userName: user.name || user.username,
    tipo,
    dataInicio,
    dataFim,
    observacoes: str(b.observacoes),
    createdAt: now,
    createdBy: req.user.id,
    createdByName: req.user.name
  };
  db.get('ausencias').push(ausencia).write();
  logAudit({ user: req.user, entityType: 'ausencia', entityId: ausencia.id, entityLabel: `${TIPO_LABEL[tipo]} - ${ausencia.userName}`, action: 'create' });
  anunciarAusencia(ausencia);
  res.json({ ausencia: serialize(ausencia) });
});

router.put('/:id', requireAuth, requireSuperAdmin, (req, res) => {
  const existing = db.get('ausencias').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Ausência não encontrada.' });
  const b = req.body || {};
  const updates = {};
  if (b.userId !== undefined) {
    const user = db.get('users').find({ id: str(b.userId) }).value();
    if (!user) return res.status(400).json({ error: 'Escolha um(a) colaborador(a) válido(a).' });
    updates.userId = user.id;
    updates.userName = user.name || user.username;
  }
  if (b.tipo !== undefined) {
    if (!TIPOS.includes(b.tipo)) return res.status(400).json({ error: 'Tipo de ausência inválido.' });
    updates.tipo = b.tipo;
  }
  const effectiveTipo = updates.tipo || existing.tipo;
  if (b.dataInicio !== undefined) {
    const d = validDate(b.dataInicio);
    if (!d) return res.status(400).json({ error: 'Informe a data de início.' });
    updates.dataInicio = d;
  }
  if (effectiveTipo === 'saida') {
    updates.dataFim = updates.dataInicio || existing.dataInicio;
  } else if (b.dataFim !== undefined) {
    const d = validDate(b.dataFim);
    updates.dataFim = d || (updates.dataInicio || existing.dataInicio);
  }
  const effectiveInicio = updates.dataInicio || existing.dataInicio;
  const effectiveFim = updates.dataFim || existing.dataFim;
  if (effectiveFim < effectiveInicio) return res.status(400).json({ error: 'A data final não pode ser antes da data de início.' });
  if (b.observacoes !== undefined) updates.observacoes = str(b.observacoes);
  updates.updatedAt = new Date().toISOString();
  updates.updatedBy = req.user.id;
  updates.updatedByName = req.user.name;
  db.get('ausencias').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'ausencia', entityId: existing.id, entityLabel: TIPO_LABEL[effectiveTipo], action: 'update' });
  res.json({ ausencia: serialize(db.get('ausencias').find({ id: req.params.id }).value()) });
});

router.delete('/:id', requireAuth, requireSuperAdmin, (req, res) => {
  const existing = db.get('ausencias').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Ausência não encontrada.' });
  db.get('ausencias').remove({ id: req.params.id }).write();
  logAudit({ user: req.user, entityType: 'ausencia', entityId: existing.id, entityLabel: TIPO_LABEL[existing.tipo], action: 'delete' });
  res.json({ ok: true });
});

module.exports = router;
