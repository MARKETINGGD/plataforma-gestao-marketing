const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { resolveUserName, resolveUserPhoto } = require('../utils/names');
// 158ª rodada: "horas negativas" (atraso/saída antecipada) reaproveita o
// MESMO horário de ponto já cadastrado por pessoa (47ª rodada,
// `pontoSchedule` em routes/auth.js, campos entradaManha/saidaFinal) --
// Raquel pediu "de acordo com os horarios de cada um que esta cadastrado
// no usuario", e esse campo já é exatamente isso, não precisa criar nada
// novo no cadastro do usuário (ver minutosNegativos() mais abaixo).
const { createAutoRecado } = require('./recados');
const shareLinks = require('../utils/shareLinks');
const { todaySaoPauloStr } = require('../utils/dateSaoPaulo');
const { nowSaoPaulo } = require('../utils/pontoReminders');

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
// 158ª rodada, pedido da Raquel: "adicionar a opção de licença médica
// (trocar o afastamento por esse) e licença maternidade". A CHAVE
// interna continua 'afastamento' de propósito -- registros antigos já
// salvos no banco (e toda a lógica de notificação por e-mail abaixo,
// que já checava `tipo === 'afastamento'`) continuam funcionando sem
// nenhuma migração de dados, só o RÓTULO visível muda pra "Licença
// Médica". 'licenca_maternidade' é tipo novo, mesmo comportamento de
// período (início/fim) que férias/licença médica/viagem já têm.
const TIPOS = ['ferias', 'afastamento', 'licenca_maternidade', 'viagem', 'saida'];
const TIPO_LABEL = { ferias: 'Férias', afastamento: 'Licença Médica', licenca_maternidade: 'Licença Maternidade', viagem: 'Viagem a trabalho', saida: 'Saída fora do horário' };
// Tipos de 1 dia só (a data final sempre acompanha a de início, campo
// "Data fim" nem aparece na tela -- ver updateAusenciaFimVisibility em
// app.js). Férias/Afastamento/Viagem continuam sendo um período.
const TIPOS_UM_DIA = ['saida'];

function str(v) { return (v || '').toString().trim(); }
function validDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }
// Horário (106ª/107ª rodada): "HH:MM", 24h. Usado só por "Saída fora do
// horário" -- os outros tipos nunca gravam nada aqui.
function validTime(v) { return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null; }
// 158ª rodada, ajuste pedido pela Raquel depois de testar: "meio período"
// deixou de ser um booleano único pro período inteiro -- agora é uma
// LISTA de dias específicos (dentro do próprio intervalo
// dataInicio..dataFim) que são meio período; os demais dias do período
// continuam dia cheio de férias. `meioDia` (booleano) continua existindo
// no objeto serializado só como campo DERIVADO (tem pelo menos 1 dia
// marcado?), pra não quebrar nada que já lia só esse booleano antes.
function validMeioDiaDatas(raw, inicio, fim) {
  if (!Array.isArray(raw)) return [];
  const unicos = new Set();
  raw.forEach((v) => {
    const d = validDate(v);
    if (d && d >= inicio && d <= fim) unicos.add(d);
  });
  return Array.from(unicos).sort();
}
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
    horaRetorno: a.horaRetorno || null,
    // 158ª rodada: "em casos de ferias deve ter a opção de colocar meio
    // dia apenas tbm" -- só faz sentido pra tipo 'ferias', sempre vazio
    // pros outros tipos (nunca gravado neles, ver POST/PUT abaixo).
    // Ajuste (mesma rodada, depois do teste da Raquel): virou lista de
    // dias específicos -- `meioDia` aqui é só um booleano DERIVADO.
    meioDiaDatas: Array.isArray(a.meioDiaDatas) ? a.meioDiaDatas : [],
    meioDia: Array.isArray(a.meioDiaDatas) && a.meioDiaDatas.length > 0
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
  // 110ª rodada, correção de bug: usava UTC pra saber "qual é o dia de
  // hoje" (`new Date().toISOString().slice(0, 10)`) -- perto da virada do
  // dia (a partir das 21h, horário de Brasília), o UTC já é o dia
  // seguinte, o que podia fazer o comunicado automático usar "esteve"
  // (passado) pra uma ausência que ainda não tinha acabado no horário de
  // Brasília. Trocado por `todaySaoPauloStr()` (utils/dateSaoPaulo.js).
  const hoje = todaySaoPauloStr();
  return (ausencia.dataFim || ausencia.dataInicio) < hoje;
}

