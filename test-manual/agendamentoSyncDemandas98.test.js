// Teste de integração (servidor de verdade, mesmo padrão dos demais
// test-manual/*.test.js) da 98ª rodada -- bug reportado pela Raquel:
//
//   "quando é criado algo em agendamento, ele vira uma demanda correto?
//   mas quando altero data de postagem lpa no agendamento, não esta
//   alterando na demanda criada por ele, n esta tendo essa covnersa
//   entre eles"
//
// Causa raiz: createDemandCardsForNewInvolved (routes/socialPosts.js) só
// grava título/descrição/dueDate/rede/marca na CRIAÇÃO do card -- uma
// edição posterior do agendamento (PUT /api/social-posts/:id) nunca
// refletia nas demandas-irmãs já criadas, porque nada chamava de volta
// nelas. Corrigido com syncLinkedDemandas (utils/demandCascade.js),
// chamada no PUT sempre que a edição toca em scheduledDate/subject/
// caption/platform/brand/postType -- os mesmos campos que alimentam a
// fórmula de título/descrição/dueDate/rede/marca do card.
//
// Cobre:
//   1. Mudar a data de postagem (scheduledDate) atualiza a dueDate E o
//      título (que embute a data) das 2 demandas-irmãs.
//   2. Mudar o Assunto (subject) atualiza o título das demandas-irmãs.
//   3. Mudar a rede (platform) atualiza o campo `network` das demandas.
//   4. Mudar a marca (brand) atualiza o campo `brand` das demandas.
//   5. Editar um campo que NÃO entra na fórmula (ex.: `link`) não mexe
//      em título/dueDate/rede/marca das demandas (sem update à toa).
//   6. Uma demanda já CONCLUÍDA/arquivada (histórico) NÃO é reaberta nem
//      alterada por uma edição posterior do agendamento de origem.
//   7. Demandas de um agendamento DIFERENTE não são afetadas (isolamento
//      por sourceSocialPostId).
//   8. Nenhum outro campo da demanda (status, assigneeIds, checklist,
//      comments) é mexido pela sincronização -- só os campos derivados
//      do post.
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-agendamento-sync-demandas-98';
process.env.PORT = '4360';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4360';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-agendamento-sync-demandas-98-test');
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

  const BASE = 'http://localhost:4360';
  const db = require('../db');

  async function login(username, password) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then((r) => r.json());
    return res.token;
  }
  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }

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

  const ana1 = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'ana1sd98', password: '123456', name: 'Ana Um Sync98' })
  }).then((r) => r.json()).then((d) => d.user);
  const ana2 = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'ana2sd98', password: '123456', name: 'Ana Dois Sync98' })
  }).then((r) => r.json()).then((d) => d.user);

  // ---------- Cria o agendamento (2 pessoas envolvidas -> 2 demandas) ----------
  const post = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({
      brand: 'debacco', platform: 'instagram', scheduledDate: '2026-11-01',
      subject: 'Assunto original 98', caption: 'legenda original',
      involvedUserIds: [ana1.id, ana2.id], responsibleId: ana1.id
    })
  }).then((r) => r.json()).then((d) => d.post);

  function demandasDoPost(postId) {
    return db.get('demandas').value().filter((d) => d.sourceSocialPostId === postId);
  }

  const demandasIniciais = demandasDoPost(post.id);
  check('agendamento gerou 2 demandas (1 por pessoa envolvida)', demandasIniciais.length === 2);
  check('demandas nascem com o título usando o assunto + data original', demandasIniciais.every((d) => d.title === 'Assunto original 98 · 2026-11-01'));
  check('demandas nascem com a dueDate = data original do agendamento', demandasIniciais.every((d) => d.dueDate === '2026-11-01'));
  check('demandas nascem com network/brand do agendamento', demandasIniciais.every((d) => d.network === 'instagram' && d.brand === 'debacco'));

  // ---------- 1. Mudar a data de postagem ----------
  await fetch(`${BASE}/api/social-posts/${post.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ scheduledDate: '2026-12-25' })
  });
  const demandasDepoisData = demandasDoPost(post.id);
  check('[98ª rodada] mudar scheduledDate atualiza a dueDate das demandas-irmãs', demandasDepoisData.every((d) => d.dueDate === '2026-12-25'));
  check('[98ª rodada] mudar scheduledDate atualiza o título (que embute a data)', demandasDepoisData.every((d) => d.title === 'Assunto original 98 · 2026-12-25'));

  // ---------- 2. Mudar o Assunto ----------
  await fetch(`${BASE}/api/social-posts/${post.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ subject: 'Assunto NOVO depois do ajuste' })
  });
  const demandasDepoisAssunto = demandasDoPost(post.id);
  check('[98ª rodada] mudar o Assunto atualiza o título das demandas-irmãs', demandasDepoisAssunto.every((d) => d.title === 'Assunto NOVO depois do ajuste · 2026-12-25'));

  // ---------- 3. Mudar a rede ----------
  await fetch(`${BASE}/api/social-posts/${post.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ platform: 'tiktok' })
  });
  const demandasDepoisRede = demandasDoPost(post.id);
  check('[98ª rodada] mudar a rede (platform) atualiza o campo network das demandas', demandasDepoisRede.every((d) => d.network === 'tiktok'));

  // ---------- 4. Mudar a marca ----------
  await fetch(`${BASE}/api/social-posts/${post.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ brand: 'ghelplus' })
  });
  const demandasDepoisMarca = demandasDoPost(post.id);
  check('[98ª rodada] mudar a marca (brand) atualiza o campo brand das demandas', demandasDepoisMarca.every((d) => d.brand === 'ghelplus'));

  // ---------- 5. Editar um campo que NÃO entra na fórmula ----------
  const antesDoLink = demandasDoPost(post.id).map((d) => ({ id: d.id, title: d.title, dueDate: d.dueDate, network: d.network, brand: d.brand }));
  await fetch(`${BASE}/api/social-posts/${post.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ link: 'https://exemplo.com/post-98' })
  });
  const depoisDoLink = demandasDoPost(post.id);
  check('[98ª rodada] editar um campo fora da fórmula (link) não mexe em título/dueDate/rede/marca das demandas',
    antesDoLink.every((antes) => {
      const depois = depoisDoLink.find((d) => d.id === antes.id);
      return depois && depois.title === antes.title && depois.dueDate === antes.dueDate && depois.network === antes.network && depois.brand === antes.brand;
    }));

  // ---------- 6. Demanda já concluída/arquivada não é reaberta/alterada ----------
  // Post com 1 pessoa só envolvida (de propósito -- com 2+ pessoas, concluir
  // UMA demanda-irmã já completa TODAS as outras do mesmo agendamento, regra
  // da 34ª rodada em cascadeCompleteDemandas; não dá pra ter 1 concluída e
  // outra ainda "viva" no MESMO agendamento ao mesmo tempo).
  const postB = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({
      brand: 'debacco', platform: 'instagram', scheduledDate: '2026-11-10',
      subject: 'Post B (vai ser concluído) 98', involvedUserIds: [ana1.id], responsibleId: ana1.id
    })
  }).then((r) => r.json()).then((d) => d.post);
  const demandaB = demandasDoPost(postB.id)[0];
  const tituloAntesDeConcluir = demandaB.title;
  await fetch(`${BASE}/api/demandas/${demandaB.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ status: 'concluida' })
  });
  const demandaBConcluida = db.get('demandas').find({ id: demandaB.id }).value();
  check('demanda marcada concluída (setup do caso 6)', demandaBConcluida.status === 'concluida' && demandaBConcluida.archived === true);

  await fetch(`${BASE}/api/social-posts/${postB.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ scheduledDate: '2027-01-15' })
  });
  const demandaBDepoisDaEdicao = db.get('demandas').find({ id: demandaB.id }).value();
  check('[98ª rodada] demanda já concluída/arquivada NÃO é alterada por uma edição posterior do agendamento',
    demandaBDepoisDaEdicao.title === tituloAntesDeConcluir && demandaBDepoisDaEdicao.dueDate === '2026-11-10' && demandaBDepoisDaEdicao.status === 'concluida');

  // ---------- 7. Isolamento: agendamento diferente não é afetado ----------
  const outroPost = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({
      brand: 'debacco', platform: 'instagram', scheduledDate: '2026-11-05',
      subject: 'Outro agendamento 98', involvedUserIds: [ana2.id], responsibleId: ana2.id
    })
  }).then((r) => r.json()).then((d) => d.post);
  const demandaOutroPostAntes = demandasDoPost(outroPost.id)[0];
  await fetch(`${BASE}/api/social-posts/${post.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ scheduledDate: '2027-02-02' })
  });
  const demandaOutroPostDepois = db.get('demandas').find({ id: demandaOutroPostAntes.id }).value();
  check('[98ª rodada] editar um agendamento não mexe nas demandas de OUTRO agendamento (isolamento por sourceSocialPostId)',
    demandaOutroPostDepois.dueDate === '2026-11-05' && demandaOutroPostDepois.title === demandaOutroPostAntes.title);

  // ---------- 8. Sincronização não mexe em status/assigneeIds/checklist/comments ----------
  // Post C próprio (ainda vivo, nunca concluído), separado do postB acima.
  const postC = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({
      brand: 'debacco', platform: 'instagram', scheduledDate: '2026-11-20',
      subject: 'Post C (continua vivo) 98', involvedUserIds: [ana2.id], responsibleId: ana2.id
    })
  }).then((r) => r.json()).then((d) => d.post);
  const demandaC = demandasDoPost(postC.id)[0];
  // POST /:id/checklist (rota dedicada) -- PUT /api/demandas/:id não aceita
  // `checklist` no corpo (só o POST de criação aceita montar um checklist
  // inteiro de uma vez; editar depois é sempre pelos endpoints próprios de
  // item, ver routes/demandas.js).
  await fetch(`${BASE}/api/demandas/${demandaC.id}/checklist`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ text: 'Conferir arte' })
  });
  const demandaCAntes = db.get('demandas').find({ id: demandaC.id }).value();
  await fetch(`${BASE}/api/social-posts/${postC.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ scheduledDate: '2027-03-03', subject: 'Post C ajustado 98' })
  });
  const demandaCDepois = db.get('demandas').find({ id: demandaC.id }).value();
  check('[98ª rodada] sincronização preserva status/assigneeIds/checklist da demanda (só mexe nos campos derivados do post)',
    demandaCDepois.status === demandaCAntes.status &&
    JSON.stringify(demandaCDepois.assigneeIds) === JSON.stringify(demandaCAntes.assigneeIds) &&
    demandaCDepois.checklist.length === 1 && demandaCDepois.checklist[0].text === 'Conferir arte' &&
    demandaCDepois.dueDate === '2027-03-03' && demandaCDepois.title === 'Post C ajustado 98 · 2027-03-03');

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(() => {
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(process.exitCode);
});
