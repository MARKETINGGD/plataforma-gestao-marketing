// 96ª rodada (16/10/2026) -- item 3 da fila de pedidos: "em brindes,
// registro de saida, deve ter a opção de editar e de selecionar mais de
// uma marca em uma mesma retirada, por exe copos - ghelplus, avental- de
// bacco, tudo na mesma retirada, e ai esses itens devem sair do estoque
// de cada marca, de forma organizada."
//
// Cobre: (1) PUT /log/:id edita uma saída já existente; (2) POST /log
// aceita itens de marcas diferentes na mesma saída, descontando do
// estoque de CADA marca certinho; (3) editar os itens desfaz a dedução
// antiga e aplica a nova (sem duplicar nem perder desconto); (4) editar
// só um campo que não é item (ex. motivo) preserva os itens e a marca;
// (5) o link externo de uma marca só mostra os itens daquela marca numa
// saída mista (nunca vaza o que saiu de outra marca); (6) registro bem
// antigo (de antes da 88ª rodada, sem `items` nenhum) continua
// aparecendo certinho, com a marca inferida -- nenhum dado perdido.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 4198;
const BASE = `http://localhost:${PORT}`;
const dbPath = path.join(__dirname, '..', 'data', 'db.json');
const dbBackupPath = dbPath + '.bak-brindesSaidaMultimarca96-test';

let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}
function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }

// Registro "bem antigo" (de antes da 88ª rodada) -- sem `items` nenhum,
// só os campos diretos no registro. Precisa ser injetado no db.json
// ANTES do servidor subir (lowdb carrega tudo em memória uma vez só).
function seedOldStyleLogEntry() {
  const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const catalogDebacco = (raw.brindesCatalog || []).find((it) => it.brand === 'debacco');
  if (!catalogDebacco) throw new Error('catálogo de teste sem item De Bacco pra semear o registro antigo');
  raw.brindesLog = raw.brindesLog || [];
  raw.brindesLog.push({
    id: 'log-bem-antigo-96',
    brand: 'debacco',
    date: '2025-01-10',
    gerente: '',
    representante: 'Representante Antigo',
    estado: 'PR',
    cliente: 'Cliente Antigo',
    catalogItemId: catalogDebacco.id,
    item: catalogDebacco.item,
    quantidade: 2,
    estoqueDeduzido: { estoquePR: 2, estoqueSP: 0, estoquePE: 0 },
    motivo: 'Registro de antes da 88ª rodada (sem items[])',
    createdAt: '2025-01-10T10:00:00.000Z',
    createdBy: null,
    createdByName: 'Sistema (dado histórico)'
  });
  fs.writeFileSync(dbPath, JSON.stringify(raw, null, 2));
  return catalogDebacco.id;
}

