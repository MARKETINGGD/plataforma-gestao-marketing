// 96ª rodada (16/10/2026) -- item 4 da fila de pedidos: "em produtos-
// adicionar aba dentro de lançamento de produtos, um check list de
// processos a serem seguidos, ainda n tenho os setores, mas vou te mandar
// um fluxograma p vc analisar e ai deixe de forma editavel, p poder por o
// setor responsavel e a atividade de cada um, pq cada produto lançado
// deve ter esse check list conferido."
//
// Cobre: (1) CRUD do MODELO de checklist (setor + atividade), editável
// mesmo sem os setores definitivos ainda; (2) todo lançamento novo já
// nasce com o checklist do modelo (desmarcado); (3) marcar/desmarcar 1
// item carimba quem conferiu e quando; (4) adicionar um item novo no
// modelo DEPOIS de um lançamento já existir soma no checklist dele (sem
// apagar o que já tinha marcado); (5) excluir um item do modelo não
// apaga o histórico de quem já tinha conferido aquele item num
// lançamento que já existia; (6) lançamento bem antigo (de antes desta
// rodada, sem `checklist` nenhum) continua existindo e ganha o checklist
// atual na leitura -- nenhum dado perdido.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 4199;
const BASE = `http://localhost:${PORT}`;
const dbPath = path.join(__dirname, '..', 'data', 'db.json');
const dbBackupPath = dbPath + '.bak-produtosChecklist96-test';

let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}
function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }

// Lançamento "bem antigo" (de antes da 96ª rodada) -- sem `checklist`
// nenhum. Precisa ser injetado no db.json ANTES do servidor subir.
function seedOldStyleLancamento() {
  const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  raw.lancamentosProdutos = raw.lancamentosProdutos || [];
  raw.lancamentosProdutos.push({
    id: 'lancamento-bem-antigo-96',
    brand: 'ghelplus',
    produto: 'Cuba',
    nome: 'Cuba Antiga (dado histórico)',
    codigo: 'OLD-001',
    diferenciais: '',
    dataLancamento: '2025-02-01',
    status: 'lancado',
    descricao: 'Lançamento de antes da 96ª rodada, sem checklist salvo.',
    arquivos: [],
    createdAt: '2025-02-01T10:00:00.000Z',
    createdBy: null,
    updatedAt: '2025-02-01T10:00:00.000Z'
  });
  fs.writeFileSync(dbPath, JSON.stringify(raw, null, 2));
}

