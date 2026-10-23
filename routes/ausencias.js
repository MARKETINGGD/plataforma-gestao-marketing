const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { resolveUserName, resolveUserPhoto } = require('../utils/names');
const { createAutoRecado } = require('./recados');
const shareLinks = require('../utils/shareLinks');

const router = express.Router();

// Ausências (104ª rodada, pedido da Raquel): "adicione tbm, em usuários,
// uma aba com um calendário e nele deve ter a opção de cadastrar os dias
// de férias, afastamentos, saidas fora do horário de cada colaborador e
// nesse calendario deve mostrar quem estava ausente nasqueles dias."
// Mais 3 efeitos em cascata, implementados nesta mesma rodada:
//   1. Aviso na coluna da pessoa em Demandas quando ela está ausente HOJE
//      (ver `GET /publicas` abaixo + renderKanban() em app.js).
//   2. Aviso pra quem cria/edita uma demanda, se a entrega (dueDate) cai
//      durante a ausência de alguém marcado (checado no FRONT, com os
//      mesmos dados de `GET /publicas` -- ver $('#demCardSave').onclick
//      em app.js; é um aviso, não um bloqueio, então fica só no cliente).
//   3. Comunicado automático em Recados quando uma ausência nasce (ver
//      `anunciarAusencia` abaixo).
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
// na tela de Usuários) -- **com a restrição extra da 107ª rodada abaixo**.
function canViewConfiguracoes(req) {
  if (req.user.role === 'super_admin') return true;
  const user = db.get('users').find({ id: req.user.id }).value();
  const access = (user && user.permissions && user.permissions.configuracoes) || 'none';
  return access === 'visualizar' || access === 'editor' || access === 'admin';
}

// 107ª rodada, pedido literal da Raquel: "todas as saidas ou chegadas fora
// do horário devem aparecer apenas para coordenadora, admim e gerente.
// Para a equipe toda deve aparecer as ferias, afastamentos e viagem." --
// mesma regra de acesso já usada pro relatório Acompanhamento Equipe
// (`canViewTeamReport` em routes/demandas.js) e pra aprovar/reprovar na
// Prévia do Feed (`canApprove` em routes/socialPosts.js): admin da
// Plataforma OU cargo gerente/coordenador. Duplicada aqui (não importada)
// pelo mesmo motivo de sempre nesta base. Só vale pro tipo `saida` (ver
// TIPOS abaixo) -- férias/afastamento/viagem continuam abertos a todo
// mundo, exatamente como já eram.
function canViewHorarioRestrito(req) {
  if (req.user.role === 'super_admin') return true;
  const user = db.get('users').find({ id: req.user.id }).value();
  return !!user && (user.cargo === 'gerente' || user.cargo === 'coordenador');
}

// 106ª rodada, pedido da Raquel: novo tipo "Viagem a trabalho" -- mesmo
// comportamento de período (início/fim) que Férias/Afastamento já têm
// (só "Saída fora do horário" é sempre de 1 dia só, ver mais abaixo).
//
// 107ª rodada, correção da própria Raquel em cima da 106ª: o tipo novo
// "Jornada Incompleta" (criado na 106ª pra cobrir horário de chegada/
// saída/retorno) foi um passo a mais do que ela pediu -- ela deixou claro,
// com exemplos (chegou às 8h; saiu às 15h e voltou às 16h; saiu às 16h sem
// volta), que isso é tudo a MESMA coisa de sempre, "Saída fora do
// horário", só que agora podendo registrar o horário exato. Removido o
// tipo `jornada_incompleta` -- os 3 campos de horário (chegou/saiu/
// retornou) passam a pertencer ao próprio tipo `saida`, totalmente
// opcionais (nenhum é obrigatório -- um registro simples de "saiu fora do
// horário hoje", sem nenhum horário detalhado, continua válido, exatamente
// como antes da 106ª rodada existir).
const TIPOS = ['ferias', 'afastamento', 'viagem', 'saida'];
const TIPO_LABEL = { ferias: 'Férias', afastamento: 'Afastamento', viagem: 'Viagem a trabalho', saida: 'Saída fora do horário' };
// Tipos de 1 dia só (a data final sempre acompanha a de início, campo
// "Data fim" nem aparece na tela -- ver updateAusenciaFimVisibility em
// app.js). Férias/Afastamento/Viagem continuam sendo um período.
const TIPOS_UM_DIA = ['saida'];