// 158ª rodada, bug reportado pela Raquel depois de testar: um registro de
// "saída fora do horário" DO PRÓPRIO DIA (ex.: cadastrado às 10h, pra uma
// saída que já aconteceu às 09h17 da manhã) continuava usando o futuro
// ("vai sair"), porque `jaAcabou()` acima só compara DATA (dia inteiro),
// nunca horário -- "hoje" nunca é "< hoje", então nunca virava passado no
// mesmo dia, mesmo com os horários (chegou/saiu/retornou) já preenchidos
// de verdade (ou seja, já aconteceu). `jaAcabou()` continua intocada (e
// correta) pros outros 3 tipos, que são só de DIA inteiro, sem horário --
// esta função nova é só pro tipo 'saida', que tem horário de verdade pra
// comparar contra "agora".
function jaAcabouSaida(ausencia) {
  const agora = nowSaoPaulo();
  const dataRef = ausencia.dataInicio;
  if (dataRef < agora.dateStr) return true;
  if (dataRef > agora.dateStr) return false;
  // Mesmo dia de hoje: só considera "já aconteceu" se o horário relevante
  // (o mesmo que decide o verbo em `verboSaida()` -- chegada, se for só
  // chegada tarde; senão a saída) já passou da hora atual. Sem nenhum
  // horário preenchido (registro simples, sem detalhar), mantém o padrão
  // de sempre: só pela data, então hoje ainda conta como futuro/presente
  // ("vai sair"), igual já era antes desta correção.
  const soChegada = !!ausencia.horaChegada && !ausencia.horaSaida;
  const horaRelevante = soChegada ? ausencia.horaChegada : ausencia.horaSaida;
  if (!horaRelevante) return false;
  return horaRelevante <= agora.hhmm;
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

// Monta "(meio período no dia 10/12)" / "(meio período nos dias 10/12 e
// 12/12)" / "(meio período em 3 dias do período)" a partir de
// `meioDiaDatas` -- só faz sentido pra férias. 3+ dias vira contagem (em
// vez de listar todos) pra não deixar o comunicado gigante num período
// longo com muitos dias de meio período marcados.
function meioDiaDetalhes(ausencia) {
  const datas = Array.isArray(ausencia.meioDiaDatas) ? ausencia.meioDiaDatas : [];
  if (datas.length === 0) return '';
  if (datas.length === 1) return ` (meio período no dia ${fmtDateBR(datas[0])})`;
  if (datas.length === 2) return ` (meio período nos dias ${fmtDateBR(datas[0])} e ${fmtDateBR(datas[1])})`;
  return ` (meio período em ${datas.length} dias do período)`;
}

// ---------- horas negativas (158ª rodada) ----------
// Pedido da Raquel: "Quando chegou atrasado, saiu mais cedo, deve ter
// mostrar as horas que acumularam como negativas, de acordo com os
// horarios de cada um que esta cadastrado no usuario." -- o "horário
// cadastrado" já existe (pontoSchedule, 47ª rodada, ver import de
// PONTO_SLOTS acima): entradaManha/saidaFinal. Comparado só contra os
// registros do tipo 'saida' (único tipo que grava horaChegada/horaSaida/
// horaRetorno -- ver TIPOS_UM_DIA acima). Pessoa sem horário cadastrado
// (pontoSchedule null, mesmo caso da Raquel/Melissa que não batem ponto)
// não acumula nada -- não dá pra saber se chegou atrasada sem saber a que
// horas deveria ter chegado.
function toMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  return h * 60 + m;
}