async function main() {
  if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, dbBackupPath);
  seedOldStyleLancamento();

  const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), JWT_SECRET: 'teste-produtosChecklist96', META_APP_ID: '1749362466318676', META_APP_SECRET: 'fake-secret', PAPOI_BASE_URL: BASE },
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

    // ---------- modelo começa vazio ----------
    const metaInicial = await fetch(`${BASE}/api/produtos/checklist-template`, { headers: hj(adminToken) }).then((r) => r.json());
    check('modelo de checklist começa vazio', metaInicial.items.length === 0);

    // ---------- cria 2 itens do modelo (ainda sem os setores definitivos) ----------
    const item1 = await fetch(`${BASE}/api/produtos/checklist-template`, {
      method: 'POST', headers: hj(adminToken), body: JSON.stringify({ setor: '', atividade: 'Validar embalagem' })
    }).then((r) => r.json()).then((d) => d.item);
    check('cria item sem setor definido ainda (a Raquel disse que ainda não tem)', item1.atividade === 'Validar embalagem' && item1.setor === '');
    const item2 = await fetch(`${BASE}/api/produtos/checklist-template`, {
      method: 'POST', headers: hj(adminToken), body: JSON.stringify({ setor: 'Fiscal', atividade: 'Emitir nota de homologação' })
    }).then((r) => r.json()).then((d) => d.item);
    check('cria item com setor já definido', item2.setor === 'Fiscal' && item2.atividade === 'Emitir nota de homologação');

    // ---------- editar um item do modelo (agora já com o setor) ----------
    const item1Editado = await fetch(`${BASE}/api/produtos/checklist-template/${item1.id}`, {
      method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ setor: 'Embalagem' })
    }).then((r) => r.json()).then((d) => d.item);
    check('editar o item só pra incluir o setor (depois de saber qual é) funciona', item1Editado.setor === 'Embalagem' && item1Editado.atividade === 'Validar embalagem');

    // ---------- lançamento novo já nasce com o checklist do modelo ----------
    const lancamento = await fetch(`${BASE}/api/produtos/lancamentos`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ brand: 'debacco', produto: 'Torneira', nome: 'Torneira Teste 96', codigo: 'T-096' })
    }).then((r) => r.json()).then((d) => d.item);
    check('lançamento novo já nasce com os 2 itens do checklist', lancamento.checklist.length === 2);
    check('checklist nasce todo desmarcado', lancamento.checklist.every((c) => c.concluido === false));

    // ---------- marcar 1 item como conferido ----------
    const marcado = await fetch(`${BASE}/api/produtos/lancamentos/${lancamento.id}/checklist/${item1.id}`, {
      method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ concluido: true })
    }).then((r) => r.json()).then((d) => d.item);
    const itemMarcado = marcado.checklist.find((c) => c.templateItemId === item1.id);
    check('item marcado como conferido', itemMarcado.concluido === true);
    check('carimba quem conferiu', itemMarcado.concluidoByName === 'Admin Teste');
    check('carimba quando conferiu', !!itemMarcado.concluidoAt);
    const itemNaoMarcado = marcado.checklist.find((c) => c.templateItemId === item2.id);
    check('o outro item continua desmarcado (não mexeu nele)', itemNaoMarcado.concluido === false);

    // ---------- adiciona item NOVO no modelo depois do lançamento já existir ----------
    const item3 = await fetch(`${BASE}/api/produtos/checklist-template`, {
      method: 'POST', headers: hj(adminToken), body: JSON.stringify({ setor: 'Engenharia', atividade: 'Validar desenho técnico' })
    }).then((r) => r.json()).then((d) => d.item);
    const listaDepois = await fetch(`${BASE}/api/produtos/lancamentos`, { headers: hj(adminToken) }).then((r) => r.json());
    const lancamentoDepois = listaDepois.items.find((it) => it.id === lancamento.id);
    check('o lançamento já existente ganhou o item novo do modelo (soma, não substitui)', lancamentoDepois.checklist.length === 3);
    check('o item marcado antes continua marcado depois de somar o item novo', lancamentoDepois.checklist.find((c) => c.templateItemId === item1.id).concluido === true);
    check('o item novo chega desmarcado', lancamentoDepois.checklist.find((c) => c.templateItemId === item3.id).concluido === false);

    // ---------- excluir item do modelo não apaga o histórico de quem já conferiu ----------
    await fetch(`${BASE}/api/produtos/checklist-template/${item2.id}`, { method: 'DELETE', headers: hj(adminToken) });
    const modeloDepoisExcluir = await fetch(`${BASE}/api/produtos/checklist-template`, { headers: hj(adminToken) }).then((r) => r.json());
    check('item excluído some do MODELO', !modeloDepoisExcluir.items.some((it) => it.id === item2.id));
    const listaFinal = await fetch(`${BASE}/api/produtos/lancamentos`, { headers: hj(adminToken) }).then((r) => r.json());
    const lancamentoFinal = listaFinal.items.find((it) => it.id === lancamento.id);
    check('[nunca perder dado] o item excluído do modelo continua no checklist do lançamento que já existia', lancamentoFinal.checklist.some((c) => c.templateItemId === item2.id));

    // ---------- lançamento bem antigo (sem checklist nenhum) continua funcionando ----------
    const antigo = listaFinal.items.find((it) => it.id === 'lancamento-bem-antigo-96');
    check('[nunca perder dado] lançamento de antes desta rodada continua existindo, sem quebrar', !!antigo);
    check('lançamento antigo ganha o checklist atual na leitura (3 itens, mesmo sem ter sido criado com nenhum)', antigo && antigo.checklist.length === 3);
    check('checklist do lançamento antigo nasce todo desmarcado (nunca foi conferido de verdade)', antigo && antigo.checklist.every((c) => c.concluido === false));

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
