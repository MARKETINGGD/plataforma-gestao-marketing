// Teste de integração (servidor de verdade, mesmo padrão dos demais
// test-manual/*.test.js) da 109ª rodada -- pedido literal da Raquel:
// "tbm quero poder enviar e-mail de notificação para o email de cada
// membro da equipe- somente as notificações de: afastamento, demandas
// atrasadas (para a pessoa responsável), pedido de aprovação em espera a
// mais de 24 horas (somente para quem aprova), pedido de ajuste (somente
// para quem ajusta), recados dos colegas (somente para quem recebeu o
// recado)."
//
// Cobre as 5 categorias:
//   1. Recado de colega (routes/recados.js POST /) -- e-mail pra quem
//      recebeu o recado.
//   2. Afastamento (routes/ausencias.js) -- e-mail broadcast (igual ao
//      recado automático).
//   3. Pedido de ajuste -- post reprovado (routes/socialPosts.js) -- só
//      pro responsável, nunca pra gerência (mesmo que o recado vá pros
//      dois).
//   4. Pedido de ajuste -- demanda em "Em Refação" (routes/demandas.js,
//      novo nesta rodada) -- só pro(s) assignee(s)/"quem ajusta".
//   5. Demanda atrasada (utils/demandaAtrasadaReminders.js, novo) -- só
//      pra pessoa responsável, 1x por dia.
//   6. Pedido de aprovação em espera > 24h (utils/aprovacaoPendenteReminders.js,
//      novo), tanto em Agendamento quanto em Demandas -- só pra quem
//      aprova (gerente/coordenador(a)/admin), nunca pra quem não é.
//   7. `pendingApprovalSince` (campo novo) nasce/some certo em
//      socialPosts.js e demandas.js nas transições certas.
//
// Mocka utils/mailer.js (sem SMTP configurado nem rede de verdade) --
// monkeypatch feito ANTES de `require('../server')`, pra toda rota que já
// tinha feito `const { sendEmailToUsers } = require('../utils/mailer')`
// pegar a versão mockada (mesmo truque já usado em
// test-manual/tiktokPublisher.test.js pro cliente da TikTok).
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-notificacoes-email-109';
process.env.PORT = '4336';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4336';
// Garante que o mailer NÃO tenta mandar e-mail de verdade mesmo se, por
// algum motivo, o monkeypatch abaixo não pegar em algum ponto -- sem
// essas variáveis, getTransporter() devolve null e sendEmailToUsers()
// não faz nada (ver utils/mailer.js).
delete process.env.SMTP_HOST;
delete process.env.SMTP_PORT;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.EMAIL_FROM;

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-notificacoes-email-109-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

// ---------- monkeypatch do mailer (sem rede/SMTP) ----------
const mailerModule = require('../utils/mailer');
let sentEmails = [];
mailerModule.sendEmailToUsers = (userIds, opts) => {
  sentEmails.push({ userIds: (userIds || []).slice(), opts: opts || {} });
};
function emailsTo(userId) {
  return sentEmails.filter((e) => e.userIds.includes(userId));
}