function str(v) { return (v || '').toString().trim(); }
function validDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }
// Horário (106ª/107ª rodada): "HH:MM", 24h. Usado só por "Saída fora do
// horário" -- os outros tipos nunca gravam nada aqui.
function validTime(v) { return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null; }
function fmtDateBR(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

function serialize(a) {
  return Object.assign({}, a, {
    userName: resolveUserName(a.userId, a.userName),
    userPhoto: resolveUserPhoto(a.userId),
    horaChegada: a.horaChegada || null,
    horaSaida: a.horaSaida || null,
    horaRetorno: a.horaRetorno || null
  });
}

// Comunicado automático em Recados (efeito em cascata #3 acima) -- mesma
// lógica de "recado sem dono humano" já usada pros avisos automáticos de
// aprovação/publicação (ver routes/recados.js).
// 106ª rodada, pedido da Raquel: "o aviso de férias deve ser estará,
// quando as férias são no futuro ou ainda estão acontecendo, e esteve
// quando já acabaram as férias" -- antes o comunicado sempre usava o
// futuro ("estará"/"vai sair"), mesmo pra uma ausência cadastrada DEPOIS
// de já ter acabado (ex.: lançar um período antigo pra manter o
// histórico). Compara a data final (ou a única data, pra tipos de 1
// dia) com HOJE, no momento em que a ausência é cadastrada -- se já
// passou, usa o passado.
function jaAcabou(ausencia) {
  const hoje = new Date().toISOString().slice(0, 10);
  return (ausencia.dataFim || ausencia.dataInicio) < hoje;
}

// Monta "(chegou às 10:00, saiu às 15:00 e retornou às 16:30)" com só os
// horários que foram de fato preenchidos -- "Saída fora do horário" aceita
// qualquer combinação (só saída cedo, só chegada tarde, ou os 2 + volta).
function horaDetalhes(ausencia) {
  const partes = [];
  if (ausencia.horaChegada) partes.push(`chegou às ${ausencia.horaChegada}`);
  if (ausencia.horaSaida) partes.push(`saiu às ${ausencia.horaSaida}`);
  if (ausencia.horaRetorno) partes.push(`retornou às ${ausencia.horaRetorno}`);
  if (partes.length === 0) return '';
  if (partes.length === 1) return ` (${partes[0]})`;
  return ` (${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]})`;
}

// 107ª rodada: com "chegou tal hora" e "saiu tal hora" vivendo agora no
// mesmo tipo `saida`, o verbo do comunicado muda conforme o que foi
// preenchido -- só horário de CHEGADA (chegou mais tarde, sem ter saído
// antes) usa "chegou"/"vai chegar"; qualquer outra combinação (saída
// cedo, com ou sem retorno, ou nenhum horário detalhado -- o registro
// simples de sempre) usa "saiu"/"vai sair", como já era.
function verboSaida(ausencia, acabou) {
  const soChegada = !!ausencia.horaChegada && !ausencia.horaSaida;
  if (soChegada) return acabou ? 'chegou mais tarde / fora do horário' : 'vai chegar mais tarde / fora do horário';
  return acabou ? 'saiu mais cedo / fora do horário' : 'vai sair mais cedo / fora do horário';
}

function anunciarAusencia(ausencia) {
  const nome = resolveUserName(ausencia.userId, ausencia.userName);
  const primeiroNome = String(nome || '').trim().split(/\s+/)[0] || nome;
  const acabou = jaAcabou(ausencia);
  let texto;
  if (ausencia.tipo === 'saida') {
    texto = `🕐 ${primeiroNome} ${verboSaida(ausencia, acabou)} no dia ${fmtDateBR(ausencia.dataInicio)}${horaDetalhes(ausencia)}.`;
  } else if (ausencia.tipo === 'afastamento') {
    texto = `😷 ${primeiroNome} ${acabou ? 'esteve' : 'estará'} afastado(a) de ${fmtDateBR(ausencia.dataInicio)} a ${fmtDateBR(ausencia.dataFim)}.`;
  } else if (ausencia.tipo === 'viagem') {
    texto = `✈️ ${primeiroNome} ${acabou ? 'esteve' : 'estará'} em viagem a trabalho de ${fmtDateBR(ausencia.dataInicio)} a ${fmtDateBR(ausencia.dataFim)}.`;
  } else {
    texto = `🏖️ ${primeiroNome} ${acabou ? 'esteve' : 'estará'} de férias de ${fmtDateBR(ausencia.dataInicio)} a ${fmtDateBR(ausencia.dataFim)}.`;
  }
  // 107ª rodada, pedido literal da Raquel: "todas as saidas ou chegadas
  // fora do horário devem aparecer apenas para coordenadora, admim e
  // gerente. Para a equipe toda deve aparecer as ferias, afastamentos e
  // viagem." -- o comunicado de `saida` vai só pra quem tem cargo
  // gerente/coordenador (ou é super admin); os outros 3 tipos continuam
  // em broadcast pra toda a equipe, como sempre foi.
  // `db.get('users')` devolve os registros CRUS do banco -- aqui o campo é
  // `isSuperAdmin` (booleano), não `role` (que só existe no token JWT,
  // montado em routes/auth.js na hora do login). Usar `.role` aqui nunca
  // bateria com nada e o comunicado de "saida" não iria pra ninguém, nem
  // pro super admin de verdade.
  const allUsers = db.get('users').value();
  const recipientIds = ausencia.tipo === 'saida'
    ? allUsers.filter((u) => u.isSuperAdmin || u.cargo === 'gerente' || u.cargo === 'coordenador').map((u) => u.id)
    : allUsers.map((u) => u.id);
  if (recipientIds.length === 0) return;
  createAutoRecado({ recipientIds, text: texto, kind: 'ausencia_anunciada' });
}

// Listagem completa, com observações (tela Usuários → aba Ausências).
// 107ª rodada: dentro dessa listagem (já restrita por `configuracoes`),
// os registros do tipo `saida` são filtrados de novo, só pra quem tem
// cargo gerente/coordenador ou é super admin -- alguém com só
// `configuracoes: visualizar` (sem ser gerente/coordenador/admin) vê
// férias/afastamento/viagem normalmente, mas não vê nenhuma saída/
// chegada fora do horário.
router.get('/', requireAuth, (req, res) => {
  if (!canViewConfiguracoes(req)) {
    return res.status(403).json({ error: 'Essa área é restrita -- peça pro admin liberar o acesso em Configurações.' });
  }
  const podeVerHorarioRestrito = canViewHorarioRestrito(req);
  const rows = db.get('ausencias').value()
    .filter((a) => a.tipo !== 'saida' || podeVerHorarioRestrito)
    .slice()
    .sort((a, b) => (b.dataInicio || '').localeCompare(a.dataInicio || ''));
  res.json({ ausencias: rows.map(serialize), canEdit: !!(req.user.role === 'super_admin') });
});

// Listagem enxuta (sem observações), aberta a qualquer pessoa logada --
// ver comentário acima. 107ª rodada: mesma restrição de `saida` da
// listagem completa -- quem não é gerente/coordenador/admin nunca recebe
// os registros de saída/chegada fora do horário nesta lista, então nem o
// aviso na coluna do Kanban nem o aviso de conflito ao marcar entrega
// (ambos em app.js, alimentados por esta rota) chegam a aparecer pra
// quem não deveria ver.
router.get('/publicas', requireAuth, (req, res) => {
  const podeVerHorarioRestrito = canViewHorarioRestrito(req);
  const rows = db.get('ausencias').value()
    .filter((a) => a.tipo !== 'saida' || podeVerHorarioRestrito)
    .map((a) => ({
      id: a.id,
      userId: a.userId,
      tipo: a.tipo,
      dataInicio: a.dataInicio,
      dataFim: a.dataFim
    }));
  res.json({ ausencias: rows });
});

// ---------- link externo (108ª rodada, pedido literal da Raquel: "a aba
// das ausencias, deve ter um link externo de compartilhamento, que
// apareça o calendario e a explicação, exatamente como ela esta hoje na
// plataforma.") ----------
// Mesmo mecanismo genérico já usado em Budget/Feiras/Brindes/Campanha
// Cooperada/Expositores/Concorrência (ver utils/shareLinks.js) -- só
// "leitura" (não faz sentido editar ausência sem login). Sem escopo por
// marca/pessoa (o calendário é de toda a equipe, sempre o mesmo pra
// qualquer um que acesse a aba dentro da Papoi) -- `scopeKey` fixo
// 'geral', só pra reaproveitar as mesmas 3 funções genéricas sem
// reescrever nada.
//
// **Precisa ficar ANTES de qualquer rota com `/:id`** -- mesmo motivo já
// documentado em routes/feiras.js/routes/budget.js (Express casaria
// "/public-link" com "/:id", id="public-link"). Este arquivo só tem
// `/:id` no PUT/DELETE lá embaixo, então a ordem aqui é só por clareza.
//
// Visibilidade (107ª rodada) se aplica com mais força ainda aqui: quem
// abre este link está DESLOGADO -- nunca dá pra saber se é coordenador/
// gerente/admin. Por isso o link externo NUNCA mostra "saida" (saídas/
// chegadas fora do horário), mesmo que quem gerou o link seja
// coordenador/gerente/admin -- só férias/afastamento/viagem, que já são
// abertos à equipe toda mesmo dentro da Papoi.
router.get('/public/:token', (req, res) => {
  const link = shareLinks.findByToken(req.params.token);
  if (!link || link.resource !== 'ausencias') return res.status(404).json({ error: 'Link inválido ou desativado.' });
  const rows = db.get('ausencias').value()
    .filter((a) => a.tipo !== 'saida')
    .slice()
    .sort((a, b) => (b.dataInicio || '').localeCompare(a.dataInicio || ''));
  res.json({ ausencias: rows.map(serialize) });
});
router.get('/public-link', requireAuth, requireSuperAdmin, (req, res) => {
  const link = shareLinks.getLink('ausencias', 'geral');
  res.json({ publicToken: link ? link.token : null });
});
router.post('/public-link/generate', requireAuth, requireSuperAdmin, (req, res) => {
  const token = shareLinks.generateLink('ausencias', 'geral', req);
  logAudit({ user: req.user, entityType: 'shareLink', entityId: 'ausencias:geral', entityLabel: 'Ausências', action: 'generate_public_link' });
  res.json({ publicToken: token });
});
router.delete('/public-link', requireAuth, requireSuperAdmin, (req, res) => {
  shareLinks.revokeLink('ausencias', 'geral');
  logAudit({ user: req.user, entityType: 'shareLink', entityId: 'ausencias:geral', entityLabel: 'Ausências', action: 'revoke_public_link' });
  res.json({ ok: true });
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
  const dataFim = TIPOS_UM_DIA.includes(tipo) ? dataInicio : (validDate(b.dataFim) || dataInicio);
  if (dataFim < dataInicio) return res.status(400).json({ error: 'A data final não pode ser antes da data de início.' });
  // Horários (106ª/107ª rodada) -- só "Saída fora do horário" usa, e são
  // totalmente OPCIONAIS (um registro simples, sem detalhar horário,
  // continua válido -- nenhuma obrigatoriedade nova); os outros tipos
  // nunca gravam nada aqui, mesmo que venha algo no corpo.
  const horaChegada = tipo === 'saida' ? validTime(b.horaChegada) : null;
  const horaSaida = tipo === 'saida' ? validTime(b.horaSaida) : null;
  const horaRetorno = tipo === 'saida' ? validTime(b.horaRetorno) : null;
  const now = new Date().toISOString();
  const ausencia = {
    id: nanoid(),
    userId,
    userName: user.name || user.username,
    tipo,
    dataInicio,
    dataFim,
    horaChegada,
    horaSaida,
    horaRetorno,
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
  if (TIPOS_UM_DIA.includes(effectiveTipo)) {
    updates.dataFim = updates.dataInicio || existing.dataInicio;
  } else if (b.dataFim !== undefined) {
    const d = validDate(b.dataFim);
    updates.dataFim = d || (updates.dataInicio || existing.dataInicio);
  }
  const effectiveInicio = updates.dataInicio || existing.dataInicio;
  const effectiveFim = updates.dataFim || existing.dataFim;
  if (effectiveFim < effectiveInicio) return res.status(400).json({ error: 'A data final não pode ser antes da data de início.' });
  // Horários (106ª/107ª rodada): só valem pra "Saída fora do horário" --
  // virando outro tipo, qualquer horário que já existisse é limpo (não
  // faz sentido um "Afastamento" guardar hora de chegada, por exemplo).
  // Opcionais -- nenhum é obrigatório.
  if (effectiveTipo === 'saida') {
    if (b.horaChegada !== undefined) updates.horaChegada = validTime(b.horaChegada);
    if (b.horaSaida !== undefined) updates.horaSaida = validTime(b.horaSaida);
    if (b.horaRetorno !== undefined) updates.horaRetorno = validTime(b.horaRetorno);
  } else if (updates.tipo !== undefined) {
    updates.horaChegada = null;
    updates.horaSaida = null;
    updates.horaRetorno = null;
  }
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
