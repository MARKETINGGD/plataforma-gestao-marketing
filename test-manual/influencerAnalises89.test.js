// Teste de integração (servidor de verdade) da 89ª rodada -- "Análise de
// Influencer" (pedido da Raquel: "aidicione um sub menu em influencers, com
// o nome Análise de influencer" + planilha "MAPEAMENTO DE INFLUENCIADORES"
// compartilhada, "coloque isso lá dentro, e deixe conectado com a outra aba
// das influencers, pq quando aprovada uma influencer da aba analise, ja
// deve criar automaticamnete um cadastro e uma planilha p ela no outra aba
// que ja existe").
//
// Cobre:
//   1. CRUD básico da análise (criar com só o nome, listar por marca/status,
//      editar campos, GET /meta).
//   2. Validações (marca inválida, nome obrigatório).
//   3. Aprovar cria um influencer de verdade em Gerenciamento de Influencers
//      (mesma marca, mesmo nome), SEM exigir os dados pessoais que o
//      cadastro manual normal exige (78ª rodada) -- e a "planilha" dele
//      (tabela de ações) já nasce vazia, do jeito que qualquer influencer
//      novo nasce.
//   4. Reprovar (com motivo) e as duas trava: não dá pra aprovar/reprovar de
//      novo uma análise que já foi decidida.
//   5. Excluir uma análise não afeta o influencer já criado por uma
//      aprovação anterior.
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-influencer-analises-89';
process.env.PORT = '4344';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4344';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-influencer-analises-89-test');
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

  const BASE = 'http://localhost:4344';

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

  // ---------- meta ----------
  const meta = await fetch(`${BASE}/api/influencer-analises/meta`, { headers: h(adminToken) }).then((r) => r.json());
  check('GET /meta devolve as marcas (debacco/ghelplus)', JSON.stringify(meta.brands.slice().sort()) === JSON.stringify(['debacco', 'ghelplus']));
  check('GET /meta devolve os status (em_analise/aprovada/reprovada)', JSON.stringify(meta.statuses) === JSON.stringify(['em_analise', 'aprovada', 'reprovada']));
  check('GET /meta devolve a lista de campos da planilha (nome está entre eles)', meta.fields.includes('nome') && meta.fields.includes('instagramHandle'));

  // ---------- validações ----------
  const semMarca = await fetch(`${BASE}/api/influencer-analises`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ nome: 'Sem Marca 89' })
  });
  check('criar sem marca válida é rejeitado (400)', semMarca.status === 400);

  const semNome = await fetch(`${BASE}/api/influencer-analises`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'ghelplus' })
  });
  check('criar sem nome é rejeitado (400)', semNome.status === 400);

  // ---------- criar (só com os campos que a planilha pede) ----------
  const nomeCandidata = 'Candidata Análise 89';
  const criada = await fetch(`${BASE}/api/influencer-analises`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({
      brand: 'ghelplus',
      nome: nomeCandidata,
      genero: 'Feminino',
      estado: 'SP',
      seguidores: '85000',
      mediaLikes: '3200',
      mediaViews: '',
      mediaComentarios: '150',
      alcance: '120000',
      faixaEtaria1317: '10',
      faixaEtaria1824: '55',
      faixaEtaria25Mais: '35',
      generoAudienciaMulheres: '80',
      generoAudienciaHomens: '20',
      principaisTemas: 'Beleza, maquiagem',
      cidades: 'São Paulo, Campinas',
      valorPostFotoStories: '1500.50',
      valorPostVideoStories: '2500',
      instagramHandle: '@candidata89',
      tiktokHandle: '@candidata89tt',
      aniversario: '15/03',
      idade: '27',
      statusCivil: 'Solteira',
      animalEstimacao: 'Gato'
    })
  }).then((r) => r.json()).then((d) => d.analise);
  check('criar análise com os campos da planilha funciona', !!criada.id);
  check('nasce com status "em_analise"', criada.status === 'em_analise');
  check('campos numéricos vêm como número (seguidores)', criada.seguidores === 85000);
  check('campo numérico vazio vira null (mediaViews)', criada.mediaViews === null);
  check('campos de texto vêm como string (instagramHandle)', criada.instagramHandle === '@candidata89');
  check('campo de texto não enviado (reforma) vem vazio, não undefined', criada.reforma === '');

  // ---------- listar / filtrar ----------
  const listaGhelplus = await fetch(`${BASE}/api/influencer-analises?brand=ghelplus`, { headers: h(adminToken) }).then((r) => r.json());
  check('listagem por marca devolve a análise criada', listaGhelplus.analises.some((a) => a.id === criada.id));
  const listaDebacco = await fetch(`${BASE}/api/influencer-analises?brand=debacco`, { headers: h(adminToken) }).then((r) => r.json());
  check('listagem de outra marca NÃO devolve a análise criada', !listaDebacco.analises.some((a) => a.id === criada.id));
  const listaEmAnalise = await fetch(`${BASE}/api/influencer-analises?status=em_analise`, { headers: h(adminToken) }).then((r) => r.json());
  check('filtro por status "em_analise" devolve a análise criada', listaEmAnalise.analises.some((a) => a.id === criada.id));

  const buscaUnica = await fetch(`${BASE}/api/influencer-analises/${criada.id}`, { headers: h(adminToken) }).then((r) => r.json());
  check('GET por id devolve a análise certa', buscaUnica.analise.nome === nomeCandidata);

  // ---------- editar ----------
  const editada = await fetch(`${BASE}/api/influencer-analises/${criada.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ seguidores: '90000', principaisTemas: 'Beleza, maquiagem, skincare' })
  }).then((r) => r.json()).then((d) => d.analise);
  check('editar atualiza o campo mudado', editada.seguidores === 90000 && editada.principaisTemas === 'Beleza, maquiagem, skincare');
  check('editar preserva campos não enviados (instagramHandle continua)', editada.instagramHandle === '@candidata89');

  // ---------- reprovar ----------
  const paraReprovar = await fetch(`${BASE}/api/influencer-analises`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'debacco', nome: 'Candidata Reprovada 89' })
  }).then((r) => r.json()).then((d) => d.analise);
  const reprovada = await fetch(`${BASE}/api/influencer-analises/${paraReprovar.id}/reprovar`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ motivo: 'Engajamento abaixo do esperado' })
  }).then((r) => r.json()).then((d) => d.analise);
  check('reprovar muda o status pra "reprovada"', reprovada.status === 'reprovada');
  check('reprovar guarda o motivo', reprovada.motivoReprovacao === 'Engajamento abaixo do esperado');

  const naoInfluencersAntesCount = await fetch(`${BASE}/api/influencers?brand=debacco`, { headers: h(adminToken) }).then((r) => r.json()).then((d) => d.influencers.length);
  check('reprovar NÃO cria nenhum influencer em Gerenciamento de Influencers', !(await fetch(`${BASE}/api/influencers?brand=debacco`, { headers: h(adminToken) }).then((r) => r.json())).influencers.some((i) => i.name === 'Candidata Reprovada 89'));

  const reprovarDeNovo = await fetch(`${BASE}/api/influencer-analises/${paraReprovar.id}/reprovar`, { method: 'POST', headers: hj(adminToken), body: JSON.stringify({}) });
  check('reprovar uma análise já decidida é rejeitado (400)', reprovarDeNovo.status === 400);
  const aprovarUmaReprovada = await fetch(`${BASE}/api/influencer-analises/${paraReprovar.id}/aprovar`, { method: 'POST', headers: h(adminToken) });
  check('aprovar uma análise já reprovada é rejeitado (400)', aprovarUmaReprovada.status === 400);

  // ---------- aprovar -- cria o cadastro automaticamente (pedido central da Raquel) ----------
  const influencersGhelplusAntes = await fetch(`${BASE}/api/influencers?brand=ghelplus`, { headers: h(adminToken) }).then((r) => r.json()).then((d) => d.influencers);
  check('antes de aprovar, o influencer ainda NÃO existe em Gerenciamento de Influencers', !influencersGhelplusAntes.some((i) => i.name === nomeCandidata));

  const aprovacao = await fetch(`${BASE}/api/influencer-analises/${criada.id}/aprovar`, { method: 'POST', headers: h(adminToken) }).then((r) => r.json());
  check('aprovar devolve a análise com status "aprovada"', aprovacao.analise.status === 'aprovada');
  check('aprovar devolve o influencer recém-criado', !!aprovacao.influencer && aprovacao.influencer.name === nomeCandidata);
  check('análise fica com o influencerId ligado', aprovacao.analise.influencerId === aprovacao.influencer.id);
  check('influencer criado é da MESMA marca da análise', aprovacao.influencer.brand === 'ghelplus');

  const influencersGhelplusDepois = await fetch(`${BASE}/api/influencers?brand=ghelplus`, { headers: h(adminToken) }).then((r) => r.json()).then((d) => d.influencers);
  const novoInfluencer = influencersGhelplusDepois.find((i) => i.name === nomeCandidata);
  check('depois de aprovar, o influencer JÁ aparece em Gerenciamento de Influencers', !!novoInfluencer);

  // Pedido explícito da Raquel: "não exige dados pessoais" no caminho de
  // aprovação (diferente do cadastro manual, 78ª rodada) -- continua dando
  // pra abrir/editar o influencer normalmente depois.
  const tabelaNovoInfluencer = await fetch(`${BASE}/api/influencers/${novoInfluencer.id}`, { headers: h(adminToken) }).then((r) => r.json());
  check('"planilha" (tabela de ações) do influencer recém-criado já existe e nasce VAZIA', Array.isArray(tabelaNovoInfluencer.posts) && tabelaNovoInfluencer.posts.length === 0);

  const editaInfluencerCriado = await fetch(`${BASE}/api/influencers/${novoInfluencer.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ cpf: '111.222.333-44' })
  });
  check('dá pra completar os dados pessoais do influencer criado via aprovação, editando normalmente', editaInfluencerCriado.status === 200);

  const aprovarDeNovo = await fetch(`${BASE}/api/influencer-analises/${criada.id}/aprovar`, { method: 'POST', headers: h(adminToken) });
  check('aprovar uma análise já aprovada é rejeitado (400, não cria duplicata)', aprovarDeNovo.status === 400);

  // ---------- excluir ----------
  const paraExcluir = await fetch(`${BASE}/api/influencer-analises`, {
    method: 'POST', headers: hj(adminToken), body: JSON.stringify({ brand: 'ghelplus', nome: 'Candidata Pra Excluir 89' })
  }).then((r) => r.json()).then((d) => d.analise);
  const delRes = await fetch(`${BASE}/api/influencer-analises/${paraExcluir.id}`, { method: 'DELETE', headers: h(adminToken) });
  check('excluir uma análise funciona', delRes.status === 200);
  const buscaExcluida = await fetch(`${BASE}/api/influencer-analises/${paraExcluir.id}`, { headers: h(adminToken) });
  check('análise excluída não é mais encontrada (404)', buscaExcluida.status === 404);

  // Excluir a análise já aprovada acima não deve mexer no influencer que
  // ela já criou -- são registros independentes a partir da aprovação.
  const delAprovada = await fetch(`${BASE}/api/influencer-analises/${criada.id}`, { method: 'DELETE', headers: h(adminToken) });
  check('excluir uma análise já aprovada funciona', delAprovada.status === 200);
  const influencerContinuaExistindo = await fetch(`${BASE}/api/influencers/${novoInfluencer.id}`, { headers: h(adminToken) });
  check('excluir a análise aprovada NÃO apaga o influencer já criado por ela', influencerContinuaExistindo.status === 200);

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
