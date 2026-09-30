// Teste de integração (servidor de verdade) da 78ª rodada -- pedidos da
// Raquel sobre Gerenciamento de Influencers:
//
//   1. "Ao cadastrar a influencer, deve ser obrigatório os dados
//      pessoais" -- só no CADASTRO (influencer novo); editar um já
//      existente sem esses dados continua liberado.
//   2. "Deve vir um recado na aba de recados, para quem cadastrou a
//      influencer e a coordenadora, avisando o aniversario, sempre 10
//      dias antes do aniversario."
//   3. "Quando a ação tiver um link de publicado, deve ter esse link ao
//      lado de arquivo" -- campo novo `linkPublicacao`, incluindo nos
//      links externos (relatório por marca/todas as marcas/por influencer).
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-influencer-ajustes-78';
process.env.PORT = '4343';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4343';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-influencer-ajustes-78-test');
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

  const BASE = 'http://localhost:4343';

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
      body: JSON.stringify({ name: 'Admin Teste', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
  } else {
    adminToken = await login('admin', '123456');
  }
  check('login/setup do admin devolveu token', !!adminToken);

  function hj(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }
  function h(token) { return { Authorization: `Bearer ${token}` }; }
  async function createUser(username, name, cargo) {
    const res = await fetch(`${BASE}/api/auth/users`, {
      method: 'POST', headers: hj(adminToken),
      body: JSON.stringify({ username, password: '123456', name, cargo })
    }).then((r) => r.json());
    return res.user;
  }
  const dona = await createUser('donainf78', 'Dona Inf78', 'analista');
  const coord = await createUser('coordinf78', 'Coord Inf78', 'coordenador');
  const donaToken = await login('donainf78', '123456');
  check('usuários de teste criados', !!(dona && coord));

  // ---------- 1. Dados pessoais obrigatórios no cadastro ----------
  const semDados = await fetch(`${BASE}/api/influencers`, {
    method: 'POST', headers: hj(donaToken),
    body: JSON.stringify({ brand: 'ghelplus', name: 'Influencer Sem Dados' })
  });
  check('cadastro sem NENHUM dado pessoal é rejeitado (400)', semDados.status === 400);

  const soCpf = await fetch(`${BASE}/api/influencers`, {
    method: 'POST', headers: hj(donaToken),
    body: JSON.stringify({ brand: 'ghelplus', name: 'Influencer Só CPF', cpf: '123.456.789-00' })
  });
  check('cadastro com só ALGUNS dados pessoais ainda é rejeitado (400)', soCpf.status === 400);

  const completo = await fetch(`${BASE}/api/influencers`, {
    method: 'POST', headers: hj(donaToken),
    body: JSON.stringify({
      brand: 'ghelplus', name: 'Influencer Completo 78',
      cpf: '123.456.789-00', rg: '12.345.678-9', telefone: '(11) 99999-0000',
      email: 'inf78@teste.com', dataNascimento: '1995-05-20', endereco: 'Rua Teste, 123'
    })
  }).then((r) => r.json()).then((d) => d.influencer);
  check('cadastro com TODOS os dados pessoais funciona', !!completo.id);

  const editaSemMudarDados = await fetch(`${BASE}/api/influencers/${completo.id}`, {
    method: 'PUT', headers: hj(donaToken), body: JSON.stringify({ name: 'Influencer Completo 78 Editado' })
  });
  check('editar um influencer já cadastrado continua funcionando normalmente', editaSemMudarDados.status === 200);

  // ---------- 3. Link de publicação ----------
  const acaoSemLink = await fetch(`${BASE}/api/influencers/${completo.id}/posts`, {
    method: 'POST', headers: hj(donaToken),
    body: JSON.stringify({ formato: 'Reels', rede: 'instagram', status: 'a_publicar', involvedUserIds: [dona.id], responsibleId: dona.id })
  }).then((r) => r.json()).then((d) => d.post);
  check('ação criada sem link de publicação (campo opcional) -- vem null', acaoSemLink.linkPublicacao === null);

  const linkUrl = 'https://instagram.com/p/teste78';
  const acaoComLinkUpdate = await fetch(`${BASE}/api/influencers/${completo.id}/posts/${acaoSemLink.id}`, {
    method: 'PUT', headers: hj(donaToken), body: JSON.stringify({ status: 'publicada', linkPublicacao: linkUrl })
  }).then((r) => r.json()).then((d) => d.post);
  check('atualizar a ação com o link de publicação funciona', acaoComLinkUpdate.linkPublicacao === linkUrl);

  const tabelaDoInfluencer = await fetch(`${BASE}/api/influencers/${completo.id}`, { headers: h(donaToken) }).then((r) => r.json());
  check('GET da tabela do influencer devolve o link de publicação', tabelaDoInfluencer.posts.some((p) => p.linkPublicacao === linkUrl));

  const todasAsAcoes = await fetch(`${BASE}/api/influencers/all/posts`, { headers: h(donaToken) }).then((r) => r.json());
  check('"Todas as ações" (todas as marcas) também devolve o link de publicação', todasAsAcoes.posts.some((p) => p.linkPublicacao === linkUrl));

  // Link externo (por influencer) -- deve incluir o link (não é dado sensível).
  const publicLinkRes = await fetch(`${BASE}/api/influencers/${completo.id}/public-link/generate`, { method: 'POST', headers: h(donaToken) }).then((r) => r.json());
  const publicPage = await fetch(`${BASE}/api/influencers/public/${publicLinkRes.publicToken}`).then((r) => r.json());
  check('link externo por influencer também mostra o link de publicação', publicPage.posts.some((p) => p.linkPublicacao === linkUrl));

  // Link externo agregado (todas as marcas) -- mesma coisa.
  const groupLinkRes = await fetch(`${BASE}/api/influencers/group-links/todos/generate`, { method: 'POST', headers: h(adminToken) }).then((r) => r.json());
  const groupPublicPage = await fetch(`${BASE}/api/influencers/public/group/${groupLinkRes.token}`).then((r) => r.json());
  check('link externo agregado (todas as marcas) também mostra o link de publicação', groupPublicPage.posts.some((p) => p.linkPublicacao === linkUrl));

  // ---------- 2. Aviso de aniversário, 10 dias antes ----------
  const { checkAndFireInfluencerBirthdayReminders } = require('../utils/influencerBirthdayReminders');

  function dateStrPlusDays(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return { mm: String(d.getMonth() + 1).padStart(2, '0'), dd: String(d.getDate()).padStart(2, '0') };
  }
  const daqui10Dias = dateStrPlusDays(10);
  const naoFaz10Dias = dateStrPlusDays(30);

  const infAniversarioProximo = await fetch(`${BASE}/api/influencers`, {
    method: 'POST', headers: hj(donaToken),
    body: JSON.stringify({
      brand: 'debacco', name: 'Aniversariante 78',
      cpf: 'x', rg: 'x', telefone: 'x', email: 'x@x.com',
      dataNascimento: `1990-${daqui10Dias.mm}-${daqui10Dias.dd}`, endereco: 'x'
    })
  }).then((r) => r.json()).then((d) => d.influencer);

  const infAniversarioLonge = await fetch(`${BASE}/api/influencers`, {
    method: 'POST', headers: hj(donaToken),
    body: JSON.stringify({
      brand: 'debacco', name: 'Nao Aniversariante 78',
      cpf: 'x', rg: 'x', telefone: 'x', email: 'x@x.com',
      dataNascimento: `1990-${naoFaz10Dias.mm}-${naoFaz10Dias.dd}`, endereco: 'x'
    })
  }).then((r) => r.json()).then((d) => d.influencer);

  function recadosFor(token) {
    return fetch(`${BASE}/api/recados/for-me`, { headers: h(token) }).then((r) => r.json()).then((d) => d.recados);
  }
  const beforeDona = await recadosFor(donaToken);
  const coordToken = await login('coordinf78', '123456');
  const beforeCoord = await recadosFor(coordToken);

  checkAndFireInfluencerBirthdayReminders();
  await new Promise((r) => setTimeout(r, 100));

  const afterDona = await recadosFor(donaToken);
  const afterCoord = await recadosFor(coordToken);
  check('quem cadastrou o influencer (Dona) recebeu o aviso de aniversário', afterDona.length === beforeDona.length + 1);
  check('a coordenadora TAMBÉM recebeu o aviso de aniversário', afterCoord.length === beforeCoord.length + 1);
  const avisoDona = afterDona[afterDona.length - 1];
  check('texto do aviso cita o nome do influencer e "aniversário"', /Aniversariante 78/.test(avisoDona.text) && /[Aa]niversário/.test(avisoDona.text));

  // Rodar de novo no mesmo dia não deve duplicar o aviso.
  checkAndFireInfluencerBirthdayReminders();
  await new Promise((r) => setTimeout(r, 100));
  const afterDonaDeNovo = await recadosFor(donaToken);
  check('rodar a checagem de novo no mesmo dia NÃO duplica o aviso', afterDonaDeNovo.length === afterDona.length);

  const afterDonaTodos = await fetch(`${BASE}/api/recados`, { headers: h(donaToken) }).then((r) => r.json()).then((d) => d.recados);
  check('influencer cujo aniversário NÃO está a 10 dias não gera aviso nenhum', !afterDonaTodos.some((r) => r.text.includes('Nao Aniversariante 78')));

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
