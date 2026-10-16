// 95ª rodada (16/10/2026) -- CORREÇÃO DE BUG CRÍTICO DE PERDA DE DADO,
// reportado pela Raquel com máxima prioridade: "reparei que a cada
// atualização do papoi, os horários do ponto da equipe somem, isso n pode
// acontecer, quando atualziamos algo no papoi, nenhum dado pode ser
// perdido, nunca."
//
// Causa raiz encontrada (ver routes/auth.js, GET /users): o token JWT só
// carrega {id, username, role} (contrato compartilhado com o SSO dos
// outros 3 dashboards -- ver signToken()/middleware/auth.js) -- NUNCA uma
// propriedade `isSuperAdmin`. A rota GET /users checava
// `req.user.isSuperAdmin` (sempre undefined/falsy, pra QUALQUER pessoa,
// inclusive o super admin de verdade), então sempre devolvia a versão
// pública de cada usuário (`publicUser`, sem `pontoSchedule`) -- mesmo pro
// admin. Resultado prático: a tela de Usuários sempre abria o formulário
// de edição com os 4 campos de horário de ponto em branco (mesmo quando
// já existia um horário cadastrado), e salvar QUALQUER edição de QUALQUER
// usuário (trocar cargo, permissão, nome etc. -- nem precisa mexer no
// horário) mandava os 4 campos vazios pro PUT /users/:id, que apagava
// (`null`) o horário que já existia. Não tinha nada a ver com deploy/
// redeploy -- reproduzia na hora, no mesmo processo, sem reiniciar nada.
//
// Este teste prova as DUAS pontas: (1) GET /users agora devolve
// `pontoSchedule` certinho pro super admin (a causa raiz corrigida), e
// (2) o fluxo completo que a Raquel described -- abrir o form (que agora
// vem com os horários já preenchidos), editar outra coisa qualquer
// (nome), salvar -- preserva o horário de ponto que já existia, em vez de
// apagar. Também confirma que a regra de privacidade de sempre (só super
// admin vê `pontoSchedule`) continua intacta.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 4195;
const BASE = `http://localhost:${PORT}`;
const dbPath = path.join(__dirname, '..', 'data', 'db.json');
const dbBackupPath = dbPath + '.bak-pontoSchedule95-test';

let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }
async function login(username, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  }).then((x) => x.json());
  return r.token;
}

async function main() {
  if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, dbBackupPath);

  const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), JWT_SECRET: 'teste-pontoSchedule95', META_APP_ID: '1749362466318676', META_APP_SECRET: 'fake-secret', PAPOI_BASE_URL: BASE },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('servidor não subiu a tempo')), 15000);
      server.stdout.on('data', (d) => { if (d.toString().includes('rodando na porta')) { clearTimeout(timeout); resolve(); } });
      server.on('error', reject);
    });

    const statusData = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
    let adminToken;
    if (statusData.needsSetup) {
      const setup = await fetch(`${BASE}/api/auth/setup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: '123456', name: 'Admin Teste' })
      }).then((r) => r.json());
      adminToken = setup.token;
    } else {
      adminToken = await login('admin', '123456');
    }

    // ---------- setup: cria usuária de teste com horário de ponto ----------
    const created = await fetch(`${BASE}/api/auth/users`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ username: 'pontoschedule95', password: '123456', name: 'Ponto Schedule 95', cargo: 'analista' })
    }).then((r) => r.json());
    const userId = created.user.id;

    const horarioOriginal = { entradaManha: '08:00', saidaAlmoco: '12:00', voltaAlmoco: '13:00', saidaFinal: '18:00' };
    await fetch(`${BASE}/api/auth/users/${userId}`, {
      method: 'PUT', headers: hj(adminToken),
      body: JSON.stringify({ pontoSchedule: horarioOriginal })
    });

    // ---------- 1. causa raiz: GET /users devolve pontoSchedule pro super admin ----------
    const listaAdmin1 = await fetch(`${BASE}/api/auth/users`, { headers: hj(adminToken) }).then((r) => r.json());
    const userNaListaAdmin1 = listaAdmin1.users.find((u) => u.id === userId);
    check('GET /users (super admin): devolve o objeto pontoSchedule (não fica undefined)', !!userNaListaAdmin1.pontoSchedule);
    check('GET /users (super admin): os 4 horários batem com o que foi salvo', JSON.stringify(userNaListaAdmin1.pontoSchedule) === JSON.stringify(horarioOriginal));

    // ---------- 2. privacidade: quem NÃO é super admin continua sem ver pontoSchedule ----------
    const comum = await fetch(`${BASE}/api/auth/users`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ username: 'naoadminpontoSchedule95', password: '123456', name: 'Não Admin PS95', cargo: 'analista' })
    }).then((r) => r.json());
    const comumToken = await login('naoadminpontoSchedule95', '123456');
    const listaComum = await fetch(`${BASE}/api/auth/users`, { headers: hj(comumToken) }).then((r) => r.json());
    const userNaListaComum = listaComum.users.find((u) => u.id === userId);
    check('GET /users (usuária comum): NÃO devolve pontoSchedule pra ninguém (privacidade mantida)', userNaListaComum.pontoSchedule === undefined);

    // ---------- 3. fluxo completo: editar OUTRA coisa (nome) preserva o horário ----------
    // Simula exatamente o que a tela faz: lê o horário atual via GET /users
    // (como openUserForm() faz pra pré-preencher o formulário) e reenvia
    // esse MESMO valor junto com a edição de nome -- é isso que estava
    // quebrado antes (vinha sempre undefined/em branco da leitura, então
    // reenviava em branco e apagava).
    const horarioLidoParaPreencherForm = userNaListaAdmin1.pontoSchedule;
    await fetch(`${BASE}/api/auth/users/${userId}`, {
      method: 'PUT', headers: hj(adminToken),
      body: JSON.stringify({ name: 'Ponto Schedule 95 (nome editado)', pontoSchedule: horarioLidoParaPreencherForm })
    });
    const listaDepoisDaEdicao = await fetch(`${BASE}/api/auth/users`, { headers: hj(adminToken) }).then((r) => r.json());
    const userDepois = listaDepoisDaEdicao.users.find((u) => u.id === userId);
    check('editar o NOME (sem mexer no horário) preserva o pontoSchedule intacto', JSON.stringify(userDepois.pontoSchedule) === JSON.stringify(horarioOriginal));
    check('o nome realmente foi atualizado (confirma que a edição de verdade rolou)', userDepois.name === 'Ponto Schedule 95 (nome editado)');

    // ---------- 4. confere direto no db.json em disco (não só na resposta da API) ----------
    const dbNoDisco = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const userNoDisco = dbNoDisco.users.find((u) => u.id === userId);
    check('db.json em disco também mantém o pontoSchedule intacto', JSON.stringify(userNoDisco.pontoSchedule) === JSON.stringify(horarioOriginal));

    console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 300));
    if (fs.existsSync(dbBackupPath)) {
      fs.copyFileSync(dbBackupPath, dbPath);
      fs.rmSync(dbBackupPath);
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
