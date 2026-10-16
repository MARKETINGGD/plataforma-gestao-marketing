// 95ª rodada (16/10/2026) -- item 1 da fila de pedidos: "ao exportar em
// pdf ou excel, não aparece a informação de quem cadastrou, preciso que
// isso seja ajustado, acho melhor ter uma coluna com data e nome de quem
// fez a edição, isso em todas as abas do controle de brindes. E o que já
// esta casdatrado, n pode se perder."
//
// Antes desta rodada, o Catálogo de Brindes só guardava autoria POR
// PRAÇA de estoque (62ª rodada, tooltip ⓘ só na tela) -- editar outro
// campo (código, valor, status, obs) não carimbava nada, e nada disso
// sobrevivia à exportação Excel/PDF de qualquer forma, já que a
// exportação nunca lia esses campos. Este teste cobre o backend: um
// item novo já nasce com createdBy/createdByName, QUALQUER edição
// carimba um updatedBy/updatedByName geral (além dos carimbos por
// praça, que continuam intactos), e um item antigo (sem nenhum desses
// campos, como os semeados da planilha original) nunca quebra nem perde
// o que já tinha -- só aparece sem autoria até a próxima edição.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 4196;
const BASE = `http://localhost:${PORT}`;
const dbPath = path.join(__dirname, '..', 'data', 'db.json');
const dbBackupPath = dbPath + '.bak-brindesAutoria95-test';

let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}
function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }

