// Teste de integração (servidor de verdade) da 91ª rodada -- planilha nova
// de "Análise de Influencer" (a Raquel: "voce adicionou essa planilha no
// sub menu influencers, mas agora ela mudou, refaça ela exatamente na
// ordem que esta essa aqui e ja deixe pré cadastrado os dados que ja tem
// nela", seguido de: "inclua tbm a opção de subir arquivos (midia kit) e
// lembre que deve etr aba ade aprovada, se aprovada, ela automaticamnete
// deve gerar um cadastro em gerenciamento influenecrs").
//
// Cobre:
//   1. GET /meta devolve "email" e "tipoConteudo" entre os campos (colunas
//      novas da planilha, entre Gênero e Estado).
//   2. Criar/editar uma análise com os campos novos funciona normal.
//   3. Pré-cadastro (seed) das 9 candidatas reais da planilha nova --
//      todas na marca GhelPlus, com nome/gênero/email/tipoConteudo/
//      estado/seguidores batendo exatamente com a planilha, "920k" etc.
//      convertidos pra número puro -- e sem duplicar (idempotente).
//   4. Mídia kit: subir arquivo (multipart), listar, subir um 2º (os dois
//      ficam, nunca substitui), excluir um, e os erros (sem arquivo,
//      análise inexistente).
//   5. Aprovar continua criando o influencer automaticamente (comportamento
//      já existente, não mexido nesta rodada) -- E agora o e-mail já
//      coletado na análise vem junto pro cadastro novo; sem e-mail na
//      análise, o cadastro nasce com e-mail vazio (nunca undefined/erro).
//
// Roda o server.js de verdade numa porta própria, com backup/restauração
// do data/db.json real -- não mexe no banco de produção (o pré-cadastro
// de verdade, persistente, acontece sozinho na primeira vez que a Raquel
// reiniciar o servidor dela de verdade, fora deste teste).
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-analise-influencer-planilha-nova-91';
process.env.PORT = '4345';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4345';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-analise-influencer-91-test');
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

  const BASE = 'http://localhost:4345';

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

  // ---------- meta -- campos novos ----------
  const meta = await fetch(`${BASE}/api/influencer-analises/meta`, { headers: h(adminToken) }).then((r) => r.json());
  check('GET /meta inclui "email" entre os campos', meta.fields.includes('email'));
  check('GET /meta inclui "tipoConteudo" entre os campos', meta.fields.includes('tipoConteudo'));

  // ---------- criar/editar com os campos novos ----------
  const criada = await fetch(`${BASE}/api/influencer-analises`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ brand: 'ghelplus', nome: 'Candidata Campos Novos 91', genero: 'Feminino', email: 'teste91@exemplo.com', tipoConteudo: 'Decoração', estado: 'MG' })
  }).then((r) => r.json()).then((d) => d.analise);
  check('criar com email/tipoConteudo funciona', criada.email === 'teste91@exemplo.com' && criada.tipoConteudo === 'Decoração');
  check('nasce com arquivosMidiaKit vazio (nunca undefined)', Array.isArray(criada.arquivosMidiaKit) && criada.arquivosMidiaKit.length === 0);

  const editada = await fetch(`${BASE}/api/influencer-analises/${criada.id}`, {
    method: 'PUT', headers: hj(adminToken), body: JSON.stringify({ email: 'novo91@exemplo.com' })
  }).then((r) => r.json()).then((d) => d.analise);
  check('editar o email funciona', editada.email === 'novo91@exemplo.com');
  check('editar preserva tipoConteudo não enviado', editada.tipoConteudo === 'Decoração');

  // ---------- pré-cadastro (seed) das 9 candidatas reais ----------
  const listaGhelplus = await fetch(`${BASE}/api/influencer-analises?brand=ghelplus`, { headers: h(adminToken) }).then((r) => r.json()).then((d) => d.analises);
  const porNome = (nome) => listaGhelplus.filter((a) => a.nome === nome);

  const biGoes = porNome('Bi Goes')[0];
  check('seed: "Bi Goes" existe', !!biGoes);
  check('seed: "Bi Goes" tem o email certo', biGoes && biGoes.email === 'bigoes@rnkd.com.br');
  check('seed: "Bi Goes" nasce sem duplicata', porNome('Bi Goes').length === 1);

  const grazi = porNome('graziribeiroo__')[0];
  check('seed: "graziribeiroo__" existe com os dados certos', grazi && grazi.email === 'grazieleribeiror25@gmail.com' && grazi.tipoConteudo === 'Construção civil' && grazi.seguidores === 920000);

  const pedreira = porNome('pedreira_genyy')[0];
  check('seed: "pedreira_genyy" com 444k convertido pra 444000', pedreira && pedreira.seguidores === 444000);

  const liliana = porNome('lilianandrade1804')[0];
  check('seed: "lilianandrade1804" com o tipoConteudo com vírgula preservado', liliana && liliana.tipoConteudo === 'Criadora de conteúdo DIY, reformas e rotina real' && liliana.seguidores === 221000);

  const drywall = porNome('dt.drywallsteel')[0];
  check('seed: "dt.drywallsteel" com "28,7k" convertido pra 28700', drywall && drywall.seguidores === 28700);
  check('seed: "dt.drywallsteel" com estado SP e sem email (vazio, não undefined)', drywall && drywall.estado === 'SP' && drywall.email === '');

  const dona = porNome('donameudestino')[0];
  check('seed: "donameudestino" com 932k convertido', dona && dona.seguidores === 932000);

  const miriam = porNome('mirianeletricista')[0];
  check('seed: "mirianeletricista" com estado RJ e 175k convertido', miriam && miriam.estado === 'RJ' && miriam.seguidores === 175000);

  const agiliza = porNome('agilizalab')[0];
  check('seed: "agilizalab" sem email (vazio) e 342k convertido', agiliza && agiliza.email === '' && agiliza.seguidores === 342000);

  const julia = porNome('juliagotti')[0];
  check('seed: "juliagotti" com o tipoConteudo com "&" preservado e 230k convertido', julia && julia.tipoConteudo === 'morar sozinho, dicas úteis & vida adulta' && julia.seguidores === 230000);

  check('seed: todas as 9 nasceram em_analise', [biGoes, grazi, pedreira, liliana, drywall, dona, miriam, agiliza, julia].every((a) => a && a.status === 'em_analise'));

  // ---------- mídia kit ----------
  const midiaKitDir = path.join(__dirname, 'tmp-midia-kit-91');
  fs.mkdirSync(midiaKitDir, { recursive: true });
  const file1Path = path.join(midiaKitDir, 'foto-perfil.jpg');
  fs.writeFileSync(file1Path, Buffer.from('conteudo-fake-da-foto'));
  const file2Path = path.join(midiaKitDir, 'apresentacao.pdf');
  fs.writeFileSync(file2Path, Buffer.from('conteudo-fake-do-pdf'));

  async function uploadMidiaKit(analiseId, filePath, fileName) {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(filePath)]), fileName);
    return fetch(`${BASE}/api/influencer-analises/${analiseId}/midia-kit`, {
      method: 'POST', headers: h(adminToken), body: fd
    });
  }

  const upload1Res = await uploadMidiaKit(grazi.id, file1Path, 'foto-perfil.jpg');
  const upload1Body = await upload1Res.json();
  check('subir o 1º arquivo do mídia kit funciona (200)', upload1Res.status === 200);
  check('1º arquivo aparece em arquivosMidiaKit com nome/tamanho certos', upload1Body.analise.arquivosMidiaKit.length === 1 && upload1Body.analise.arquivosMidiaKit[0].name === 'foto-perfil.jpg' && upload1Body.analise.arquivosMidiaKit[0].size > 0);

  const upload2Res = await uploadMidiaKit(grazi.id, file2Path, 'apresentacao.pdf');
  const upload2Body = await upload2Res.json();
  check('subir um 2º arquivo NÃO substitui o 1º -- os dois ficam', upload2Body.analise.arquivosMidiaKit.length === 2);
  const fileIds = upload2Body.analise.arquivosMidiaKit.map((f) => f.name).sort();
  check('os 2 arquivos têm os nomes certos', JSON.stringify(fileIds) === JSON.stringify(['apresentacao.pdf', 'foto-perfil.jpg']));

  const fileOnDisk = path.join(__dirname, '..', 'data', upload1Body.analise.arquivosMidiaKit[0].url.replace(/^\//, ''));
  check('arquivo do mídia kit realmente existe em disco', fs.existsSync(fileOnDisk));

  const semArquivoRes = await fetch(`${BASE}/api/influencer-analises/${grazi.id}/midia-kit`, { method: 'POST', headers: h(adminToken) });
  check('subir sem selecionar arquivo é rejeitado (400)', semArquivoRes.status === 400);

  const analiseInexistenteRes = await uploadMidiaKit('id-que-nao-existe-91', file1Path, 'x.jpg');
  check('subir mídia kit pra análise inexistente é rejeitado (404)', analiseInexistenteRes.status === 404);

  const fileIdParaExcluir = upload2Body.analise.arquivosMidiaKit.find((f) => f.name === 'foto-perfil.jpg').id;
  const delMidiaKitRes = await fetch(`${BASE}/api/influencer-analises/${grazi.id}/midia-kit/${fileIdParaExcluir}`, { method: 'DELETE', headers: h(adminToken) });
  const delMidiaKitBody = await delMidiaKitRes.json();
  check('excluir um arquivo do mídia kit funciona', delMidiaKitRes.status === 200 && delMidiaKitBody.analise.arquivosMidiaKit.length === 1);
  check('o arquivo excluído some do disco também', !fs.existsSync(fileOnDisk));
  check('o outro arquivo do mídia kit continua intacto', delMidiaKitBody.analise.arquivosMidiaKit[0].name === 'apresentacao.pdf');

  fs.rmSync(midiaKitDir, { recursive: true, force: true });

  // ---------- aprovar herda o e-mail já coletado na análise ----------
  const aprovGrazi = await fetch(`${BASE}/api/influencer-analises/${grazi.id}/aprovar`, { method: 'POST', headers: h(adminToken) }).then((r) => r.json());
  check('aprovar continua criando o influencer automaticamente', !!aprovGrazi.influencer && aprovGrazi.influencer.name === 'graziribeiroo__');
  check('o influencer criado JÁ vem com o e-mail coletado na análise', aprovGrazi.influencer.email === 'grazieleribeiror25@gmail.com');

  const aprovDrywall = await fetch(`${BASE}/api/influencer-analises/${drywall.id}/aprovar`, { method: 'POST', headers: h(adminToken) }).then((r) => r.json());
  check('aprovar uma análise sem e-mail cria o influencer com e-mail vazio (nunca undefined/erro)', aprovDrywall.influencer.email === '');

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