async function main() {
  if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, dbBackupPath);
  const oldEntryCatalogId = seedOldStyleLogEntry();

  const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), JWT_SECRET: 'teste-saidaMultimarca96', META_APP_ID: '1749362466318676', META_APP_SECRET: 'fake-secret', PAPOI_BASE_URL: BASE },
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

    // ---------- registro bem antigo (sem items[]) continua funcionando ----------
    const logList1 = await fetch(`${BASE}/api/brindes/log`, { headers: hj(adminToken) }).then((r) => r.json());
    const antigo = logList1.items.find((r) => r.id === 'log-bem-antigo-96');
    check('registro de antes da 88ª rodada (sem items[]) continua existindo, sem quebrar', !!antigo);
    check('registro antigo ganha items[] com 1 item na leitura (compat on-read)', antigo && antigo.items.length === 1 && antigo.items[0].quantidade === 2);
    check('registro antigo tem a marca inferida certinho (debacco)', antigo && antigo.brand === 'debacco' && antigo.items[0].brand === 'debacco');

    // ---------- acha 1 item De Bacco e 1 item GhelPlus pra testar multimarca ----------
    const [catDebacco, catGhel] = await Promise.all([
      fetch(`${BASE}/api/brindes/catalog?brand=debacco`, { headers: hj(adminToken) }).then((r) => r.json()),
      fetch(`${BASE}/api/brindes/catalog?brand=ghelplus`, { headers: hj(adminToken) }).then((r) => r.json())
    ]);
    const avental = catDebacco.items.find((it) => it.item === 'Avental');
    const copoGhel = catGhel.items.find((it) => it.item === 'Copo Stanley - AZ2024');
    check('achou o item "Avental" (De Bacco) no catálogo de teste', !!avental);
    check('achou o item "Copo Stanley - AZ2024" (GhelPlus) no catálogo de teste', !!copoGhel);
    const aventalEstoqueAntes = avental.estoqueTotal;
    const copoGhelEstoqueAntes = copoGhel.estoqueTotal;

    // ---------- criar saída com itens de 2 marcas diferentes (mesmo exemplo da Raquel) ----------
    const criada = await fetch(`${BASE}/api/brindes/log`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({
        date: '2026-10-16', representante: 'Representante Teste', estado: 'SP', cliente: 'Cliente Misto',
        motivo: 'Teste retirada multimarca',
        items: [
          { catalogItemId: avental.id, quantidade: 3 },
          { catalogItemId: copoGhel.id, quantidade: 5 }
        ]
      })
    }).then((r) => r.json()).then((d) => d.item);
    check('saída multimarca criada com os 2 itens', criada.items.length === 2);
    check('"brands" lista as 2 marcas (debacco e ghelplus)', criada.brands.includes('debacco') && criada.brands.includes('ghelplus'));
    check('cada item guarda sua própria marca (avental=debacco, copo=ghelplus)', criada.items.find((it) => it.catalogItemId === avental.id).brand === 'debacco' && criada.items.find((it) => it.catalogItemId === copoGhel.id).brand === 'ghelplus');

    // Confirma que o estoque saiu de CADA marca, de forma organizada --
    // nada vaza pra outra marca.
    const [catDebaccoDepois, catGhelDepois] = await Promise.all([
      fetch(`${BASE}/api/brindes/catalog?brand=debacco`, { headers: hj(adminToken) }).then((r) => r.json()),
      fetch(`${BASE}/api/brindes/catalog?brand=ghelplus`, { headers: hj(adminToken) }).then((r) => r.json())
    ]);
    const aventalDepois = catDebaccoDepois.items.find((it) => it.id === avental.id);
    const copoGhelDepois = catGhelDepois.items.find((it) => it.id === copoGhel.id);
    check('estoque do Avental (De Bacco) caiu exatamente 3', aventalDepois.estoqueTotal === aventalEstoqueAntes - 3);
    check('estoque do Copo (GhelPlus) caiu exatamente 5, sem mexer no De Bacco', copoGhelDepois.estoqueTotal === copoGhelEstoqueAntes - 5);

    // ---------- GET /log?brand= acha a saída mista pelos dois lados ----------
    const porDebacco = await fetch(`${BASE}/api/brindes/log?brand=debacco`, { headers: hj(adminToken) }).then((r) => r.json());
    const porGhel = await fetch(`${BASE}/api/brindes/log?brand=ghelplus`, { headers: hj(adminToken) }).then((r) => r.json());
    check('filtro por marca "debacco" encontra a saída mista', porDebacco.items.some((r) => r.id === criada.id));
    check('filtro por marca "ghelplus" TAMBÉM encontra a mesma saída mista', porGhel.items.some((r) => r.id === criada.id));

    // ---------- editar: trocar só o motivo não mexe nos itens/marca ----------
    const editadaMotivo = await fetch(`${BASE}/api/brindes/log/${criada.id}`, {
      method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ motivo: 'Motivo editado' })
    }).then((r) => r.json()).then((d) => d.item);
    check('editar só o motivo atualiza o motivo', editadaMotivo.motivo === 'Motivo editado');
    check('editar só o motivo preserva os 2 itens e as 2 marcas', editadaMotivo.items.length === 2 && editadaMotivo.brands.length === 2);
    check('edição carimba quem editou por último', editadaMotivo.updatedByName === 'Admin Teste');

    // ---------- editar os itens: reduzir quantidade do Avental pra 1 (de 3) ----------
    const editadaItens = await fetch(`${BASE}/api/brindes/log/${criada.id}`, {
      method: 'PUT', headers: hj(adminToken),
      body: JSON.stringify({ items: [
        { catalogItemId: avental.id, quantidade: 1 },
        { catalogItemId: copoGhel.id, quantidade: 5 }
      ] })
    }).then((r) => r.json()).then((d) => d.item);
    check('editar os itens aceita a nova quantidade do Avental (1)', editadaItens.items.find((it) => it.catalogItemId === avental.id).quantidade === 1);
    const [catDebaccoFinal] = await Promise.all([
      fetch(`${BASE}/api/brindes/catalog?brand=debacco`, { headers: hj(adminToken) }).then((r) => r.json())
    ]);
    const aventalFinal = catDebaccoFinal.items.find((it) => it.id === avental.id);
    // Desfez a dedução de 3 e aplicou a de 1 -- saldo final é só -1 em
    // relação ao estoque original (não -3 nem -4).
    check('editar os itens desfaz a dedução antiga e aplica a nova certinho (estoque final = original - 1)', aventalFinal.estoqueTotal === aventalEstoqueAntes - 1);

    // ---------- link externo de uma marca não vaza itens da outra ----------
    const linkGen = await fetch(`${BASE}/api/brindes/log/public-link/generate`, {
      method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'ghelplus', mode: 'leitura' })
    }).then((r) => r.json());
    const publicView = await fetch(`${BASE}/api/brindes/log/public/${linkGen.publicToken}`).then((r) => r.json());
    const saidaMistaNoLink = publicView.items.find((r) => r.id === criada.id);
    check('link externo da GhelPlus encontra a saída mista', !!saidaMistaNoLink);
    check('link externo da GhelPlus só mostra o item da GhelPlus (não vaza o Avental da De Bacco)', saidaMistaNoLink && saidaMistaNoLink.items.length === 1 && saidaMistaNoLink.items[0].brand === 'ghelplus');

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
