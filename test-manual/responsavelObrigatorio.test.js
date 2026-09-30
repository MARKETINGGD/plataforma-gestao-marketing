// Teste de integração (servidor de verdade, mesmo padrão dos demais
// test-manual/*.test.js) da 78ª rodada -- pedido explícito da Raquel:
// "toda ação, demanda e afins sempre deve ter um responsável", depois
// confirmado por completo: "ao criar o agendamento, deve ser obrigatorio
// colocar o responsável (estrelinha), toda ação, demanda e afins sempre
// deve ter um responsável."
//
// Cobre:
//   1. POST /api/demandas exige responsibleId (dentre os assigneeIds).
//   2. PUT /api/demandas/:id não deixa "desmarcar" o responsável de uma
//      demanda que já tinha um (sem substituto) -- mas continua editável
//      normalmente se ela nunca teve um (dado antigo, antes da regra).
//   3. POST /api/social-posts exige responsibleId (dentre os
//      involvedUserIds).
//   4. Demanda criada automaticamente a partir de um agendamento
//      (createDemandCardsForNewInvolved) já nasce com responsável (a
//      própria pessoa envolvida), sem precisar perguntar nada.
//   5. POST /api/influencers/:id/posts (ação) exige responsibleId.
//   6. Agendamento criado automaticamente a partir de uma ação de
//      influencer herda o responsável da própria ação.
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-responsavel-obrigatorio';
process.env.PORT = '4335';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4335';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-responsavel-obrigatorio-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

