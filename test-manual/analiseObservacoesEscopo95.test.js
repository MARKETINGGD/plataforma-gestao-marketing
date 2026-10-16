// 95ª rodada (16/10/2026) -- item 2 da fila de pedidos: "em planilha de
// influencers, adicionar um local para observações de cada infleuncers,
// escopo (entregas) e dentro de escopo ter onde por valor."
//
// Campos novos na Análise de Influencer: `observacoes` (texto livre),
// `escopo` (texto livre -- descrição das entregas) e `escopoValor`
// (monetário, dentro do escopo). Puramente aditivo -- nenhum campo
// existente muda de nome/comportamento.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 4197;
const BASE = `http://localhost:${PORT}`;
const dbPath = path.join(__dirname, '..', 'data', 'db.json');
const dbBackupPath = dbPath + '.bak-analiseObservacoesEscopo95-test';

let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}
function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }

async function main() {
  if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, dbBackupPath);

  const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), JWT_SECRET: 'teste-analiseEscopo95', META_APP_ID: '1749362466318676', META_APP_SECRET: 'fake-secret', PAPOI_BASE_URL: BASE },
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
      adminToken = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: '123456' })
      }).then((r) => r.json()).then((d) => d.token);
    }

    // ---------- meta expõe os 3 campos novos ----------
    const meta = await fetch(`${BASE}/api/influencer-analises/meta`, { headers: hj(adminToken) }).then((r) => r.json());
    check('GET /meta lista "observacoes" nos campos', meta.fields.includes('observacoes'));
    check('GET /meta lista "escopo" nos campos', meta.fields.includes('escopo'));
    check('GET /meta lista "escopoValor" nos campos', meta.fields.includes('escopoValor'));

    // ---------- criar já com os 3 campos novos ----------
    const criada = await fetch(`${BASE}/api/influencer-analises`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({
        brand: 'debacco', nome: 'Influencer Teste Escopo95',
        observacoes: 'Responde rápido, já trabalhou com concorrente.',
        escopo: '1 post feed + 3 stories', escopoValor: '1500.50'
      })
    }).then((r) => r.json()).then((d) => d.analise);
    check('observações salva certinho', criada.observacoes === 'Responde rápido, já trabalhou com concorrente.');
    check('escopo (entregas) salvo certinho', criada.escopo === '1 post feed + 3 stories');
    check('valor do escopo salvo como número', criada.escopoValor === 1500.5);

    // ---------- editar só o valor do escopo, sem mexer no resto ----------
    const editada = await fetch(`${BASE}/api/influencer-analises/${criada.id}`, {
      method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ escopoValor: '2000' })
    }).then((r) => r.json()).then((d) => d.analise);
    check('editar só o valor do escopo atualiza certinho', editada.escopoValor === 2000);
    check('observações/escopo continuam intactos depois da edição parcial', editada.observacoes === 'Responde rápido, já trabalhou com concorrente.' && editada.escopo === '1 post feed + 3 stories');

    // ---------- análise sem os campos novos (ex: pré-cadastradas da 91ª rodada) não quebra ----------
    const lista = await fetch(`${BASE}/api/influencer-analises?brand=ghelplus`, { headers: hj(adminToken) }).then((r) => r.json());
    const antiga = lista.analises.find((a) => a.seedPlanilha91);
    check('candidata pré-cadastrada da 91ª rodada (sem os campos novos) continua existindo, sem quebrar', !!antiga);
    check('candidata antiga mostra os campos novos vazios (nunca undefined/erro)', antiga.observacoes === '' && antiga.escopo === '' && antiga.escopoValor === null);

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
