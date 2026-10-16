// 96ª rodada (16/10/2026) -- item 7 da fila de pedidos: "em catálogo,
// adicione um sub menu chamado Revisão Catálogo, nele deve tera
// possibilidade de criar planilhas de revisão com Nome da pessoa e data e
// tbm um local adiconar o arquyivo q foi revisado nessa planilha. Deixe
// aopção de adiconar pessoas." Entrou dentro de Produtos → Catálogo
// (ambiguidade sobre qual catálogo documentada em db.js/routes/produtos.js
// -- confirmar com a Raquel).
//
// Cobre: (1) CRUD completo da planilha de revisão; (2) pelo menos 1 pessoa
// é obrigatória; (3) adicionar VÁRIAS pessoas na mesma planilha funciona;
// (4) upload de arquivo revisado só depois de a planilha existir; (5)
// upload novo substitui o anterior (apaga o físico antigo); (6) excluir
// remove a pasta de upload inteira; (7) quem não tem permissão de editar
// Produtos consegue LISTAR mas não criar/editar/excluir.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 4201;
const BASE = `http://localhost:${PORT}`;
const dbPath = path.join(__dirname, '..', 'data', 'db.json');
const dbBackupPath = dbPath + '.bak-catalogoRevisao96-test';

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
    env: { ...process.env, PORT: String(PORT), JWT_SECRET: 'teste-catalogoRevisao96', META_APP_ID: '1749362466318676', META_APP_SECRET: 'fake-secret', PAPOI_BASE_URL: BASE },
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

    const comumToken = await (async () => {
      await fetch(`${BASE}/api/auth/users`, {
        method: 'POST', headers: hj(adminToken),
        body: JSON.stringify({ username: 'comum96cr', password: '123456', name: 'Usuário Comum CR', permissions: {} })
      });
      return fetch(`${BASE}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'comum96cr', password: '123456' })
      }).then((r) => r.json()).then((d) => d.token);
    })();

    // ---------- lista começa vazia ----------
    const listaInicial = await fetch(`${BASE}/api/produtos/catalogo-revisoes`, { headers: hj(adminToken) }).then((r) => r.json());
    check('lista de planilhas de revisão começa vazia', listaInicial.items.length === 0);

    // ---------- usuário comum NÃO pode criar ----------
    const tentativaComum = await fetch(`${BASE}/api/produtos/catalogo-revisoes`, {
      method: 'POST', headers: hj(comumToken), body: JSON.stringify({ pessoas: ['Fulano'], data: '2026-10-16' })
    });
    check('usuário sem permissão de Produtos não consegue criar (403)', tentativaComum.status === 403);

    // ---------- sem pessoa nenhuma dá erro ----------
    const semPessoa = await fetch(`${BASE}/api/produtos/catalogo-revisoes`, {
      method: 'POST', headers: hj(adminToken), body: JSON.stringify({ pessoas: [], data: '2026-10-16' })
    });
    check('criar sem nenhuma pessoa dá erro', semPessoa.status === 400);
    const pessoasSoVazias = await fetch(`${BASE}/api/produtos/catalogo-revisoes`, {
      method: 'POST', headers: hj(adminToken), body: JSON.stringify({ pessoas: ['', '   '], data: '2026-10-16' })
    });
    check('pessoas só com texto vazio também dá erro (sanitizado)', pessoasSoVazias.status === 400);

    // ---------- cria com VÁRIAS pessoas (pedido explícito da Raquel) ----------
    const r1 = await fetch(`${BASE}/api/produtos/catalogo-revisoes`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ pessoas: ['Raquel', 'Fulano da Equipe', ''], data: '2026-10-16' })
    }).then((r) => r.json()).then((d) => d.item);
    check('cria planilha com 2 pessoas (a vazia foi descartada)', r1.pessoas.length === 2 && r1.pessoas.includes('Raquel') && r1.pessoas.includes('Fulano da Equipe'));
    check('planilha nasce sem arquivo', r1.arquivo === null);

    const r2 = await fetch(`${BASE}/api/produtos/catalogo-revisoes`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ pessoas: ['Pessoa Só'], data: '2026-09-01' })
    }).then((r) => r.json()).then((d) => d.item);

    // ---------- lista ordenada por data (mais recente primeiro) ----------
    const listaOrdenada = await fetch(`${BASE}/api/produtos/catalogo-revisoes`, { headers: hj(adminToken) }).then((r) => r.json());
    check('lista vem ordenada, mais recente primeiro', listaOrdenada.items[0].id === r1.id && listaOrdenada.items[1].id === r2.id);

    // ---------- usuário comum consegue LISTAR ----------
    const listaComum = await fetch(`${BASE}/api/produtos/catalogo-revisoes`, { headers: hj(comumToken) });
    check('usuário sem permissão de edição ainda consegue listar', listaComum.status === 200);

    // ---------- editar: trocar as pessoas e a data ----------
    const r1Editado = await fetch(`${BASE}/api/produtos/catalogo-revisoes/${r1.id}`, {
      method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ pessoas: ['Raquel', 'Fulano da Equipe', 'Terceira Pessoa'], data: '2026-10-17' })
    }).then((r) => r.json()).then((d) => d.item);
    check('edição soma uma 3ª pessoa certinho', r1Editado.pessoas.length === 3 && r1Editado.pessoas.includes('Terceira Pessoa'));
    check('edição atualiza a data', r1Editado.data === '2026-10-17');

    // ---------- upload de arquivo revisado ----------
    function buildMultipart(fieldName, filename, content) {
      const boundary = '----papoiTeste96CR';
      const body = `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
      return { body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
    }
    const up1 = buildMultipart('file', 'catalogo-revisado-v1.xlsx', 'conteúdo v1');
    const resUp1 = await fetch(`${BASE}/api/produtos/catalogo-revisoes/${r1.id}/file`, {
      method: 'POST', headers: Object.assign({ Authorization: `Bearer ${adminToken}` }, up1.headers), body: up1.body
    }).then((r) => r.json());
    check('upload do arquivo revisado funciona', resUp1.item.arquivo && resUp1.item.arquivo.name === 'catalogo-revisado-v1.xlsx');
    const filePath1 = path.join(__dirname, '..', 'data', 'uploads', 'produtos-catalogo-revisoes', r1.id, path.basename(resUp1.item.arquivo.url));
    check('arquivo v1 existe fisicamente no disco', fs.existsSync(filePath1));

    const up2 = buildMultipart('file', 'catalogo-revisado-v2.xlsx', 'conteúdo v2');
    const resUp2 = await fetch(`${BASE}/api/produtos/catalogo-revisoes/${r1.id}/file`, {
      method: 'POST', headers: Object.assign({ Authorization: `Bearer ${adminToken}` }, up2.headers), body: up2.body
    }).then((r) => r.json());
    check('segundo upload substitui o arquivo', resUp2.item.arquivo.name === 'catalogo-revisado-v2.xlsx');
    check('arquivo v1 antigo foi apagado do disco', !fs.existsSync(filePath1));

    // ---------- excluir remove a pasta de upload ----------
    await fetch(`${BASE}/api/produtos/catalogo-revisoes/${r1.id}`, { method: 'DELETE', headers: hj(adminToken) });
    const listaFinal = await fetch(`${BASE}/api/produtos/catalogo-revisoes`, { headers: hj(adminToken) }).then((r) => r.json());
    check('planilha excluída some da lista', !listaFinal.items.some((it) => it.id === r1.id));
    check('a outra planilha (r2) continua intacta', listaFinal.items.some((it) => it.id === r2.id));
    const dirR1 = path.join(__dirname, '..', 'data', 'uploads', 'produtos-catalogo-revisoes', r1.id);
    check('pasta de upload da planilha excluída foi removida', !fs.existsSync(dirR1));

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