async function main() {
  if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, dbBackupPath);
  // Semeia o item "estilo antigo" ANTES de subir o servidor -- o lowdb lê
  // o arquivo inteiro pra memória na primeira vez que o processo sobe, só
  // escrevendo de volta quando algo muda (`.write()`); editar o arquivo
  // DEPOIS do servidor já estar de pé seria invisível pro processo (ele
  // sobrescreveria na primeira gravação, perdendo o item de teste).
  const itemAntigo = db_seedOldStyleItem();

  const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), JWT_SECRET: 'teste-brindesAutoria95', META_APP_ID: '1749362466318676', META_APP_SECRET: 'fake-secret', PAPOI_BASE_URL: BASE },
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

    // ---------- 1. item já cadastrado ANTES desta rodada (sem createdBy/updatedBy) não quebra ----------
    const listaAntes = await fetch(`${BASE}/api/brindes/catalog?brand=debacco`, { headers: hj(adminToken) }).then((r) => r.json());
    const achadoAntigo = listaAntes.items.find((it) => it.id === itemAntigo.id);
    check('item semeado antes desta rodada continua existindo, com os mesmos dados', !!achadoAntigo && achadoAntigo.item === itemAntigo.item);
    check('item antigo sem autoria não quebra a serialização (fica undefined, não lança erro)', achadoAntigo.createdByName === undefined && achadoAntigo.updatedByName === undefined);

    // ---------- 2. item criado AGORA já nasce com createdBy/createdByName ----------
    const criado = await fetch(`${BASE}/api/brindes/catalog`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ brand: 'debacco', item: 'Item Teste Autoria 95', estoquePR: 10, estoqueSP: 10, estoquePE: 10 })
    }).then((r) => r.json()).then((d) => d.item);
    check('item novo nasce com createdByName preenchido', criado.createdByName === 'Admin Teste');
    check('item novo nasce com updatedByName preenchido (mesmo antes de qualquer edição)', criado.updatedByName === 'Admin Teste');

    // ---------- 3. editar QUALQUER campo (não só estoque) carimba updatedBy geral ----------
    await new Promise((r) => setTimeout(r, 1100)); // garante um updatedAt diferente do createdAt
    const outraUsuaria = await fetch(`${BASE}/api/auth/users`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ username: 'autoria95b', password: '123456', name: 'Outra Pessoa Autoria95', cargo: 'analista', permissions: { brindes: 'editor' } })
    }).then((r) => r.json()).then((d) => d.user);
    const outroToken = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'autoria95b', password: '123456' })
    }).then((r) => r.json()).then((d) => d.token);

    await fetch(`${BASE}/api/brindes/catalog/${criado.id}`, {
      method: 'PUT', headers: hj(outroToken), body: JSON.stringify({ status: 'Revisado' })
    });
    const listaDepois = await fetch(`${BASE}/api/brindes/catalog?brand=debacco`, { headers: hj(adminToken) }).then((r) => r.json());
    const itemDepois = listaDepois.items.find((it) => it.id === criado.id);
    check('editar SÓ o status (não é campo de estoque) atualiza o updatedByName geral', itemDepois.updatedByName === 'Outra Pessoa Autoria95');
    check('o createdByName original continua intacto (a edição não apaga quem cadastrou)', itemDepois.createdByName === 'Admin Teste');
    check('updatedAt mudou pra depois do createdAt', new Date(itemDepois.updatedAt).getTime() > new Date(itemDepois.createdAt).getTime());

    // ---------- 4. link externo em modo edição também carimba o updatedBy geral ----------
    const linkGerado = await fetch(`${BASE}/api/brindes/public-link/generate`, {
      method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'debacco', mode: 'edicao' })
    }).then((r) => r.json());
    await fetch(`${BASE}/api/brindes/public/${linkGerado.publicToken}/catalog/${criado.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: 'Visitante Teste', estoquePR: 99 })
    });
    const listaPosLink = await fetch(`${BASE}/api/brindes/catalog?brand=debacco`, { headers: hj(adminToken) }).then((r) => r.json());
    const itemPosLink = listaPosLink.items.find((it) => it.id === criado.id);
    check('edição via link externo também atualiza o updatedByName geral (com o texto "via link externo")', /Visitante Teste.*via link externo/.test(itemPosLink.updatedByName || ''));

    // ---------- 5. Registro de Saídas (log) já tinha createdBy/createdByName -- confere que continua ----------
    const catalogoParaLog = await fetch(`${BASE}/api/brindes/catalog?brand=debacco`, { headers: hj(adminToken) }).then((r) => r.json()).then((d) => d.items[0]);
    const logCriado = await fetch(`${BASE}/api/brindes/log`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ brand: 'debacco', cliente: 'Cliente Autoria95', items: [{ catalogItemId: catalogoParaLog.id, quantidade: 1 }] })
    }).then((r) => r.json()).then((d) => d.item);
    const listaLog = await fetch(`${BASE}/api/brindes/log?brand=debacco`, { headers: hj(adminToken) }).then((r) => r.json());
    const logNaLista = listaLog.items.find((r) => r.id === logCriado.id);
    check('Registro de Saídas: createdByName vem preenchido pra alimentar a coluna de autoria', logNaLista.createdByName === 'Admin Teste');

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

// Insere, DIRETO no db.json (sem passar pela API), um item do jeito que
// ficava ANTES desta rodada (sem createdBy/createdByName/updatedBy/
// updatedByName) -- simula fielmente um item já cadastrado antes da
// correção, pra provar que ele não quebra nem perde dado nenhum.
function db_seedOldStyleItem() {
  const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const item = {
    id: 'item-estilo-antigo-95-' + Date.now(),
    brand: 'debacco', group: 'Brindes', code: '00.00.00000', item: 'Item Estilo Antigo PR95',
    multiplo: '1', valor: 9.9, estoquePR: 5, estoqueSP: 5, estoquePE: 5, estoqueTotal: 15,
    status: '', obs: '', updatedAt: new Date().toISOString()
    // (sem createdBy/createdByName/updatedBy/updatedByName de propósito)
  };
  raw.brindesCatalog.push(item);
  fs.writeFileSync(dbPath, JSON.stringify(raw, null, 2));
  return item;
}

main().catch((e) => { console.error(e); process.exit(1); });
