// Teste de integração da 105ª rodada -- pedido da Raquel: "em demandas
// tem a area pessoal certo? deixe a possibilidade de quando quiser, tirar
// o card da area pessoal, e por na geral ou vice e versa". Confirma:
// - PUT /api/demandas/:id aceita `visibility` e troca o card entre
//   Quadro Geral <-> Área Pessoal a qualquer momento (antes só dava pra
//   escolher na criação).
// - Só quem criou ou está marcado pode mover (outra pessoa qualquer
//   recebe 403).
// - Mover Área Pessoal -> Geral sem ninguém marcado (tarefa solo comum
//   na Área Pessoal) marca automaticamente quem moveu como responsável,
//   senão o card ficava sem nenhuma coluna pra aparecer no Quadro Geral.
// - Dá pra mover Geral -> Pessoal e já escolher a lista pessoal de
//   destino na mesma chamada (`personalListId` junto com `visibility`).
// - O histórico do card registra a mudança.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-mover-scope-105';
process.env.PORT = '4372';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4372';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-mover-scope-105-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

const BASE = 'http://localhost:4372';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function run() {
  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  let adminToken;
  if (statusRes.needsSetup) {
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin 105', username: 'admin', password: '123456' })
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

  const A = await createUser('userA105', 'Usuária A 105');
  const B = await createUser('userB105', 'Usuário B 105');
  const C = await createUser('userC105', 'Pessoa de Fora 105');

  // ---------- 1) Pessoal, SEM ninguém marcado (tarefa solo) -> Geral ----------
  const solo = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: A.headers,
    body: JSON.stringify({ title: 'Tarefa solo 105 (pessoal -> geral)', visibility: 'pessoal', assigneeIds: [] })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('tarefa solo nasce sem ninguém marcado, responsável = quem criou', solo.assigneeIds.length === 0 && solo.responsibleId === A.user.id);

  const soloMovida = await fetch(`${BASE}/api/demandas/${solo.id}`, {
    method: 'PUT', headers: A.headers,
    body: JSON.stringify({ visibility: 'geral' })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('moveu pra Geral com sucesso', soloMovida.visibility === 'geral');
  check('ao virar Geral sem ninguém marcado, marca automaticamente quem moveu', soloMovida.assigneeIds.includes(A.user.id) && soloMovida.responsibleId === A.user.id);

  const geralList = await fetch(`${BASE}/api/demandas?scope=geral`, { headers: B.headers }).then((r) => r.json());
  check('card movido aparece pra QUALQUER pessoa logada no Quadro Geral', geralList.demandas.some((d) => d.id === solo.id));

  // ---------- 2) Geral com 2 marcados -> só criador/marcado pode mover; pessoa de fora não pode ----------
  const compartilhada = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: A.headers,
    body: JSON.stringify({ title: 'Demanda compartilhada 105', visibility: 'geral', assigneeIds: [A.user.id, B.user.id], responsibleId: A.user.id })
  }).then((r) => r.json()).then((d) => d.demanda);

  const negado = await fetch(`${BASE}/api/demandas/${compartilhada.id}`, {
    method: 'PUT', headers: C.headers,
    body: JSON.stringify({ visibility: 'pessoal' })
  });
  check('pessoa de fora (não criou, não foi marcada) recebe 403 ao tentar mover', negado.status === 403);
  const aindaGeral = await fetch(`${BASE}/api/demandas?scope=geral`, { headers: A.headers }).then((r) => r.json());
  check('card não foi movido pela tentativa negada (continua Geral)', aindaGeral.demandas.some((d) => d.id === compartilhada.id && d.visibility !== 'pessoal'));

  // ---------- 3) Geral -> Pessoal, escolhendo a lista de destino na mesma chamada ----------
  const novaLista = await fetch(`${BASE}/api/demandas/personal-lists`, {
    method: 'POST', headers: B.headers,
    body: JSON.stringify({ name: 'Lista nova 105' })
  }).then((r) => r.json()).then((d) => d.list);

  const movidaPraPessoal = await fetch(`${BASE}/api/demandas/${compartilhada.id}`, {
    method: 'PUT', headers: B.headers,
    body: JSON.stringify({ visibility: 'pessoal', personalListId: novaLista.id })
  }).then((r) => r.json()).then((d) => d.demanda);
  check('B (marcado, não criador) conseguiu mover pra Pessoal', movidaPraPessoal.visibility === 'pessoal');

  const pessoalDeB = await fetch(`${BASE}/api/demandas?scope=pessoal`, { headers: B.headers }).then((r) => r.json());
  const cardParaB = pessoalDeB.demandas.find((d) => d.id === compartilhada.id);
  check('já aparece na Área Pessoal de B, já na lista nova escolhida', !!cardParaB && cardParaB.personalListId === novaLista.id);

  const pessoalDeA = await fetch(`${BASE}/api/demandas?scope=pessoal`, { headers: A.headers }).then((r) => r.json());
  check('criador (A) também continua enxergando o card agora na Área Pessoal', pessoalDeA.demandas.some((d) => d.id === compartilhada.id));

  const geralDepois = await fetch(`${BASE}/api/demandas?scope=geral`, { headers: C.headers }).then((r) => r.json());
  check('card sumiu do Quadro Geral pra quem não está marcado nele', !geralDepois.demandas.some((d) => d.id === compartilhada.id));

  const pessoalDeC = await fetch(`${BASE}/api/demandas?scope=pessoal`, { headers: C.headers }).then((r) => r.json());
  check('pessoa de fora (C) também não enxerga o card na Área Pessoal de ninguém', !pessoalDeC.demandas.some((d) => d.id === compartilhada.id));

  // ---------- 4) Histórico registra a mudança ----------
  const historico = await fetch(`${BASE}/api/demandas/${compartilhada.id}/history`, { headers: A.headers }).then((r) => r.json());
  const entradaMovimento = (historico.history || historico.entries || []).find((h) => (h.details || '').includes('Área Pessoal'));
  check('histórico do card registra "movido para a Área Pessoal"', !!entradaMovimento);

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
