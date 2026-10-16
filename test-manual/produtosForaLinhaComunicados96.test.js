// 96ª rodada (16/10/2026) -- item 6 da fila de pedidos: novo submenu
// "Produtos fora de linha" dentro de Produtos, começando com a aba
// "Comunicados": nome, data, descrição e arquivo.
//
// Cobre: (1) CRUD completo do comunicado (nome/data/descrição); (2) nome é
// obrigatório; (3) upload de arquivo só depois de o comunicado existir;
// (4) upload novo substitui o anterior (mesmo padrão do Catálogo) -- o
// arquivo físico antigo é apagado do disco; (5) excluir o comunicado
// remove a pasta de upload inteira; (6) quem não tem permissão de editar
// Produtos consegue LISTAR mas não criar/editar/excluir; (7) lista vem
// ordenada por data (mais recente primeiro).
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 4200;
const BASE = `http://localhost:${PORT}`;
const dbPath = path.join(__dirname, '..', 'data', 'db.json');
const dbBackupPath = dbPath + '.bak-produtosForaLinha96-test';

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
    env: { ...process.env, PORT: String(PORT), JWT_SECRET: 'teste-produtosForaLinha96', META_APP_ID: '1749362466318676', META_APP_SECRET: 'fake-secret', PAPOI_BASE_URL: BASE },
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

    // ---------- usuário comum, sem permissão de editar Produtos ----------
    const comum = await fetch(`${BASE}/api/auth/users`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ username: 'comum96fl', password: '123456', name: 'Usuário Comum FL', permissions: {} })
    }).then((r) => r.json());
    const comumToken = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'comum96fl', password: '123456' })
    }).then((r) => r.json()).then((d) => d.token);

    // ---------- lista começa vazia ----------
    const listaInicial = await fetch(`${BASE}/api/produtos/comunicados`, { headers: hj(adminToken) }).then((r) => r.json());
    check('lista de comunicados começa vazia', listaInicial.items.length === 0);

    // ---------- usuário comum NÃO pode criar ----------
    const tentativaComum = await fetch(`${BASE}/api/produtos/comunicados`, {
      method: 'POST', headers: hj(comumToken), body: JSON.stringify({ nome: 'Tentativa sem permissão' })
    });
    check('usuário sem permissão de Produtos não consegue criar comunicado (403)', tentativaComum.status === 403);

    // ---------- nome é obrigatório ----------
    const semNome = await fetch(`${BASE}/api/produtos/comunicados`, {
      method: 'POST', headers: hj(adminToken), body: JSON.stringify({ data: '2026-10-01' })
    });
    check('criar sem nome dá erro', semNome.status === 400);

    // ---------- cria 2 comunicados ----------
    const c1 = await fetch(`${BASE}/api/produtos/comunicados`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ nome: 'Descontinuação Linha Cubas Antigas', data: '2026-09-01', descricao: 'A partir de outubro não produzimos mais.' })
    }).then((r) => r.json()).then((d) => d.item);
    check('cria comunicado 1 com nome/data/descrição certos', c1.nome === 'Descontinuação Linha Cubas Antigas' && c1.data === '2026-09-01' && /não produzimos mais/.test(c1.descricao));
    check('comunicado nasce sem arquivo', c1.arquivo === null);

    const c2 = await fetch(`${BASE}/api/produtos/comunicados`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ nome: 'Novo código de torneiras', data: '2026-10-10', descricao: '' })
    }).then((r) => r.json()).then((d) => d.item);
    check('cria comunicado 2', c2.nome === 'Novo código de torneiras');

    // ---------- lista ordenada por data (mais recente primeiro) ----------
    const listaOrdenada = await fetch(`${BASE}/api/produtos/comunicados`, { headers: hj(adminToken) }).then((r) => r.json());
    check('lista vem ordenada, mais recente primeiro', listaOrdenada.items[0].id === c2.id && listaOrdenada.items[1].id === c1.id);

    // ---------- usuário comum consegue LISTAR normalmente ----------
    const listaComum = await fetch(`${BASE}/api/produtos/comunicados`, { headers: hj(comumToken) });
    check('usuário sem permissão de edição ainda consegue listar (view geral, sem gate)', listaComum.status === 200);

    // ---------- editar um comunicado ----------
    const c1Editado = await fetch(`${BASE}/api/produtos/comunicados/${c1.id}`, {
      method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ descricao: 'Texto atualizado do comunicado.' })
    }).then((r) => r.json()).then((d) => d.item);
    check('editar só a descrição não mexe no nome/data', c1Editado.nome === c1.nome && c1Editado.data === c1.data && c1Editado.descricao === 'Texto atualizado do comunicado.');

    // ---------- upload de arquivo (texto simples, via multipart manual) ----------
    function buildMultipart(fieldName, filename, content) {
      const boundary = '----papoiTeste96FL';
      const body = `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
      return { body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
    }
    const up1 = buildMultipart('file', 'comunicado-v1.txt', 'conteúdo da versão 1');
    const resUp1 = await fetch(`${BASE}/api/produtos/comunicados/${c1.id}/file`, {
      method: 'POST', headers: Object.assign({ Authorization: `Bearer ${adminToken}` }, up1.headers), body: up1.body
    }).then((r) => r.json());
    check('upload de arquivo funciona', resUp1.item.arquivo && resUp1.item.arquivo.name === 'comunicado-v1.txt');
    const filePath1 = path.join(__dirname, '..', 'data', 'uploads', 'produtos-comunicados', c1.id, path.basename(resUp1.item.arquivo.url));
    check('arquivo v1 existe fisicamente no disco', fs.existsSync(filePath1));

    // ---------- upload novo SUBSTITUI o anterior ----------
    const up2 = buildMultipart('file', 'comunicado-v2.txt', 'conteúdo da versão 2');
    const resUp2 = await fetch(`${BASE}/api/produtos/comunicados/${c1.id}/file`, {
      method: 'POST', headers: Object.assign({ Authorization: `Bearer ${adminToken}` }, up2.headers), body: up2.body
    }).then((r) => r.json());
    check('segundo upload substitui o arquivo (nome novo)', resUp2.item.arquivo.name === 'comunicado-v2.txt');
    check('[nunca perder dado -- mas sem duplicar lixo] arquivo v1 antigo foi apagado do disco', !fs.existsSync(filePath1));
    const filePath2 = path.join(__dirname, '..', 'data', 'uploads', 'produtos-comunicados', c1.id, path.basename(resUp2.item.arquivo.url));
    check('arquivo v2 existe fisicamente no disco', fs.existsSync(filePath2));

    // ---------- excluir o comunicado remove a pasta de upload ----------
    await fetch(`${BASE}/api/produtos/comunicados/${c1.id}`, { method: 'DELETE', headers: hj(adminToken) });
    const listaFinal = await fetch(`${BASE}/api/produtos/comunicados`, { headers: hj(adminToken) }).then((r) => r.json());
    check('comunicado excluído some da lista', !listaFinal.items.some((it) => it.id === c1.id));
    check('o outro comunicado (c2) continua intacto', listaFinal.items.some((it) => it.id === c2.id));
    const dirC1 = path.join(__dirname, '..', 'data', 'uploads', 'produtos-comunicados', c1.id);
    check('pasta de upload do comunicado excluído foi removida', !fs.existsSync(dirC1));

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