async function run() {
  let failures = 0;
  function check(label, cond) {
    console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
    if (!cond) failures++;
  }

  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const BASE = 'http://localhost:4335';
  const db = require('../db');

  async function login(username, password) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then((r) => r.json());
    return res.token;
  }

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  let adminToken;
  if (statusRes.needsSetup) {
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin Teste', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
  } else {
    adminToken = await login('admin', '123456');
  }
  check('login/setup do admin devolveu token', !!adminToken);

  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }

  async function createUser(username, name) {
    const res = await fetch(`${BASE}/api/auth/users`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ username, password: '123456', name })
    }).then((r) => r.json());
    return res.user;
  }
  const ana1 = await createUser('ana1resp', 'Analista Um Resp');
  const ana2 = await createUser('ana2resp', 'Analista Dois Resp');
  check('2 usuários de teste criados', !!(ana1 && ana2));

  // ---------- 1. POST /api/demandas exige responsável ----------
  const semRespRes = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ title: 'Demanda sem responsável', assigneeIds: [ana1.id] })
  });
  check('POST demanda sem responsibleId -> 400', semRespRes.status === 400);

  const respForaRes = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ title: 'Demanda resp fora', assigneeIds: [ana1.id], responsibleId: ana2.id })
  });
  check('POST demanda com responsibleId fora dos assigneeIds -> 400', respForaRes.status === 400);

  const comRespRes = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ title: 'Demanda com responsável', assigneeIds: [ana1.id, ana2.id], responsibleId: ana1.id })
  }).then((r) => r.json());
  check('POST demanda com responsibleId válido -> criada com sucesso', comRespRes.demanda && comRespRes.demanda.responsibleId === ana1.id);

  // ---------- 2. PUT não deixa desmarcar responsável sem substituto ----------
  const semSubstitutoRes = await fetch(`${BASE}/api/demandas/${comRespRes.demanda.id}`, {
    method: 'PUT', headers: hj(adminToken),
    body: JSON.stringify({ assigneeIds: [ana2.id] }) // tira ana1 (responsável) da lista, sem escolher outro
  });
  check('PUT tirando o responsável da lista sem substituto -> 400', semSubstitutoRes.status === 400);

  const comSubstitutoRes = await fetch(`${BASE}/api/demandas/${comRespRes.demanda.id}`, {
    method: 'PUT', headers: hj(adminToken),
    body: JSON.stringify({ assigneeIds: [ana2.id], responsibleId: ana2.id })
  });
  check('PUT trocando o responsável por um substituto válido -> 200', comSubstitutoRes.status === 200);

  // Demanda ANTIGA (de antes da regra) simulada direto no banco, sem
  // responsibleId nenhum -- precisa continuar editável nos outros campos.
  const demandaAntiga = {
    id: 'demanda-legado-teste', title: 'Demanda legado sem responsável',
    status: 'a_fazer', visibility: 'geral', archived: false, assigneeIds: [ana1.id],
    labelIds: [], checklist: [], files: [], createdAt: new Date().toISOString(),
    createdBy: ana1.id, createdByName: ana1.name, updatedAt: new Date().toISOString()
  };
  db.get('demandas').push(demandaAntiga).write();
  const editaLegadoRes = await fetch(`${BASE}/api/demandas/${demandaAntiga.id}`, {
    method: 'PUT', headers: hj(adminToken),
    body: JSON.stringify({ title: 'Demanda legado editada' })
  });
  check('PUT em demanda legado (sem responsável) continua editável -- não trava o quadro antigo', editaLegadoRes.status === 200);

  // ---------- 3. POST /api/social-posts exige responsável ----------
  const postSemRespRes = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ brand: 'debacco', platform: 'instagram', scheduledDate: '2026-12-31', involvedUserIds: [ana1.id] })
  });
  check('POST agendamento sem responsibleId -> 400', postSemRespRes.status === 400);

  const postComRespRes = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ brand: 'debacco', platform: 'instagram', scheduledDate: '2026-12-31', involvedUserIds: [ana1.id, ana2.id], responsibleId: ana2.id })
  }).then((r) => r.json());
  check('POST agendamento com responsibleId válido -> criado com sucesso', postComRespRes.post && postComRespRes.post.responsibleId === ana2.id);

  // ---------- 4. Demanda auto-criada (Agendamento -> Demandas) já nasce com responsável ----------
  const demandasGeradas = db.get('demandas').value().filter((d) => d.sourceSocialPostId === postComRespRes.post.id);
  check('agendamento gerou 2 demandas (1 por pessoa envolvida)', demandasGeradas.length === 2);
  check('cada demanda auto-criada já nasce com responsável = a própria pessoa envolvida', demandasGeradas.every((d) => d.responsibleId === d.assigneeIds[0]));

  // ---------- 5. POST ação de Influencer exige responsável ----------
  const inf = await fetch(`${BASE}/api/influencers`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ brand: 'debacco', name: 'Influencer Teste Resp' })
  }).then((r) => r.json()).then((d) => d.influencer);

  const acaoSemRespRes = await fetch(`${BASE}/api/influencers/${inf.id}/posts`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ formato: 'Reels', rede: 'instagram', involvedUserIds: [ana1.id] })
  });
  check('POST ação de influencer sem responsibleId -> 400', acaoSemRespRes.status === 400);

  const acaoComRespRes = await fetch(`${BASE}/api/influencers/${inf.id}/posts`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ formato: 'Reels', rede: 'instagram', involvedUserIds: [ana1.id], responsibleId: ana1.id })
  }).then((r) => r.json());
  check('POST ação de influencer com responsibleId válido -> criada com sucesso', acaoComRespRes.post && acaoComRespRes.post.responsibleId === ana1.id);

  // ---------- 6. Agendamento gerado a partir da ação herda o responsável ----------
  const socialPostDaAcao = db.get('socialPosts').find({ id: acaoComRespRes.post.linkedSocialPostId }).value();
  check('agendamento gerado pela ação de influencer herda o responsável dela', !!socialPostDaAcao && socialPostDaAcao.responsibleId === ana1.id);

  // ---------- 7. Área Pessoal sem ninguém marcado -- quem criou vira responsável sozinha ----------
  const pessoalRes = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ title: 'Tarefa pessoal sem ninguém marcado', visibility: 'pessoal' })
  }).then((r) => r.json());
  check('demanda pessoal sem assigneeIds é aceita (não exige escolher ninguém)', !!pessoalRes.demanda);
  check('quem criou vira responsável sozinha nesse caso', pessoalRes.demanda && pessoalRes.demanda.responsibleId && pessoalRes.demanda.assigneeIds.length === 0);

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;

  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(process.exitCode);
}

run().catch((e) => {
  console.error(e);
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  process.exit(1);
});
