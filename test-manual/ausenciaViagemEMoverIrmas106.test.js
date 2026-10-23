// Teste de integração da 106ª rodada -- cobre os itens pedidos pela
// Raquel nesta rodada:
// - "em aunsencias adicionar Viagem a trabalho" -- novo tipo `viagem`
//   (período, igual Férias/Afastamento).
// - "o aviso de férias deve ser estará, quando as férias são no futuro ou
//   ainda estão acontecendo, e esteve quando já acabaram as férias" --
//   tense estará/esteve, testado em viagem (futura/passada/em andamento).
// - "Coloque tbm em ausencias o horário, e adicione 'Jornada Incompleta'...
//   deve ter a opção de marcar, chegou tal hora ou saiu tal hora e caso
//   tenha retornado, retornou tal hora" -- novo tipo `jornada_incompleta`
//   com horaChegada/horaSaida/horaRetorno opcionais (pelo menos chegada OU
//   saída obrigatória), validação, persistência e frase do comunicado.
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

  async function createUser(username, name) {
    const user = await fetch(`${BASE}/api/auth/users`, {
      method: 'POST', headers: hAdmin,
      body: JSON.stringify({ username, password: '123456', name })
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

  // ========== 2) Jornada Incompleta ==========

  // 2a) Validação: nem chegada nem saída -> 400
  const jornadaInvalida = await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hAdmin,
    body: JSON.stringify({ userId: A.user.id, tipo: 'jornada_incompleta', dataInicio: addDays(10) })
  });
  check('jornada incompleta sem nenhum horário: recebe 400', jornadaInvalida.status === 400);

  // 2b) Só chegada + saída (sem retorno), no futuro -> "vai ter jornada incompleta" com "(chegou ... e saiu ...)"
  const jornadaFutura = await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hAdmin,
    body: JSON.stringify({ userId: A.user.id, tipo: 'jornada_incompleta', dataInicio: addDays(10), horaChegada: '10:00', horaSaida: '15:30' })
  }).then((r) => r.json()).then((d) => d.ausencia);
  check('jornada incompleta futura: dataFim = dataInicio (1 dia só)', jornadaFutura.dataFim === jornadaFutura.dataInicio);
  check('jornada incompleta futura: persiste horaChegada/horaSaida, horaRetorno null', jornadaFutura.horaChegada === '10:00' && jornadaFutura.horaSaida === '15:30' && jornadaFutura.horaRetorno === null);
  const recJornadaFutura = await ultimoRecadoDe('ViagemFutura106');
  check('jornada incompleta futura: comunicado usa "vai ter jornada incompleta"', !!recJornadaFutura && recJornadaFutura.text.includes('vai ter jornada incompleta'));
  check('jornada incompleta futura: frase junta chegada e saída com "e"', !!recJornadaFutura && recJornadaFutura.text.includes('(chegou às 10:00 e saiu às 15:30)'));

  // 2c) Chegada + saída + retorno (3 horários), no passado -> "teve jornada incompleta", junção com vírgula + "e"
  const jornadaPassadaComRetorno = await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hAdmin,
    body: JSON.stringify({ userId: B.user.id, tipo: 'jornada_incompleta', dataInicio: addDays(-10), horaChegada: '09:15', horaSaida: '11:00', horaRetorno: '13:45' })
  }).then((r) => r.json()).then((d) => d.ausencia);
  check('jornada incompleta passada: persiste os 3 horários', jornadaPassadaComRetorno.horaChegada === '09:15' && jornadaPassadaComRetorno.horaSaida === '11:00' && jornadaPassadaComRetorno.horaRetorno === '13:45');
  const recJornadaPassada = await ultimoRecadoDe('ViagemPassada106');
  check('jornada incompleta passada: comunicado usa "teve jornada incompleta"', !!recJornadaPassada && recJornadaPassada.text.includes('teve jornada incompleta'));
  check('jornada incompleta passada: frase com 3 horários usa vírgula + "e" antes do último', !!recJornadaPassada && recJornadaPassada.text.includes('(chegou às 09:15, saiu às 11:00 e retornou às 13:45)'));

  // 2d) PUT: trocar tipo pra Férias deve limpar os horários
  const virouFerias = await fetch(`${BASE}/api/ausencias/${jornadaFutura.id}`, {
    method: 'PUT', headers: hAdmin,
    body: JSON.stringify({ tipo: 'ferias', dataInicio: jornadaFutura.dataInicio, dataFim: addDays(15) })
  }).then((r) => r.json()).then((d) => d.ausencia);
  check('virou Férias: tipo atualizado', virouFerias.tipo === 'ferias');
  check('virou Férias: horários antigos foram limpos (null)', virouFerias.horaChegada === null && virouFerias.horaSaida === null && virouFerias.horaRetorno === null);

  // 2e) PUT: editando uma Jornada Incompleta existente, remover os 2 horários obrigatórios -> 400
  const jornadaSemHoraInvalida = await fetch(`${BASE}/api/ausencias/${jornadaPassadaComRetorno.id}`, {
    method: 'PUT', headers: hAdmin,
    body: JSON.stringify({ horaChegada: '', horaSaida: '' })
  });
  check('PUT jornada incompleta zerando chegada e saída: recebe 400', jornadaSemHoraInvalida.status === 400);

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
