// Teste de integração da 106ª rodada -- cobre os itens pedidos pela
// Raquel nesta rodada:
// - "em aunsencias adicionar Viagem a trabalho" -- novo tipo `viagem`
//   (período, igual Férias/Afastamento).
// - "o aviso de férias deve ser estará, quando as férias são no futuro ou
//   ainda estão acontecendo, e esteve quando já acabaram as férias" --
//   tense estará/esteve, testado em viagem (futura/passada/em andamento).
// - "Coloque tbm em ausencias o horário" -- horário de chegada/saída/
//   retorno, originalmente criado nesta rodada como um tipo novo
//   `jornada_incompleta` -- e CORRIGIDO ainda na própria 106ª/já na 107ª
//   rodada, a pedido da Raquel: os 3 campos de horário passam a viver
//   dentro do próprio tipo "Saída fora do horário" (`saida`), já existente,
//   totalmente OPCIONAIS (nada mais é obrigatório) -- ver seção 2 abaixo.
//   Mais uma regra da 107ª: essas saídas/chegadas fora do horário só
//   aparecem pra quem é gerente/coordenador/admin -- férias, afastamentos
//   e viagem continuam abertos pra equipe toda.
// - "o card que sai do pessoal e vai p geral e vice versa, quando ele tem
//   um card irmão, tudo que aconetce em um card deve acontecer no outro,
//   inclusive ir de pessoal p privado, mas sempre na lista da pessoa
//   maracda" -- sincronização de `visibility` entre demandas-irmãs
//   (vindas de um mesmo agendamento de redes sociais).
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-viagem-jornada-irmas-106';
process.env.PORT = '4374';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4374';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-viagem-jornada-irmas-106-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

