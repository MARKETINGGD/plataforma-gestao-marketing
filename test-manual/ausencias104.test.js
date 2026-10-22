// Teste de integração (servidor de verdade, mesmo padrão dos demais
// test-manual/*.test.js) da 104ª rodada -- pedido da Raquel: "adicione
// tbm, em usuários, uma aba com um calendário e nele deve ter a opção de
// cadastrar os dias de férias, afastamentos, saidas fora do horário de
// cada colaborador e nesse calendario deve mostrar quem estava ausente
// nasqueles dias." Mais 3 efeitos em cascata também cobertos aqui:
//   1. Aviso na coluna da pessoa em Demandas (checado via a listagem
//      enxuta GET /api/ausencias/publicas, aberta a qualquer logado).
//   2. Comunicado automático em Recados quando uma ausência é cadastrada
//      (broadcast pra toda a equipe).
//   3. Acesso: ver o calendário completo segue a mesma regra de
//      Configurações (103ª rodada) -- visualizar/admin pra VER, super
//      admin de verdade pra criar/editar/excluir.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-ausencias-104';
process.env.PORT = '4370';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4370';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-ausencias-104-test');
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

  const BASE = 'http://localhost:4370';
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
      body: JSON.stringify({ name: 'Admin Ausencias 104', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
  } else {
    adminToken = await login('admin', '123456');
  }
  check('login/setup do admin devolveu token', !!adminToken);

  // Colaborador que vai tirar férias.
  const colab = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'colabFerias104', password: '123456', name: 'Colaboradora Férias 104' })
  }).then((r) => r.json()).then((d) => d.user);

  // Pessoa comum (sem nenhuma permissão) -- usada pra testar acesso.
  await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'semAcessoAus104', password: '123456', name: 'Sem Acesso Ausências 104' })
  });
  const tokenSemAcesso = await login('semAcessoAus104', '123456');

  // ---------- 1. Acesso: listagem completa é restrita (igual Configurações) ----------
  const listaBloqueada = await fetch(`${BASE}/api/ausencias`, { headers: hj(tokenSemAcesso) });
  check('[104ª rodada] usuário sem permissão NÃO vê a listagem completa de ausências (403)', listaBloqueada.status === 403);

  const listaAdminOk = await fetch(`${BASE}/api/ausencias`, { headers: hj(adminToken) });
  check('[104ª rodada] super admin sempre vê a listagem completa (200)', listaAdminOk.status === 200);

  // ---------- 2. Listagem enxuta (`/publicas`) é aberta a qualquer logado ----------
  const publicasSemAcesso = await fetch(`${BASE}/api/ausencias/publicas`, { headers: hj(tokenSemAcesso) });
  check('[104ª rodada] qualquer pessoa logada vê a listagem enxuta (/publicas), mesmo sem permissão de Configurações (200)', publicasSemAcesso.status === 200);

  // ---------- 3. Criar ausência: só super admin, mesmo com "visualizar" em Configurações ----------
  await fetch(`${BASE}/api/auth/users/${(db.get('users').find({ username: 'semAcessoAus104' }).value()).id}`, {
    method: 'PUT', headers: hj(adminToken),
    body: JSON.stringify({ permissions: Object.assign({}, db.get('users').find({ username: 'semAcessoAus104' }).value().permissions, { configuracoes: 'visualizar' }) })
  });
  const tokenComVisualizar = await login('semAcessoAus104', '123456');
  const listaComVisualizarOk = await fetch(`${BASE}/api/ausencias`, { headers: hj(tokenComVisualizar) });
  check('[104ª rodada] com "configuracoes: visualizar", já vê a listagem completa (200)', listaComVisualizarOk.status === 200);
  const criarBloqueado = await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hj(tokenComVisualizar),
    body: JSON.stringify({ userId: colab.id, tipo: 'ferias', dataInicio: '2026-12-01', dataFim: '2026-12-10' })
  });
  check('[104ª rodada] "visualizar" NÃO libera criar ausência (continua 403, só super admin de verdade)', criarBloqueado.status === 403);

  // ---------- 4. Criar ausência de verdade (super admin) ----------
  const criarResp = await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ userId: colab.id, tipo: 'ferias', dataInicio: '2026-12-01', dataFim: '2026-12-10', observacoes: 'Férias de fim de ano' })
  });
  check('[104ª rodada] criar ausência (férias) com super admin funciona (200)', criarResp.status === 200);
  const ferias = await criarResp.json().then((d) => d.ausencia);
  check('[104ª rodada] ausência criada guarda o nome do colaborador resolvido ao vivo', ferias.userName === colab.name);
  check('[104ª rodada] ausência criada guarda as datas certas', ferias.dataInicio === '2026-12-01' && ferias.dataFim === '2026-12-10');

  // Validação: datas erradas / tipo inválido / sem usuário.
  const semUsuario = await fetch(`${BASE}/api/ausencias`, { method: 'POST', headers: hj(adminToken), body: JSON.stringify({ tipo: 'ferias', dataInicio: '2026-12-01', dataFim: '2026-12-10' }) });
  check('[104ª rodada] rejeita criar sem colaborador válido (400)', semUsuario.status === 400);
  const tipoInvalido = await fetch(`${BASE}/api/ausencias`, { method: 'POST', headers: hj(adminToken), body: JSON.stringify({ userId: colab.id, tipo: 'invalido', dataInicio: '2026-12-01', dataFim: '2026-12-10' }) });
  check('[104ª rodada] rejeita tipo inválido (400)', tipoInvalido.status === 400);
  const dataInvertida = await fetch(`${BASE}/api/ausencias`, { method: 'POST', headers: hj(adminToken), body: JSON.stringify({ userId: colab.id, tipo: 'ferias', dataInicio: '2026-12-10', dataFim: '2026-12-01' }) });
  check('[104ª rodada] rejeita data final antes da data de início (400)', dataInvertida.status === 400);

  // ---------- 5. "Saída fora do horário" é sempre de 1 dia só ----------
  const saidaResp = await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ userId: colab.id, tipo: 'saida', dataInicio: '2026-11-05', dataFim: '2026-11-20', observacoes: 'Saiu mais cedo, consulta médica' })
  }).then((r) => r.json()).then((d) => d.ausencia);
  check('[104ª rodada] "saída" ignora dataFim enviada e grava igual à dataInicio (sempre 1 dia só)', saidaResp.dataFim === '2026-11-05');

  // ---------- 6. Listagem enxuta devolve as ausências certas, sem observações ----------
  const publicasData = await fetch(`${BASE}/api/ausencias/publicas`, { headers: hj(adminToken) }).then((r) => r.json());
  const feriasPublica = publicasData.ausencias.find((a) => a.id === ferias.id);
  check('[104ª rodada] a listagem enxuta devolve a ausência de férias certa (userId/tipo/datas)', !!feriasPublica && feriasPublica.userId === colab.id && feriasPublica.tipo === 'ferias' && feriasPublica.dataFim === '2026-12-10');
  check('[104ª rodada] a listagem enxuta NÃO devolve observações (privacidade -- só a tela admin tem)', feriasPublica.observacoes === undefined);

  // ---------- 7. Comunicado automático em Recados (broadcast pra equipe) ----------
  const recadosColab = await fetch(`${BASE}/api/recados`, { headers: hj(await login('colabFerias104', '123456')) }).then((r) => r.json());
  const comunicadoFerias = (recadosColab.recados || []).find((r) => r.kind === 'ausencia_anunciada' && r.text.includes('férias') && r.text.includes(colab.name.split(' ')[0]));
  check('[104ª rodada] cadastrar uma ausência gera um comunicado automático em Recados, visto pela própria pessoa (broadcast)', !!comunicadoFerias);
  const recadosOutraPessoa = await fetch(`${BASE}/api/recados`, { headers: hj(tokenSemAcesso) }).then((r) => r.json());
  const comunicadoParaOutraPessoa = (recadosOutraPessoa.recados || []).find((r) => r.id === (comunicadoFerias && comunicadoFerias.id));
  check('[104ª rodada] o comunicado é um BROADCAST -- outra pessoa qualquer da equipe também recebe (não só quem está de férias)', !!comunicadoParaOutraPessoa);

  // ---------- 8. Editar ausência ----------
  const editResp = await fetch(`${BASE}/api/ausencias/${ferias.id}`, {
    method: 'PUT', headers: hj(adminToken),
    body: JSON.stringify({ dataFim: '2026-12-15', observacoes: 'Férias estendidas' })
  });
  check('[104ª rodada] editar ausência (super admin) funciona (200)', editResp.status === 200);
  const feriasEditada = await editResp.json().then((d) => d.ausencia);
  check('[104ª rodada] edição persistiu a nova data final', feriasEditada.dataFim === '2026-12-15');
  const editBloqueado = await fetch(`${BASE}/api/ausencias/${ferias.id}`, { method: 'PUT', headers: hj(tokenComVisualizar), body: JSON.stringify({ observacoes: 'não devia conseguir' }) });
  check('[104ª rodada] "visualizar" NÃO libera editar ausência (continua 403)', editBloqueado.status === 403);

  // Mudar o tipo pra "saida" na edição também força dataFim = dataInicio.
  const editParaSaida = await fetch(`${BASE}/api/ausencias/${ferias.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ tipo: 'saida' })
  }).then((r) => r.json()).then((d) => d.ausencia);
  check('[104ª rodada] mudar o tipo pra "saida" na edição também trava dataFim = dataInicio', editParaSaida.dataFim === editParaSaida.dataInicio);

  // ---------- 9. Excluir ausência ----------
  const delBloqueado = await fetch(`${BASE}/api/ausencias/${saidaResp.id}`, { method: 'DELETE', headers: hj(tokenComVisualizar) });
  check('[104ª rodada] "visualizar" NÃO libera excluir ausência (continua 403)', delBloqueado.status === 403);
  const delResp = await fetch(`${BASE}/api/ausencias/${saidaResp.id}`, { method: 'DELETE', headers: hj(adminToken) });
  check('[104ª rodada] excluir ausência (super admin) funciona (200)', delResp.status === 200);
  const publicasDepois = await fetch(`${BASE}/api/ausencias/publicas`, { headers: hj(adminToken) }).then((r) => r.json());
  check('[104ª rodada] ausência excluída some da listagem enxuta', !publicasDepois.ausencias.find((a) => a.id === saidaResp.id));

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