// Minutos negativos de UM registro de 'saida': atraso na chegada (vs.
// entradaManha) + tempo fora durante o expediente (saiu e, se voltou,
// conta só o intervalo saída->retorno; se não voltou, conta até o
// horário de saída final cadastrado). Os 2 cálculos são independentes
// porque o mesmo registro pode ter os 2 ao mesmo tempo (ex.: chegou
// atrasado E saiu mais cedo no mesmo dia) -- ver horaDetalhes() acima,
// que já lida com qualquer combinação dos 3 campos.
function minutosNegativos(ausencia, pontoSchedule) {
  if (!ausencia || ausencia.tipo !== 'saida' || !pontoSchedule) return 0;
  let total = 0;
  const entrada = toMinutes(pontoSchedule.entradaManha);
  const chegou = toMinutes(ausencia.horaChegada);
  if (entrada !== null && chegou !== null && chegou > entrada) {
    total += chegou - entrada;
  }
  const saiu = toMinutes(ausencia.horaSaida);
  if (saiu !== null) {
    const retornou = toMinutes(ausencia.horaRetorno);
    if (retornou !== null && retornou > saiu) {
      // saiu e voltou no mesmo dia -- conta só o tempo que ficou fora.
      total += retornou - saiu;
    } else if (retornou === null) {
      // saiu e não voltou -- conta até o horário de saída final cadastrado
      // (se ela já saiu DEPOIS do horário normal, não é "mais cedo", não
      // soma nada).
      const saidaFinal = toMinutes(pontoSchedule.saidaFinal);
      if (saidaFinal !== null && saidaFinal > saiu) total += saidaFinal - saiu;
    }
  }
  return total;
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
  // 158ª rodada, bug reportado pela Raquel: 'saida' tem horário de
  // verdade pra comparar (ver jaAcabouSaida acima) -- os outros 3 tipos
  // são só de dia inteiro, continuam usando a comparação por data
  // (jaAcabou).
  const acabou = ausencia.tipo === 'saida' ? jaAcabouSaida(ausencia) : jaAcabou(ausencia);
  let texto;
  if (ausencia.tipo === 'saida') {
    texto = `🕐 ${primeiroNome} ${verboSaida(ausencia, acabou)} no dia ${fmtDateBR(ausencia.dataInicio)}${horaDetalhes(ausencia)}.`;
  } else if (ausencia.tipo === 'afastamento') {
    // 158ª rodada: rótulo virou "Licença Médica" -- texto do comunicado
    // acompanha (chave interna 'afastamento' continua igual, ver TIPOS).
    texto = `😷 ${primeiroNome} ${acabou ? 'esteve' : 'estará'} de licença médica de ${fmtDateBR(ausencia.dataInicio)} a ${fmtDateBR(ausencia.dataFim)}.`;
  } else if (ausencia.tipo === 'licenca_maternidade') {
    texto = `👶 ${primeiroNome} ${acabou ? 'esteve' : 'estará'} de licença maternidade de ${fmtDateBR(ausencia.dataInicio)} a ${fmtDateBR(ausencia.dataFim)}.`;
  } else if (ausencia.tipo === 'viagem') {
    texto = `✈️ ${primeiroNome} ${acabou ? 'esteve' : 'estará'} em viagem a trabalho de ${fmtDateBR(ausencia.dataInicio)} a ${fmtDateBR(ausencia.dataFim)}.`;
  } else {
    texto = `🏖️ ${primeiroNome} ${acabou ? 'esteve' : 'estará'} de férias de ${fmtDateBR(ausencia.dataInicio)} a ${fmtDateBR(ausencia.dataFim)}${meioDiaDetalhes(ausencia)}.`;
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
  // 109ª rodada, pedido literal da Raquel: "tbm quero poder enviar e-mail
  // de notificação para o email de cada membro da equipe- somente as
  // notificações de: afastamento, [...]" -- só "afastamento" dispara
  // e-mail (igual ao recado, broadcast pra toda a equipe); férias,
  // viagem e saída continuam só com recado + push, sem e-mail.
  createAutoRecado({
    recipientIds,
    text: texto,
    kind: 'ausencia_anunciada',
    emailSubject: ausencia.tipo === 'afastamento' ? `Afastamento: ${nome}` : undefined
  });
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
  const allUsers = db.get('users').value();
  const rows = db.get('ausencias').value()
    .filter((a) => a.tipo !== 'saida' || podeVerHorarioRestrito)
    .slice()
    .sort((a, b) => (b.dataInicio || '').localeCompare(a.dataInicio || ''));
  // 158ª rodada (2º pedido), pedido literal da Raquel: "naquela parte a
  // ausencias que aparece colaborador, tipo, inicio, fim, horario e
  // observações, adicione uma coluna de horas negativas, assim eu sei de
  // onde veio cada hora" -- cada linha de 'saida' passa a trazer os
  // minutos negativos DAQUELE registro específico (mesmo cálculo de
  // `minutosNegativos`, já usado no resumo agregado abaixo), pra ela
  // conseguir auditar visualmente o total "batendo" com a soma das
  // linhas. Só calcula pra quem já podia ver 'saida' mesmo (mesmo motivo
  // do filtro logo acima) -- não é informação nova se vazando.
  res.json({
    ausencias: rows.map((a) => {
      const s = serialize(a);
      if (podeVerHorarioRestrito && a.tipo === 'saida') {
        const user = allUsers.find((u) => u.id === a.userId);
        s.minutosNegativos = (user && user.pontoSchedule) ? minutosNegativos(a, user.pontoSchedule) : 0;
      }
      return s;
    }),
    canEdit: !!(req.user.role === 'super_admin')
  });
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
      dataFim: a.dataFim,
      // 158ª rodada (2º pedido): o aviso de "pessoa ausente" no topo de
      // cada card de demanda (ver renderKanban em app.js) reusa
      // `ausenciaBadgeLabel`, que mostra "(meio período)" pra férias de
      // meio-dia -- essa listagem enxuta não tinha esse campo (só a
      // completa, em `serialize` acima, tinha), então o aviso nunca
      // conseguia mostrar essa informação. Sem dado sensível nenhum aqui
      // (não é observação/texto livre, só datas), então não fere o
      // motivo de esta lista ser enxuta. Ajuste (mesma rodada): virou
      // lista de dias específicos -- manda a lista junto, não só o
      // booleano derivado, pra quem precisar saber QUAL dia.
      meioDiaDatas: Array.isArray(a.meioDiaDatas) ? a.meioDiaDatas : [],
      meioDia: Array.isArray(a.meioDiaDatas) && a.meioDiaDatas.length > 0
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
// Visibilidade: na 108ª rodada, por padrão de segurança (quem abre este
// link está DESLOGADO, nunca dá pra confirmar se é coordenador/gerente/
// admin), o link externo tinha sido feito pra NUNCA mostrar "saida"
// (saídas/chegadas fora do horário). Pedido explícito da Raquel, ainda
// na 108ª rodada, revertendo essa decisão: "preciso que a saida fora do
// horario apareça no link externo." -- o link público agora mostra
// TODOS os tipos, igual a listagem completa da aba Usuários, sem
// nenhum filtro por tipo.
router.get('/public/:token', (req, res) => {
  const link = shareLinks.findByToken(req.params.token);
  if (!link || link.resource !== 'ausencias') return res.status(404).json({ error: 'Link inválido ou desativado.' });
  const rows = db.get('ausencias').value()
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

// Resumo de horas negativas acumuladas por pessoa (158ª rodada) --
// mesma restrição de acesso que o resto do horário restrito ("saida"):
// só gerente/coordenador/admin, igual a `canViewHorarioRestrito` já
// documentado no topo deste arquivo. Soma TODOS os registros de 'saida'
// já cadastrados (sem corte por período -- mais simples, e evita
// "zerar" silenciosamente um acumulado que a Raquel ainda não tinha
// cobrado de ninguém; se ela quiser resetar/por período, dá pra ajustar
// depois). Gente sem nenhum atraso/saída antecipada fica de fora da
// lista (não aparece com 0).
router.get('/horas-negativas', requireAuth, (req, res) => {
  if (!canViewHorarioRestrito(req)) {
    return res.status(403).json({ error: 'Essa informação é restrita a gerente, coordenador(a) ou admin.' });
  }
  const allUsers = db.get('users').value();
  const saidas = db.get('ausencias').value().filter((a) => a.tipo === 'saida');
  const totals = {};
  saidas.forEach((a) => {
    const user = allUsers.find((u) => u.id === a.userId);
    if (!user || !user.pontoSchedule) return;
    const minutos = minutosNegativos(a, user.pontoSchedule);
    if (minutos <= 0) return;
    totals[a.userId] = (totals[a.userId] || 0) + minutos;
  });
  // 158ª rodada (2º pedido), pedido literal da Raquel: "Coloque a opção
  // de editar as horas negativas acumuladas" -- `ajusteMinutosNegativos`
  // é um AJUSTE manual por pessoa (pode ser negativo, pra descontar
  // horas já acertadas/pagas, ou positivo), somado ao total calculado
  // automaticamente a partir dos registros de 'saida' (que continua
  // intocado -- a tabela detalhada acima continua mostrando de onde cada
  // hora "automática" veio). Gente com ajuste salvo entra na lista mesmo
  // sem nenhuma 'saida' no momento (ex.: ajuste carregado de um acerto
  // anterior). Total final nunca fica negativo (não faz sentido mostrar
  // "horas negativas negativas").
  const userIdsComAjuste = allUsers.filter((u) => u.ajusteMinutosNegativos).map((u) => u.id);
  const todosUserIds = new Set([...Object.keys(totals), ...userIdsComAjuste]);
  const rows = Array.from(todosUserIds).map((userId) => {
    const user = allUsers.find((u) => u.id === userId);
    const autoMinutos = totals[userId] || 0;
    const ajusteMinutos = (user && user.ajusteMinutosNegativos) || 0;
    return {
      userId,
      userName: resolveUserName(userId, (user && (user.name || user.username)) || ''),
      autoMinutos,
      ajusteMinutos,
      minutosNegativos: Math.max(0, autoMinutos + ajusteMinutos)
    };
  }).sort((a, b) => b.minutosNegativos - a.minutosNegativos);
  res.json({ horasNegativas: rows });
});

// Edita o AJUSTE manual de horas negativas de uma pessoa (158ª rodada,
// 2º pedido) -- recebe o NOVO TOTAL desejado (não o ajuste em si, mais
// fácil pra ela: "quanto essa pessoa deve ter de horas negativas agora")
// e calcula sozinho o ajuste necessário por cima do total automático
// (`autoMinutos`, calculado igual ao de cima). Mesma restrição de acesso
// de criar/editar/excluir ausência (super admin de verdade).
router.put('/horas-negativas/:userId', requireAuth, requireSuperAdmin, (req, res) => {
  const user = db.get('users').find({ id: req.params.userId }).value();
  if (!user) return res.status(404).json({ error: 'Colaborador(a) não encontrado(a).' });
  const novoTotalMinutos = parseInt(req.body && req.body.novoTotalMinutos, 10);
  if (!Number.isFinite(novoTotalMinutos) || novoTotalMinutos < 0) {
    return res.status(400).json({ error: 'Informe um total válido (em minutos, 0 ou mais).' });
  }
  const saidas = db.get('ausencias').value().filter((a) => a.tipo === 'saida' && a.userId === user.id);
  const autoMinutos = user.pontoSchedule
    ? saidas.reduce((soma, a) => soma + minutosNegativos(a, user.pontoSchedule), 0)
    : 0;
  const ajusteMinutosNegativos = novoTotalMinutos - autoMinutos;
  db.get('users').find({ id: user.id }).assign({ ajusteMinutosNegativos }).write();
  logAudit({ user: req.user, entityType: 'ausencia', entityId: user.id, entityLabel: `Horas negativas de ${user.name || user.username}`, action: 'ajustar_horas_negativas' });
  res.json({ ok: true, autoMinutos, ajusteMinutosNegativos, minutosNegativos: Math.max(0, autoMinutos + ajusteMinutosNegativos) });
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
  // 158ª rodada: "meio dia" só existe pra férias -- nos outros tipos nunca
  // grava nada aqui, mesmo que venha algo no corpo (mesmo cuidado já usado
  // pros horários de 'saida' acima). Ajuste (mesma rodada, depois do
  // teste da Raquel): virou lista de dias específicos dentro do período.
  const meioDiaDatas = tipo === 'ferias' ? validMeioDiaDatas(b.meioDiaDatas, dataInicio, dataFim) : [];
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
    meioDiaDatas,
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
  // 158ª rodada: "meio dia" só pra férias -- virando outro tipo, qualquer
  // meio-dia que já existisse é limpo (mesmo padrão dos horários acima).
  // Ajuste (mesma rodada): virou lista de dias específicos -- revalida
  // contra o período EFETIVO (`effectiveInicio`/`effectiveFim`, já
  // calculados acima), não contra o período antigo, senão editar a data
  // do período junto com os dias de meio período na MESMA chamada podia
  // acabar barrando ou perdendo um dia que seria válido no período novo.
  if (effectiveTipo === 'ferias') {
    if (b.meioDiaDatas !== undefined) {
      updates.meioDiaDatas = validMeioDiaDatas(b.meioDiaDatas, effectiveInicio, effectiveFim);
    } else if (updates.dataInicio !== undefined || updates.dataFim !== undefined) {
      // Só a data mudou (sem mandar meioDiaDatas junto) -- revalida os
      // dias que já existiam contra o período novo, descartando os que
      // ficaram fora dele.
      updates.meioDiaDatas = validMeioDiaDatas(existing.meioDiaDatas, effectiveInicio, effectiveFim);
    }
  } else if (updates.tipo !== undefined) {
    updates.meioDiaDatas = [];
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