const BASE = 'http://localhost:4374';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function run() {
  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  let adminToken;
  if (statusRes.needsSetup) {
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin 106', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
  } else {
    adminToken = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456' })
    }).then((r) => r.json()).then((d) => d.token);
  }
  const hAdmin = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };

  async function createUser(username, name, cargo) {
    const user = await fetch(`${BASE}/api/auth/users`, {
      method: 'POST', headers: hAdmin,
      body: JSON.stringify(cargo ? { username, password: '123456', name, cargo } : { username, password: '123456', name })
    }).then((r) => r.json()).then((d) => d.user);
    const token = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: '123456' })
    }).then((r) => r.json()).then((d) => d.token);
    return { user, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
  }

  // anunciarAusencia só grava o PRIMEIRO NOME de quem está ausente no
  // comunicado (ver routes/ausencias.js) -- por isso cada usuário de teste
  // precisa de um PRIMEIRO NOME ÚNICO (nunca "Usuária A"/"Usuário B", que
  // colidiriam no filtro abaixo, que também só compara o primeiro nome).
  const A = await createUser('userA106', 'ViagemFutura106 Pessoa');
  const B = await createUser('userB106', 'ViagemPassada106 Pessoa');
  const C = await createUser('userC106', 'ViagemAndamento106 Pessoa');
  const D = await createUser('userD106', 'QuartaPessoa106 Pessoa');
  async function ultimoRecadoDe(primeiroNome, as) {
    const headers = as || D.headers;
    const data = await fetch(`${BASE}/api/recados`, { headers }).then((r) => r.json());
    const doTipo = (data.recados || []).filter((r) => r.kind === 'ausencia_anunciada' && (r.text || '').includes(primeiroNome));
    return doTipo.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0] || null;
  }

  // Não existe GET /api/demandas/:id -- o jeito de checar o estado atual
  // de UM card é listar com o `scope` certo (geral/pessoal) e achar pelo
  // id, igual a tela faz.
  async function getDemanda(headers, scope, id) {
    const data = await fetch(`${BASE}/api/demandas?scope=${scope}`, { headers }).then((r) => r.json());
    return (data.demandas || []).find((d) => d.id === id) || null;
  }

  // ========== 1) Viagem a trabalho -- tense estará/esteve ==========

  // 1a) Viagem FUTURA -> "estará"
  await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hAdmin,
    body: JSON.stringify({ userId: A.user.id, tipo: 'viagem', dataInicio: addDays(30), dataFim: addDays(35) })
  }).then((r) => r.json());
  const recViagemFutura = await ultimoRecadoDe('ViagemFutura106');
  check('viagem futura: comunicado criado', !!recViagemFutura);
  check('viagem futura: usa "estará" (nunca "esteve")', !!recViagemFutura && recViagemFutura.text.includes('estará em viagem a trabalho') && !recViagemFutura.text.includes('esteve'));
  check('viagem futura: emoji ✈️', !!recViagemFutura && recViagemFutura.text.includes('✈️'));

  // 1b) Viagem JÁ ACABADA (passado) -> "esteve"
  await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hAdmin,
    body: JSON.stringify({ userId: B.user.id, tipo: 'viagem', dataInicio: addDays(-40), dataFim: addDays(-35) })
  }).then((r) => r.json());
  const recViagemPassada = await ultimoRecadoDe('ViagemPassada106');
  check('viagem já acabada: usa "esteve"', !!recViagemPassada && recViagemPassada.text.includes('esteve em viagem a trabalho'));

  // 1c) Viagem EM ANDAMENTO (começou, ainda não acabou) -> "estará" (não "esteve")
  await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hAdmin,
    body: JSON.stringify({ userId: C.user.id, tipo: 'viagem', dataInicio: addDays(-5), dataFim: addDays(5) })
  }).then((r) => r.json());
  const recViagemAndamento = await ultimoRecadoDe('ViagemAndamento106');
  check('viagem em andamento (ainda não acabou): usa "estará"', !!recViagemAndamento && recViagemAndamento.text.includes('estará em viagem a trabalho'));

  // 1d) Listagem pública mostra o tipo viagem corretamente
  const publicas = await fetch(`${BASE}/api/ausencias/publicas`, { headers: D.headers }).then((r) => r.json());
  check('GET /publicas lista as viagens cadastradas', (publicas.ausencias || []).filter((a) => a.tipo === 'viagem').length >= 3);

  // ========== 2) Saída fora do horário: horário opcional + verbo +
  //              visibilidade restrita (107ª rodada) ==========
  //
  // Correção da própria Raquel em cima da 106ª: o tipo "Jornada Incompleta"
  // criado nessa rodada foi um passo além do que ela pediu -- os exemplos
  // dela ("chegou às 8h"; "saiu às 15h e voltou às 16h"; "saiu às 16h sem
  // retorno") deixam claro que é tudo a MESMA "Saída fora do horário" de
  // sempre, só que agora com horário detalhado OPCIONAL. Esta seção testa
  // o tipo `saida` já com os 3 campos de horário, e a nova regra de
  // visibilidade ("só pra coordenadora, admin e gerente").

  // Usuária com cargo "coordenador", pra testar o lado "pode ver".
  const E = await createUser('userE107', 'CoordenadoraTeste107 Pessoa', 'coordenador');

  // 2a) Saída fora do horário SEM nenhum horário detalhado (uso simples, de
  // sempre, de antes da 106ª rodada existir) -- continua válido, sem exigir
  // nada (diferente da extinta "Jornada Incompleta", que exigia pelo menos
  // chegada OU saída).
  const saidaSimples = await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hAdmin,
    body: JSON.stringify({ userId: A.user.id, tipo: 'saida', dataInicio: addDays(10) })
  }).then((r) => r.json()).then((d) => d.ausencia);
  check('saída simples sem horário: aceita (horário não é mais obrigatório)', !!saidaSimples && saidaSimples.tipo === 'saida');
  check('saída simples: dataFim = dataInicio (1 dia só)', saidaSimples.dataFim === saidaSimples.dataInicio);
  check('saída simples: os 3 horários ficam null', saidaSimples.horaChegada === null && saidaSimples.horaSaida === null && saidaSimples.horaRetorno === null);
  const recSaidaSimples = await ultimoRecadoDe('ViagemFutura106', hAdmin);
  check('saída simples, no futuro: comunicado usa "vai sair mais cedo / fora do horário", sem parênteses', !!recSaidaSimples && recSaidaSimples.text.includes('vai sair mais cedo / fora do horário no dia') && !recSaidaSimples.text.includes('('));

  // 2b) Só CHEGADA fora do horário (exemplo literal da Raquel: "ela
  // precisou chegar às 08 da manhã") -- usa "chegou"/"vai chegar".
  const chegadaTarde = await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hAdmin,
    body: JSON.stringify({ userId: B.user.id, tipo: 'saida', dataInicio: addDays(10), horaChegada: '08:00' })
  }).then((r) => r.json()).then((d) => d.ausencia);
  check('só chegada: persiste horaChegada, horaSaida/horaRetorno ficam null', chegadaTarde.horaChegada === '08:00' && chegadaTarde.horaSaida === null && chegadaTarde.horaRetorno === null);
  const recChegadaTarde = await ultimoRecadoDe('ViagemPassada106', hAdmin);
  check('só chegada, no futuro: comunicado usa "vai chegar mais tarde / fora do horário" com "(chegou às 08:00)"', !!recChegadaTarde && recChegadaTarde.text.includes('vai chegar mais tarde / fora do horário') && recChegadaTarde.text.includes('(chegou às 08:00)'));

  // 2c) Saída + retorno, no PASSADO (exemplo literal da Raquel: "precisou
  // sair as 15:00 da empresa e retornou as 16:00").
  const saidaComRetorno = await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hAdmin,
    body: JSON.stringify({ userId: C.user.id, tipo: 'saida', dataInicio: addDays(-10), horaSaida: '15:00', horaRetorno: '16:00' })
  }).then((r) => r.json()).then((d) => d.ausencia);
  check('saída + retorno: persiste horaSaida e horaRetorno, horaChegada fica null', saidaComRetorno.horaChegada === null && saidaComRetorno.horaSaida === '15:00' && saidaComRetorno.horaRetorno === '16:00');
  const recSaidaComRetorno = await ultimoRecadoDe('ViagemAndamento106', hAdmin);
  check('saída + retorno, já no passado: comunicado usa "saiu mais cedo / fora do horário" com "(saiu às 15:00 e retornou às 16:00)"', !!recSaidaComRetorno && recSaidaComRetorno.text.includes('saiu mais cedo / fora do horário') && recSaidaComRetorno.text.includes('(saiu às 15:00 e retornou às 16:00)'));

  // 2d) Saída SEM retorno (exemplo literal da Raquel: "ou ainda, saiu as
  // 16:00. Sem retorno").
  const saidaSemRetorno = await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hAdmin,
    body: JSON.stringify({ userId: D.user.id, tipo: 'saida', dataInicio: addDays(-10), horaSaida: '16:00' })
  }).then((r) => r.json()).then((d) => d.ausencia);
  check('saída sem retorno: persiste só horaSaida', saidaSemRetorno.horaChegada === null && saidaSemRetorno.horaSaida === '16:00' && saidaSemRetorno.horaRetorno === null);
  const recSaidaSemRetorno = await ultimoRecadoDe('QuartaPessoa106', hAdmin);
  check('saída sem retorno, no passado: frase com 1 horário só, sem "e retornou"', !!recSaidaSemRetorno && recSaidaSemRetorno.text.includes('(saiu às 16:00)') && !recSaidaSemRetorno.text.includes('e retornou'));

  // 2e) Chegada + saída + retorno (os 3 horários juntos) -- junção com
  // vírgula + "e" antes do último, igual já era na extinta Jornada
  // Incompleta.
  const tresHorarios = await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hAdmin,
    body: JSON.stringify({ userId: E.user.id, tipo: 'saida', dataInicio: addDays(-10), horaChegada: '09:15', horaSaida: '11:00', horaRetorno: '13:45' })
  }).then((r) => r.json()).then((d) => d.ausencia);
  check('3 horários: persiste os 3', tresHorarios.horaChegada === '09:15' && tresHorarios.horaSaida === '11:00' && tresHorarios.horaRetorno === '13:45');
  const recTresHorarios = await ultimoRecadoDe('CoordenadoraTeste107', hAdmin);
  check('3 horários, no passado: frase junta com vírgula + "e" antes do último', !!recTresHorarios && recTresHorarios.text.includes('(chegou às 09:15, saiu às 11:00 e retornou às 13:45)'));

  // 2f) PUT: trocar tipo "saida" pra Férias deve limpar os horários
  const virouFerias = await fetch(`${BASE}/api/ausencias/${chegadaTarde.id}`, {
    method: 'PUT', headers: hAdmin,
    body: JSON.stringify({ tipo: 'ferias', dataInicio: chegadaTarde.dataInicio, dataFim: addDays(15) })
  }).then((r) => r.json()).then((d) => d.ausencia);
  check('virou Férias: tipo atualizado', virouFerias.tipo === 'ferias');
  check('virou Férias: horários antigos foram limpos (null)', virouFerias.horaChegada === null && virouFerias.horaSaida === null && virouFerias.horaRetorno === null);

  // 2g) PUT: editando uma "saida" existente, removendo TODOS os horários --
  // diferente da extinta Jornada Incompleta (que exigia pelo menos um e
  // dava 400), isso agora é PERMITIDO, porque horário nunca foi obrigatório
  // pra "Saída fora do horário".
  const saidaSemHoraNenhumaRes = await fetch(`${BASE}/api/ausencias/${saidaComRetorno.id}`, {
    method: 'PUT', headers: hAdmin,
    body: JSON.stringify({ horaChegada: '', horaSaida: '', horaRetorno: '' })
  });
  check('PUT saída zerando todos os horários: aceita (200), não é mais obrigatório ter horário', saidaSemHoraNenhumaRes.status === 200);
  const saidaSemHoraNenhuma = await saidaSemHoraNenhumaRes.json().then((d) => d.ausencia);
  check('PUT saída zerando horários: os 3 ficam null', saidaSemHoraNenhuma.horaChegada === null && saidaSemHoraNenhuma.horaSaida === null && saidaSemHoraNenhuma.horaRetorno === null);

  // 2h) Visibilidade restrita (pedido literal da Raquel: "todas as saidas
  // ou chegadas fora do horário devem aparecer apenas para coordenadora,
  // admim e gerente"): GET /publicas NÃO mostra nenhuma "saida" pra quem
  // não tem esse cargo (D não tem cargo nenhum cadastrado).
  const publicasComoD = await fetch(`${BASE}/api/ausencias/publicas`, { headers: D.headers }).then((r) => r.json());
  check('GET /publicas, visto por quem NÃO é coordenador/gerente/admin: nenhuma "saida" aparece', !(publicasComoD.ausencias || []).some((a) => a.tipo === 'saida'));
  check('GET /publicas, visto por quem NÃO é coordenador/gerente/admin: férias e viagem continuam aparecendo ("para a equipe toda")', (publicasComoD.ausencias || []).some((a) => a.tipo === 'viagem') && (publicasComoD.ausencias || []).some((a) => a.tipo === 'ferias'));

  // 2i) Visibilidade restrita: GET /publicas MOSTRA "saida" normalmente pra
  // quem É coordenador (E).
  const publicasComoCoordenadora = await fetch(`${BASE}/api/ausencias/publicas`, { headers: E.headers }).then((r) => r.json());
  check('GET /publicas, visto por coordenadora: "saida" aparece normalmente', (publicasComoCoordenadora.ausencias || []).some((a) => a.tipo === 'saida'));

  // 2j) Visibilidade restrita: o COMUNICADO (recado) de "saida" só vai pra
  // quem é gerente/coordenador/admin -- D (sem cargo) nunca recebe, mas a
  // coordenadora (E) recebe normalmente.
  const recSaidaComoD = await ultimoRecadoDe('CoordenadoraTeste107', D.headers);
  check('comunicado de "saida": quem NÃO é coordenador/gerente/admin não recebe', recSaidaComoD === null);
  const recSaidaComoCoordenadora = await ultimoRecadoDe('CoordenadoraTeste107', E.headers);
  check('comunicado de "saida": coordenadora recebe normalmente', !!recSaidaComoCoordenadora);

  // ========== 3) Demandas-irmãs: visibility sempre sincronizada ==========

  const post = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: A.headers,
    body: JSON.stringify({
      platform: 'tiktok', brand: 'duranox', scheduledDate: addDays(7),
      involvedUserIds: [A.user.id, B.user.id], responsibleId: A.user.id
    })
  }).then((r) => r.json()).then((d) => d.post);

  const demandasIniciais = await fetch(`${BASE}/api/demandas?scope=geral`, { headers: A.headers }).then((r) => r.json());
  const demA = demandasIniciais.demandas.find((d) => d.sourceSocialPostId === post.id && (d.assigneeIds || []).includes(A.user.id));
  const demB = demandasIniciais.demandas.find((d) => d.sourceSocialPostId === post.id && (d.assigneeIds || []).includes(B.user.id));
  check('agendamento criou 1 demanda-irmã pra A e 1 pra B, ambas no Geral', !!demA && !!demB && demA.visibility === 'geral' && demB.visibility === 'geral');

  // B pega a lista pessoal padrão ANTES de qualquer organização manual,
  // pra comparar depois que o card-irmão dele for movido sem ele mexer em nada.
  const listasDeB = await fetch(`${BASE}/api/demandas/personal-lists`, { headers: B.headers }).then((r) => r.json());
  const listaPadraoDeB = (listasDeB.lists || [])[0];

  // A move o PRÓPRIO card-irmão pra Pessoal -- espera que o de B siga.
  const demAmovida = await fetch(`${BASE}/api/demandas/${demA.id}`, {
    method: 'PUT', headers: A.headers,
    body: JSON.stringify({ visibility: 'pessoal' })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('A moveu seu card-irmão pra Pessoal', demAmovida.visibility === 'pessoal');

  const demBdepois = await getDemanda(B.headers, 'pessoal', demB.id);
  check('card-irmão de B seguiu automaticamente pra Pessoal', !!demBdepois && demBdepois.visibility === 'pessoal');

  const pessoalDeB = await fetch(`${BASE}/api/demandas?scope=pessoal`, { headers: B.headers }).then((r) => r.json());
  const demBnaListaDeB = pessoalDeB.demandas.find((d) => d.id === demB.id);
  check('card-irmão de B aparece na Área Pessoal de B, na lista padrão DELE (sem precisar organizar nada)', !!demBnaListaDeB && !!listaPadraoDeB && demBnaListaDeB.personalListId === listaPadraoDeB.id);

  const geralDepoisDoMove = await fetch(`${BASE}/api/demandas?scope=geral`, { headers: D.headers }).then((r) => r.json());
  check('nenhum dos 2 cards-irmãos aparece mais no Quadro Geral pra quem não está marcado', !geralDepoisDoMove.demandas.some((d) => d.id === demA.id || d.id === demB.id));

  // Pessoa NOVA (D) entra no agendamento, grupo já está em "pessoal" -> nasce já em pessoal.
  await fetch(`${BASE}/api/social-posts/${post.id}`, {
    method: 'PUT', headers: A.headers,
    body: JSON.stringify({ involvedUserIds: [A.user.id, B.user.id, D.user.id] })
  }).then((r) => r.json());
  const pessoalDeD = await fetch(`${BASE}/api/demandas?scope=pessoal`, { headers: D.headers }).then((r) => r.json());
  const demD = pessoalDeD.demandas.find((d) => d.sourceSocialPostId === post.id);
  check('pessoa nova (D), entrando num grupo já em Pessoal, já nasce com o card em Pessoal', !!demD && demD.visibility === 'pessoal');

  // B (sem ser o criador original, só marcado) move de volta pra Geral -- espera propagar pra A e D também.
  const demBvoltouGeral = await fetch(`${BASE}/api/demandas/${demB.id}`, {
    method: 'PUT', headers: B.headers,
    body: JSON.stringify({ visibility: 'geral' })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('B moveu de volta pra Geral', demBvoltouGeral.visibility === 'geral');

  const demAvoltou = await getDemanda(A.headers, 'geral', demA.id);
  const demDvoltou = await getDemanda(D.headers, 'geral', demD.id);
  check('ao B mover de volta pra Geral, o card de A também voltou', !!demAvoltou && demAvoltou.visibility === 'geral');
  check('ao B mover de volta pra Geral, o card de D (que entrou depois) também voltou', !!demDvoltou && demDvoltou.visibility === 'geral');

  const geralFinal = await fetch(`${BASE}/api/demandas?scope=geral`, { headers: C.headers }).then((r) => r.json());
  check('os 3 cards-irmãos (A, B, D) aparecem de novo no Quadro Geral pra qualquer pessoa', [demA.id, demB.id, demD.id].every((id) => geralFinal.demandas.some((d) => d.id === id)));

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(1);
});