async function run() {
  let failures = 0;
  function check(label, cond) {
    console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
    if (!cond) failures++;
  }

  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const BASE = 'http://localhost:4336';
  const db = require('../db');
  const demandaAtrasadaReminders = require('../utils/demandaAtrasadaReminders');
  const aprovacaoPendenteReminders = require('../utils/aprovacaoPendenteReminders');

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
      body: JSON.stringify({ name: 'Admin Teste 109', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
  } else {
    adminToken = await login('admin', '123456');
  }
  check('login/setup do admin devolveu token', !!adminToken);

  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }

  async function createUser(username, name, extra) {
    const res = await fetch(`${BASE}/api/auth/users`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify(Object.assign({ username, password: '123456', name }, extra))
    }).then((r) => r.json());
    return res.user;
  }

  const gerente1 = await createUser('gerente1n109', 'Gerente Um 109', { cargo: 'gerente', email: 'gerente1n109@teste.com' });
  const coord1 = await createUser('coord1n109', 'Coordenadora Um 109', { cargo: 'coordenador', email: 'coord1n109@teste.com' });
  const resp1 = await createUser('resp1n109', 'Responsável Um 109', { cargo: 'analista', email: 'resp1n109@teste.com' });
  const semEmail1 = await createUser('sememail1n109', 'Sem Email 109', { cargo: 'analista' });
  check('4 usuários de teste criados (gerente/coordenadora/responsável/sem e-mail)', !!(gerente1 && coord1 && resp1 && semEmail1));
  check('usuário criado com e-mail devolve o e-mail certo', resp1 && resp1.email === 'resp1n109@teste.com');
  check('usuário criado sem e-mail devolve string vazia (nunca quebra)', semEmail1 && semEmail1.email === '');

  // ---------- 1. Recado de colega -- e-mail só pra quem recebeu ----------
  sentEmails = [];
  const recadoRes = await fetch(`${BASE}/api/recados`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ text: 'Recado de teste 109', color: '#6D63E0', targetUserIds: [resp1.id] })
  });
  check('POST /api/recados -> 200/201', recadoRes.status < 300);
  check('recado de colega dispara e-mail pro destinatário', emailsTo(resp1.id).some((e) => /Recado de teste 109/.test(e.opts.text || '')));
  check('recado de colega NÃO manda e-mail pra quem não foi marcado', !emailsTo(semEmail1.id).length);

  // ---------- 2. Afastamento -- e-mail broadcast (igual ao recado automático) ----------
  sentEmails = [];
  const afastamentoRes = await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ userId: resp1.id, tipo: 'afastamento', dataInicio: '2026-11-01', dataFim: '2026-11-05' })
  });
  check('POST /api/ausencias (afastamento) -> 200', afastamentoRes.status === 200);
  const afastamentoEmails = sentEmails.filter((e) => /^Afastamento:/.test(e.opts.subject || ''));
  check('afastamento dispara e-mail com o assunto certo', afastamentoEmails.length === 1);
  check('afastamento é broadcast -- inclui o próprio ausente E outros colegas com e-mail', afastamentoEmails[0] && afastamentoEmails[0].userIds.includes(resp1.id) && afastamentoEmails[0].userIds.includes(gerente1.id));

  // ---------- 3. Pedido de ajuste -- post reprovado: só pro responsável ----------
  sentEmails = [];
  const postRes = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ platform: 'instagram', brand: 'ghelplus', scheduledDate: '2026-11-10', involvedUserIds: [resp1.id], responsibleId: resp1.id })
  }).then((r) => r.json());
  const post = postRes.post;
  const postMirror = postRes.mirrorPost; // instagram+ghelplus espelha pro Facebook automaticamente (79ª rodada)
  check('post de teste criado', !!post);
  check('post nasce com pendingApprovalSince preenchido (nasce "pendente")', !!(post && post.pendingApprovalSince));

  sentEmails = [];
  const reprovarRes = await fetch(`${BASE}/api/social-posts/${post.id}/approval`, {
    method: 'PUT', headers: hj(adminToken),
    body: JSON.stringify({ approvalStatus: 'reprovado', approvalNotes: 'Ajustar a legenda' })
  });
  check('PUT /approval (reprovado) -> 200', reprovarRes.status === 200);
  check('reprovação de post dispara e-mail pro responsável ("quem ajusta")', emailsTo(resp1.id).some((e) => /ajuste pedido/i.test(e.opts.subject || '')));
  check('reprovação de post NÃO manda e-mail pra gerência (só pro responsável, diferente do recado)', !emailsTo(gerente1.id).length && !emailsTo(coord1.id).length);

  const postAposReprovar = db.get('socialPosts').find({ id: post.id }).value();
  check('post reprovado: pendingApprovalSince some (deixou de estar esperando)', postAposReprovar.pendingApprovalSince === null);

  // ---------- 7a. resubmit -> pendingApprovalSince volta a contar ----------
  const resubmitRes = await fetch(`${BASE}/api/social-posts/${post.id}/resubmit`, {
    method: 'PUT', headers: hj(adminToken)
  });
  check('PUT /resubmit -> 200', resubmitRes.status === 200);
  const postAposResubmit = db.get('socialPosts').find({ id: post.id }).value();
  check('post reenviado: pendingApprovalSince preenchido de novo', !!postAposResubmit.pendingApprovalSince);
  check('post reenviado: approvalStatus volta a "pendente"', postAposResubmit.approvalStatus === 'pendente');

  // aprovar -> também deve limpar pendingApprovalSince
  await fetch(`${BASE}/api/social-posts/${post.id}/approval`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ approvalStatus: 'aprovado' })
  });
  const postAposAprovar = db.get('socialPosts').find({ id: post.id }).value();
  check('post aprovado: pendingApprovalSince também some', postAposAprovar.pendingApprovalSince === null);

  // ---------- 4. Pedido de ajuste -- demanda "Em Refação": só pra quem ajusta ----------
  sentEmails = [];
  const demandaRes = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ title: 'Demanda de teste 109 -- ajuste', assigneeIds: [resp1.id], responsibleId: resp1.id })
  }).then((r) => r.json());
  const demanda = demandaRes.demanda;
  check('demanda de teste criada', !!demanda);

  sentEmails = [];
  const ajusteRes = await fetch(`${BASE}/api/demandas/${demanda.id}`, {
    method: 'PUT', headers: hj(adminToken),
    body: JSON.stringify({ status: 'em_refacao' })
  });
  check('PUT demanda status=em_refacao -> 200', ajusteRes.status === 200);
  check('"Em Refação" dispara e-mail pro(s) assignee(s) ("quem ajusta")', emailsTo(resp1.id).some((e) => /Pedido de ajuste/i.test(e.opts.subject || '')));
  check('"Em Refação" NÃO manda e-mail pra quem não está marcado no card', !emailsTo(gerente1.id).length);

  // não deve disparar de novo se ficar no mesmo status (edição de outro campo)
  sentEmails = [];
  await fetch(`${BASE}/api/demandas/${demanda.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ status: 'em_refacao', description: 'só editando a descrição' })
  });
  check('ficar no mesmo status "Em Refação" NÃO dispara e-mail de novo (só na transição)', sentEmails.length === 0);

  // ---------- 7b. demanda "Em Aprovação" -- pendingApprovalSince nasce/some ----------
  const aprovacaoRes = await fetch(`${BASE}/api/demandas/${demanda.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ status: 'aprovacao' })
  }).then((r) => r.json());
  check('demanda entrou em "Em Aprovação": pendingApprovalSince preenchido', !!(aprovacaoRes.demanda && aprovacaoRes.demanda.pendingApprovalSince));

  const saiuAprovacaoRes = await fetch(`${BASE}/api/demandas/${demanda.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ status: 'aprovado' })
  }).then((r) => r.json());
  check('demanda saiu de "Em Aprovação": pendingApprovalSince some', saiuAprovacaoRes.demanda && saiuAprovacaoRes.demanda.pendingApprovalSince === null);

  // ---------- 5. Demanda atrasada -- só pra pessoa responsável, 1x/dia ----------
  const demandaAtrasadaRes = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ title: 'Demanda de teste 109 -- atrasada', assigneeIds: [resp1.id], responsibleId: resp1.id, dueDate: '2020-01-01' })
  }).then((r) => r.json());
  const demandaAtrasada = demandaAtrasadaRes.demanda;
  check('demanda atrasada de teste criada (dueDate no passado)', !!demandaAtrasada);

  sentEmails = [];
  demandaAtrasadaReminders.checkAndSendOverdueDemandEmails();
  // Nota: rodando dentro da suite completa, outras demandas (deixadas por
  // OUTROS test-manual/*.test.js) também podem estar atrasadas de verdade
  // e disparar o próprio e-mail -- correto (o scheduler varre a Papoi
  // inteira, não só os dados deste teste). Por isso o check de "só pro
  // responsável" é isolado NO e-mail desta demanda específica, não no
  // total de e-mails disparados neste ciclo.
  const demandaAtrasadaEmail = sentEmails.find((e) => (e.opts.subject || '').includes(demandaAtrasada.title));
  check('demanda atrasada dispara e-mail pro responsável', !!demandaAtrasadaEmail && demandaAtrasadaEmail.userIds.includes(resp1.id));
  check('demanda atrasada NÃO manda e-mail pra ninguém fora o responsável', !!demandaAtrasadaEmail && demandaAtrasadaEmail.userIds.length === 1);

  sentEmails = [];
  demandaAtrasadaReminders.checkAndSendOverdueDemandEmails();
  check('demanda atrasada: dedup -- não dispara 2x no mesmo dia', sentEmails.length === 0);

  // ---------- 6. Aprovação pendente > 24h -- só pra quem aprova ----------
  // post "pendente" há mais de 24h (manipulando o campo direto, sem
  // esperar passar 1 dia de verdade)
  const postAntigoRes = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ platform: 'instagram', brand: 'ghelplus', scheduledDate: '2026-12-01', involvedUserIds: [resp1.id], responsibleId: resp1.id })
  }).then((r) => r.json());
  const postAntigo = postAntigoRes.post;
  const postAntigoMirror = postAntigoRes.mirrorPost;
  const horaAntiga = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  db.get('socialPosts').find({ id: postAntigo.id }).assign({ pendingApprovalSince: horaAntiga }).write();

  // post "pendente" recente (< 24h) -- NÃO deve disparar
  const postRecenteRes = await fetch(`${BASE}/api/social-posts`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ platform: 'instagram', brand: 'ghelplus', scheduledDate: '2026-12-02', involvedUserIds: [resp1.id], responsibleId: resp1.id })
  }).then((r) => r.json());
  const postRecente = postRecenteRes.post;
  const postRecenteMirror = postRecenteRes.mirrorPost;

  // demanda "Em Aprovação" há mais de 24h
  const demandaAprovacaoRes = await fetch(`${BASE}/api/demandas`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ title: 'Demanda de teste 109 -- aprovação pendente', assigneeIds: [resp1.id], responsibleId: resp1.id })
  }).then((r) => r.json());
  const demandaAprovacao = demandaAprovacaoRes.demanda;
  await fetch(`${BASE}/api/demandas/${demandaAprovacao.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ status: 'aprovacao' })
  });
  db.get('demandas').find({ id: demandaAprovacao.id }).assign({ pendingApprovalSince: horaAntiga }).write();

  sentEmails = [];
  aprovacaoPendenteReminders.checkAndSendPendingApprovalEmails();
  check('post pendente há +24h dispara e-mail de aprovação pendente', sentEmails.some((e) => e.opts.text && e.opts.text.includes('está esperando aprovação há mais de 24 horas') && (e.opts.subject || '').includes(postAntigo.platform)));
  check('demanda "Em Aprovação" há +24h dispara e-mail de aprovação pendente', sentEmails.some((e) => e.opts.subject && e.opts.subject.includes('Demanda de teste 109 -- aprovação pendente')));
  check('aprovação pendente vai pra gerente/coordenadora/admin', sentEmails.every((e) => e.userIds.includes(gerente1.id) && e.userIds.includes(coord1.id)));
  check('aprovação pendente NUNCA vai pra quem não aprova (analista comum)', sentEmails.every((e) => !e.userIds.includes(resp1.id) && !e.userIds.includes(semEmail1.id)));
  check('post recente (< 24h esperando) NÃO dispara nada', !sentEmails.some((e) => (e.opts.subject || '').includes(postRecente.platform) && (e.opts.subject || '').includes(postRecente.scheduledDate)));

  sentEmails = [];
  aprovacaoPendenteReminders.checkAndSendPendingApprovalEmails();
  check('aprovação pendente: dedup -- não dispara 2x no mesmo dia', sentEmails.length === 0);

  // ---------- limpeza ----------
  // Inclui os espelhos automáticos no Facebook (79ª rodada, dispara sozinho
  // pra todo post de Instagram De Bacco/GhelPlus) e as demandas que nascem
  // sozinhas de cada post/espelho (createDemandCardsForNewInvolved).
  const allTestPostIds = [post, postMirror, postAntigo, postAntigoMirror, postRecente, postRecenteMirror]
    .filter(Boolean).map((p) => p.id);
  allTestPostIds.forEach((id) => db.get('socialPosts').remove({ id }).write());
  db.get('demandas').remove((d) => allTestPostIds.includes(d.sourceSocialPostId)).write();
  [demanda.id, demandaAtrasada.id, demandaAprovacao.id].forEach((id) => db.get('demandas').remove({ id }).write());
  db.get('recados').remove((r) => allTestPostIds.includes(r.sourceSocialPostId)
    || r.text === 'Recado de teste 109' || r.kind === 'ausencia_anunciada' || r.kind === 'demanda_ajuste').write();
  db.get('ausencias').remove({ userId: resp1.id }).write();
  db.get('demandaAtrasadaEmailFired').remove((f) => f.demandaId === demandaAtrasada.id).write();
  db.get('pendingApprovalEmailFired').remove((f) => [postAntigo.id, demandaAprovacao.id].includes(f.entityId)).write();
  [gerente1, coord1, resp1, semEmail1].forEach((u) => { if (u) db.get('users').remove({ id: u.id }).write(); });

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
