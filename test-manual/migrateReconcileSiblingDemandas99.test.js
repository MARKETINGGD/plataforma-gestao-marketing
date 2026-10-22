// Teste de integração da migração de reconciliação da 99ª rodada (ver
// utils/migrateReconcileSiblingDemandas99.js) -- pedido da Raquel:
// "certifique-se de que todos os cards irmãos atualizados nas ultimas 2
// semanas, estejam ok". Semeia DIRETO no banco (antes de subir o server)
// 2 demandas-irmãs já divergentes (como ficariam se tivessem sido
// editadas separadamente antes da sincronização total existir), sobe o
// servidor (que roda a migração automaticamente, igual em produção) e
// confere que ficam iguais -- sem perder nenhum item de checklist nem
// nenhum arquivo que só existia num dos dois lados.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-migrate-reconcile-99';
process.env.PORT = '4362';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4362';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-migrate-reconcile-99-test');
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

  // ---------- Semeia 2 demandas-irmãs já divergentes, ANTES de subir o server ----------
  const db = require('../db');
  const now = new Date().toISOString();
  const postId = 'migrate99-post-divergente';
  const d1 = {
    id: 'migrate99-d1', title: 'Título antigo', description: 'desc', status: 'andamento', color: '#111111',
    link: null, checklistTitle: 'Checklist', labelIds: [], network: 'instagram', brand: 'debacco',
    responsibleId: 'migrate99-u1', archived: false, dueDate: '2026-10-01', assigneeIds: ['migrate99-u1'],
    sourceSocialPostId: postId, checklist: [{ id: 'migrate99-c1', text: 'Item só no card 1', done: false }],
    files: [{ id: 'migrate99-f1', name: 'so-no-1.txt', url: '/uploads/demandas/migrate99-d1/so-no-1.txt' }],
    createdAt: now, updatedAt: '2026-09-01T10:00:00.000Z', visibility: 'geral'
  };
  const d2 = {
    id: 'migrate99-d2', title: 'Título mais novo', description: 'desc', status: 'em_revisao', color: '#222222',
    link: null, checklistTitle: 'Checklist', labelIds: [], network: 'instagram', brand: 'debacco',
    responsibleId: 'migrate99-u2', archived: false, dueDate: '2026-10-05', assigneeIds: ['migrate99-u2'],
    sourceSocialPostId: postId, checklist: [{ id: 'migrate99-c2', text: 'Item só no card 2 (concluído)', done: true, doneAt: now }],
    files: [{ id: 'migrate99-f2', name: 'so-no-2.txt', url: '/uploads/demandas/migrate99-d2/so-no-2.txt' }],
    createdAt: now, updatedAt: '2026-09-10T10:00:00.000Z', visibility: 'geral'
  };
  db.get('demandas').push(d1).write();
  db.get('demandas').push(d2).write();

  require('../server'); // a migração roda sozinha aqui, igual no boot de produção
  await new Promise((r) => setTimeout(r, 1000));

  const db2 = require('../db');
  const depois1 = db2.get('demandas').find({ id: 'migrate99-d1' }).value();
  const depois2 = db2.get('demandas').find({ id: 'migrate99-d2' }).value();

  check('migração rodou sem derrubar o servidor', !!depois1 && !!depois2);
  check('título convergiu pro valor da demanda mais recente (d2)', depois1.title === 'Título mais novo' && depois2.title === 'Título mais novo');
  check('dueDate/status/cor/responsável também convergiram pro valor mais recente',
    depois1.dueDate === '2026-10-05' && depois1.status === 'em_revisao' && depois1.color === '#222222' && depois1.responsibleId === 'migrate99-u2');
  check('NENHUM item de checklist foi perdido -- os 2 (de cada card) sobrevivem em AMBOS, por união',
    depois1.checklist.length === 2 && depois2.checklist.length === 2 &&
    depois1.checklist.some((i) => i.id === 'migrate99-c1') && depois1.checklist.some((i) => i.id === 'migrate99-c2') &&
    depois2.checklist.some((i) => i.id === 'migrate99-c1') && depois2.checklist.some((i) => i.id === 'migrate99-c2'));
  check('o item que já estava concluído continua concluído depois da união', depois1.checklist.find((i) => i.id === 'migrate99-c2').done === true);
  check('NENHUM arquivo foi perdido -- os 2 (de cada card) sobrevivem em AMBOS, por união',
    depois1.files.length === 2 && depois2.files.length === 2 &&
    depois1.files.some((f) => f.id === 'migrate99-f1') && depois1.files.some((f) => f.id === 'migrate99-f2'));

  const histRes = await fetch(`http://localhost:4362/api/demandas/${depois1.id}/history`, { method: 'GET' }).catch(() => null);
  // (sem token válido pra essa chamada -- só a migração em si já grava no
  // auditLog direto; confirma por ali mesmo, sem precisar de login.)
  const auditTemEntrada = db2.get('auditLog').value().some((e) => e.entityId === 'migrate99-d1' && (e.details || '').includes('Reconciliada automaticamente'));
  check('ficou registrado no Histórico que a demanda foi reconciliada automaticamente', auditTemEntrada);

  // ---------- Idempotência: rodar a migração de novo não muda nada e não duplica log ----------
  const auditCountAntes = db2.get('auditLog').value().filter((e) => e.entityId === 'migrate99-d1').length;
  require('../utils/migrateReconcileSiblingDemandas99').migrateReconcileSiblingDemandas99();
  const auditCountDepois = db2.get('auditLog').value().filter((e) => e.entityId === 'migrate99-d1').length;
  check('migração é idempotente -- rodar de novo (grupo já reconciliado) não grava nada extra', auditCountDepois === auditCountAntes);

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
