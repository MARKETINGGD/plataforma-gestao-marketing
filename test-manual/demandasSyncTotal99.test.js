// Teste de integração (servidor de verdade, mesmo padrão dos demais
// test-manual/*.test.js) da 99ª rodada -- pedido explícito da Raquel:
//
//   "a mudança deve ocorrer em todos os cards de demandas irmãs vindas do
//   agendamento. Essa mudança pode ser feita pelo agendamento ou pelas
//   demandas, deve atualizar para todo mundo. Checklist, comentarios,
//   arquivos, cor do card, repsonsavel e todoa os status, devem mudar
//   para todo tbm. Quando uma demanda, independente de onde ela veio, tem
//   mudanças, isso sempre deve refletir no card de todos que estão ali,
//   assim todos terão sempre as mesmas informações."
//
// Expande a sincronização que até a 98ª rodada só existia na direção
// Agendamento -> Demandas (e só pra título/dueDate/rede/marca, e só pra
// demandas ainda "vivas") pra uma sincronização TOTAL entre todas as
// demandas-irmãs (mesmo sourceSocialPostId): qualquer uma editada (ou o
// próprio agendamento) propaga pra todas as outras, em QUALQUER status,
// cobrindo também checklist, comentários, arquivos, cor, link, etiquetas,
// checklistTitle e responsável. Uma pessoa nova marcada num agendamento
// que já tem demandas-irmãs também nasce herdando esse estado compartilhado.
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-demandas-sync-total-99';
process.env.PORT = '4361';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4361';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-demandas-sync-total-99-test');
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

  const BASE = 'http://localhost:4361';
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
    body: JSON.stringify({ username: 'ana1st99', password: '123456', name: 'Ana Um Sync99' })
  }).then((r) => r.json()).then((d) => d.user);
  const ana2 = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'ana2st99', password: '123456', name: 'Ana Dois Sync99' })
  }).then((r) => r.json()).then((d) => d.user);
  const ana3 = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'ana3st99', password: '123456', name: 'Ana Tres Sync99' })
  }).then((r) => r.json()).then((d) => d.user);

  function demandasDoPost(postId) {
    return db.get('demandas').value().filter((d) => d.sourceSocialPostId === postId);
  }

  // ---------- Setup: agendamento com 2 pessoas -> 2 demandas-irmãs ----------
  const post = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({
      brand: 'debacco', platform: 'instagram', scheduledDate: '2026-11-01',
      subject: 'Material 99', caption: 'legenda',
      involvedUserIds: [ana1.id, ana2.id], responsibleId: ana1.id
    })
  }).then((r) => r.json()).then((d) => d.post);

  const [demA, demB] = demandasDoPost(post.id);
  check('agendamento gerou 2 demandas-irmãs', !!demA && !!demB);

  // ---------- 1. Editar STATUS direto numa demanda (não concluída) propaga pra irmã ----------
  await fetch(`${BASE}/api/demandas/${demA.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ status: 'em_revisao' })
  });
  const demBApósStatus = db.get('demandas').find({ id: demB.id }).value();
  check('[99ª rodada] mudar o status de UMA demanda-irmã (sem ser concluída) propaga pra todas as outras',
    demBApósStatus.status === 'em_revisao');

  // ---------- 2. Cor do card ----------
  await fetch(`${BASE}/api/demandas/${demA.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ color: '#ff00aa' })
  });
  check('[99ª rodada] cor do card sincroniza entre demandas-irmãs',
    db.get('demandas').find({ id: demB.id }).value().color === '#ff00aa');

  // ---------- 3. Responsável ----------
  await fetch(`${BASE}/api/demandas/${demA.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ responsibleId: ana2.id })
  });
  const demAApósResp = db.get('demandas').find({ id: demA.id }).value();
  const demBApósResp = db.get('demandas').find({ id: demB.id }).value();
  check('[99ª rodada] responsável sincroniza entre demandas-irmãs, mesmo quando a pessoa não está marcada NESSE card específico',
    demAApósResp.responsibleId === ana2.id && demBApósResp.responsibleId === ana2.id);

  // ---------- 4. Checklist (adicionar, marcar, remover) ----------
  const addRes = await fetch(`${BASE}/api/demandas/${demA.id}/checklist`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ text: 'Revisar arte' })
  }).then((r) => r.json());
  const itemId = addRes.demanda.checklist[0].id;
  const demBApósAddItem = db.get('demandas').find({ id: demB.id }).value();
  check('[99ª rodada] item novo de checklist aparece na demanda-irmã', demBApósAddItem.checklist.length === 1 && demBApósAddItem.checklist[0].text === 'Revisar arte');

  await fetch(`${BASE}/api/demandas/${demA.id}/checklist/${itemId}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ done: true })
  });
  const demBApósMarcarItem = db.get('demandas').find({ id: demB.id }).value();
  check('[99ª rodada] marcar item de checklist como concluído sincroniza (inclusive doneAt) na demanda-irmã',
    demBApósMarcarItem.checklist[0].done === true && !!demBApósMarcarItem.checklist[0].doneAt);

  await fetch(`${BASE}/api/demandas/${demA.id}/checklist/${itemId}`, { method: 'DELETE', headers: hj(adminToken) });
  const demBApósRemoverItem = db.get('demandas').find({ id: demB.id }).value();
  check('[99ª rodada] remover item de checklist também remove na demanda-irmã', demBApósRemoverItem.checklist.length === 0);

  // ---------- 5. Comentários ----------
  await fetch(`${BASE}/api/demandas/${demA.id}/comments`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ text: 'comentário de teste 99' })
  });
  const histB = await fetch(`${BASE}/api/demandas/${demB.id}/history`, { headers: hj(adminToken) }).then((r) => r.json());
  check('[99ª rodada] comentário feito numa demanda-irmã aparece no histórico da outra',
    histB.history.some((h) => h.action === 'comment' && h.details === 'comentário de teste 99'));

  // ---------- 6. Arquivos (upload e remoção) ----------
  const FormData = globalThis.FormData;
  const form = new FormData();
  form.append('file', new Blob(['conteudo de teste'], { type: 'text/plain' }), 'teste99.txt');
  const uploadRes = await fetch(`${BASE}/api/demandas/${demA.id}/files`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: form
  }).then((r) => r.json());
  const demBApósUpload = db.get('demandas').find({ id: demB.id }).value();
  check('[99ª rodada] arquivo enviado numa demanda-irmã aparece na lista de arquivos da outra',
    demBApósUpload.files.length === 1 && demBApósUpload.files[0].name === 'teste99.txt');
  const fileId = uploadRes.demanda.files[0].id;
  const fileUrl = uploadRes.demanda.files[0].url;
  const filePathFísico = path.join(__dirname, '..', 'data', 'uploads', 'demandas', demA.id, path.basename(fileUrl));
  check('[99ª rodada] arquivo físico foi salvo na pasta de quem recebeu o upload', fs.existsSync(filePathFísico));

  // Apaga pela demanda-IRMÃ (demB), não pela que recebeu o upload -- cobre o
  // bug que seria introduzido se a exclusão tentasse achar o arquivo físico
  // na pasta de demB (que nunca existiu) em vez da pasta real (demA).
  await fetch(`${BASE}/api/demandas/${demB.id}/files/${fileId}`, { method: 'DELETE', headers: hj(adminToken) });
  const demAApósDeleteArquivo = db.get('demandas').find({ id: demA.id }).value();
  check('[99ª rodada] apagar um arquivo por uma demanda-irmã remove da lista de TODAS (inclusive de quem recebeu o upload)',
    demAApósDeleteArquivo.files.length === 0);
  check('[99ª rodada] apagar o arquivo (mesmo pedindo pela demanda-irmã) remove o arquivo físico de verdade',
    !fs.existsSync(filePathFísico));

  // ---------- 7. Arquivar/desarquivar manualmente sincroniza ----------
  await fetch(`${BASE}/api/demandas/${demA.id}/archive`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ archived: true })
  });
  check('[99ª rodada] arquivar manualmente uma demanda-irmã arquiva a outra também',
    db.get('demandas').find({ id: demB.id }).value().archived === true);
  await fetch(`${BASE}/api/demandas/${demA.id}/archive`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ archived: false })
  });
  check('[99ª rodada] desarquivar manualmente uma demanda-irmã desarquiva a outra também',
    db.get('demandas').find({ id: demB.id }).value().archived === false);

  // ---------- 8. Concluir uma demanda-irmã continua completando todas (com pontuação preservada) ----------
  await fetch(`${BASE}/api/demandas/${demA.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ status: 'concluida' })
  });
  const demBApósConcluir = db.get('demandas').find({ id: demB.id }).value();
  check('[99ª rodada] concluir uma demanda-irmã continua completando e arquivando a outra',
    demBApósConcluir.status === 'concluida' && demBApósConcluir.archived === true);
  check('[99ª rodada] lastCompletedAt/lastCompletedDueDate (usados no Reis do Marketing) também sincronizam pra demanda-irmã',
    !!demBApósConcluir.lastCompletedAt);

  // ---------- 9. Mesmo depois de concluída, uma nova mudança ainda propaga ----------
  // Regra nova (reverte a cautela da 98ª): demanda concluída/arquivada NÃO é
  // mais "intocável" -- se outra do grupo mudar, ela acompanha também.
  await fetch(`${BASE}/api/demandas/${demA.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ color: '#00ff00' })
  });
  check('[99ª rodada] demanda-irmã JÁ CONCLUÍDA/ARQUIVADA ainda recebe sincronização de uma mudança posterior',
    db.get('demandas').find({ id: demB.id }).value().color === '#00ff00');

  // ---------- 10. Pessoa nova marcada num agendamento que já tem demandas-irmãs herda o estado compartilhado ----------
  await fetch(`${BASE}/api/social-posts/${post.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ involvedUserIds: [ana1.id, ana2.id, ana3.id] })
  });
  const demandasFinal = demandasDoPost(post.id);
  const demC = demandasFinal.find((d) => (d.assigneeIds || []).includes(ana3.id));
  check('[99ª rodada] pessoa nova marcada depois nasce com card novo', !!demC);
  check('[99ª rodada] card da pessoa nova já nasce com o MESMO status/cor/responsável/arquivamento do grupo (herdado, não os padrões de sempre)',
    !!demC && demC.status === 'concluida' && demC.color === '#00ff00' && demC.responsibleId === ana2.id && demC.archived === true);

  // ---------- 11. Isolamento: outro agendamento não é afetado por nada disso ----------
  const outroPost = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({
      brand: 'debacco', platform: 'instagram', scheduledDate: '2026-12-01',
      subject: 'Isolamento 99', involvedUserIds: [ana1.id], responsibleId: ana1.id
    })
  }).then((r) => r.json()).then((d) => d.post);
  const demandaIsolada = demandasDoPost(outroPost.id)[0];
  await fetch(`${BASE}/api/demandas/${demA.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ color: '#123456' })
  });
  const demandaIsoladaDepois = db.get('demandas').find({ id: demandaIsolada.id }).value();
  check('[99ª rodada] sincronização nunca atravessa pra demanda de OUTRO agendamento (isolamento por sourceSocialPostId)',
    demandaIsoladaDepois.color !== '#123456');

  // ---------- 12. Demanda SEM sourceSocialPostId (criada direto em Demandas) nunca entra nessa sincronização ----------
  const demandaDireta = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ title: 'Demanda direta 99', assigneeIds: [ana1.id], responsibleId: ana1.id })
  }).then((r) => r.json()).then((d) => d.demanda);
  await fetch(`${BASE}/api/demandas/${demandaDireta.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ color: '#abcdef' })
  });
  check('demanda criada direto (sem sourceSocialPostId) não afeta nem é afetada pela sincronização de irmãs -- nenhum erro, segue isolada',
    db.get('demandas').find({ id: demandaDireta.id }).value().color === '#abcdef');

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
