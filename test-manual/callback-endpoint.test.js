// Teste direto (mesmo processo) do fluxo clássico de OAuth da Meta
// restaurado na 3ª correção (23/09/2026): response_type=code +
// GET /api/social-accounts/meta/callback fazendo a troca de code por
// token no servidor -- e, desde a 6ª correção, PARANDO no meio do
// caminho pra pedir confirmação de qual Página é a certa em vez de
// escolher sozinho, via GET/POST /api/social-accounts/meta/pending/:id.
// Monkeypatcha utils/metaGraphClient ANTES de subir o servidor de
// verdade, pra testar sem precisar de rede/credenciais reais.
// Roda o server.js de verdade (mesmo processo), numa porta própria, com
// backup/restauração do data/db.json real (mesmo padrão dos testes
// anteriores desta rodada).
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-callback-endpoint';
process.env.PORT = '4324';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4324';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-callback-test');
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

  const metaGraph = require('../utils/metaGraphClient');
  let exchangeCalledWith = null;
  let getManagedPagesCalledWith = null;
  let shouldFindPage = true;
  metaGraph.exchangeCodeForToken = async (args) => {
    exchangeCalledWith = args;
    return { access_token: 'short-fake-token' };
  };
  metaGraph.getLongLivedUserToken = async (args) => {
    if (args.shortLivedToken !== 'short-fake-token') throw new Error('short-lived token errado repassado');
    return { access_token: 'long-fake-token', expires_in: 5184000 };
  };
  metaGraph.getManagedPages = async (args) => {
    getManagedPagesCalledWith = args;
    if (!shouldFindPage) return [{ id: 'page-sem-ig', name: 'Página sem IG' }];
    // 2 Páginas com Instagram vinculado de propósito -- reproduz o caso
    // real da Raquel (administra as 2 Páginas com a MESMA conta do
    // Facebook), que é exatamente o cenário que a 6ª correção existe
    // pra resolver (antes, `.find()` sempre pegava a primeira da lista,
    // pra QUALQUER marca).
    return [
      { id: 'page-sem-ig', name: 'Página sem IG' },
      { id: 'page-999', name: 'GhelPlus Oficial', access_token: 'page-token-fake-ghelplus', instagram_business_account: { id: 'ig-999', username: 'ghelplus_oficial' } },
      { id: 'page-111', name: 'De Bacco Oficial', access_token: 'page-token-fake-debacco', instagram_business_account: { id: 'ig-111', username: 'debacco_oficial' } }
    ];
  };

  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const BASE = 'http://localhost:4324';

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  let token, userId;
  if (statusRes.needsSetup) {
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin Teste Callback', username: 'admin-callback', password: '123456' })
    }).then((r) => r.json());
    token = setupRes.token;
    userId = setupRes.user.id;
  } else {
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456' })
    }).then((r) => r.json());
    token = loginRes.token;
    userId = loginRes.user && loginRes.user.id;
  }
  check('login/setup do admin devolveu token', !!token && !!userId);

  // ---------- GET /meta/connect: confere URL/parâmetros corrigidos ----------
  const connectRes = await fetch(`${BASE}/api/social-accounts/meta/connect?brand=ghelplus`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const connectUrl = new URL(connectRes.redirectUrl);
  const qp = connectUrl.searchParams;
  check('response_type=code (fluxo clássico, revertido do implícito)', qp.get('response_type') === 'code');
  check('sem display/extras (eram só do fluxo implícito, removidos)', !qp.has('display') && !qp.has('extras'));
  check('scope usa instagram_content_publish (nome confirmado no Explorador da Graph API do próprio App)', qp.get('scope').split(',').includes('instagram_content_publish'));
  check('scope NÃO usa os nomes errados testados antes (com "-ing" ou com "business_")', !qp.get('scope').split(',').includes('instagram_content_publishing') && !qp.get('scope').split(',').includes('instagram_business_content_publish'));
  check('scope inclui as outras 4 permissões exigidas pelo painel', ['instagram_basic', 'pages_read_engagement', 'business_management', 'pages_show_list'].every((s) => qp.get('scope').split(',').includes(s)));
  check('URL de autorização usa a versão nova da Graph API (não mais v21.0)', connectUrl.pathname.startsWith('/v21.0/') === false && /^\/v\d+\.\d+\/dialog\/oauth$/.test(connectUrl.pathname));
  const state = qp.get('state');
  check('connect devolve um state assinado', !!state);

  // ---------- GET /meta/callback: para no meio do caminho (6ª correção) ----------
  const okRes = await fetch(`${BASE}/api/social-accounts/meta/callback?code=fake-code-123&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
  check('callback com code+state válidos redireciona (30x)', okRes.status >= 300 && okRes.status < 400);
  const okLocation = okRes.headers.get('location') || '';
  check('redireciona pra ?integracoes=escolher (não mais direto pra "ok")', okLocation.includes('integracoes=escolher') && okLocation.includes('brand=ghelplus') && !okLocation.includes('#'));
  check('exchangeCodeForToken foi chamado com o code certo', exchangeCalledWith && exchangeCalledWith.code === 'fake-code-123');
  check('getManagedPages foi chamado com o token de longa duração', getManagedPagesCalledWith && getManagedPagesCalledWith.userAccessToken === 'long-fake-token');

  const ghelplusSelectionId = new URL(okLocation, BASE).searchParams.get('selectionId');
  check('callback devolve um selectionId', !!ghelplusSelectionId);

  // ainda NÃO deve ter salvo nada em socialAccounts -- só depois da confirmação
  const listBeforeConfirm = await fetch(`${BASE}/api/social-accounts`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  check('antes de confirmar, GhelPlus ainda aparece como NÃO conectada', !listBeforeConfirm.accounts.find((a) => a.brand === 'ghelplus').connected);

  // ---------- GET /meta/pending/:id: lista as candidatas sem token nenhum ----------
  const pendingRes = await fetch(`${BASE}/api/social-accounts/meta/pending/${ghelplusSelectionId}`, { headers: { Authorization: `Bearer ${token}` } });
  const pendingBody = await pendingRes.json();
  check('GET pending devolve as 2 Páginas com Instagram (a de sem-IG fica de fora)', pendingRes.status === 200 && pendingBody.candidates.length === 2);
  check('candidatas não trazem token de acesso nenhum', JSON.stringify(pendingBody).indexOf('page-token-fake') === -1);
  check('sem autenticação nenhuma, GET pending é rejeitado (401)', (await fetch(`${BASE}/api/social-accounts/meta/pending/${ghelplusSelectionId}`)).status === 401);

  // ---------- POST confirm: escolhe a Página da GhelPlus ----------
  const confirmGhelplusRes = await fetch(`${BASE}/api/social-accounts/meta/pending/${ghelplusSelectionId}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ pageId: 'page-999' })
  });
  const confirmGhelplusBody = await confirmGhelplusRes.json();
  check('confirmar com a Página certa devolve 200 ok:true', confirmGhelplusRes.status === 200 && confirmGhelplusBody.ok === true && confirmGhelplusBody.igUsername === 'ghelplus_oficial');

  const listRes = await fetch(`${BASE}/api/social-accounts`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const ghelplusEntry = listRes.accounts.find((a) => a.brand === 'ghelplus');
  check('conta GhelPlus aparece como conectada depois de confirmar', ghelplusEntry && ghelplusEntry.connected === true);
  check('username do Instagram gravado certo', ghelplusEntry.account.igUsername === 'ghelplus_oficial');
  check('token de acesso NUNCA aparece na resposta pro front-end', JSON.stringify(listRes).indexOf('page-token-fake') === -1 && JSON.stringify(listRes).indexOf('long-fake-token') === -1);

  // ---------- selectionId usado uma vez não serve de novo (evita reconfirmar/reusar) ----------
  const reuseRes = await fetch(`${BASE}/api/social-accounts/meta/pending/${ghelplusSelectionId}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ pageId: 'page-999' })
  });
  check('confirmar de novo o mesmo selectionId falha (já foi usado)', reuseRes.status === 404);

  // ---------- ESSE é o bug de verdade que a Raquel achou ao vivo: conectar
  // De Bacco tinha reusado a MESMA Página já conectada como GhelPlus.
  // Repete o fluxo inteiro pra De Bacco, com um novo selectionId (mesmas 2
  // Páginas candidatas, igual aconteceria de verdade -- a mesma conta do
  // Facebook administra as duas), e confirma explicitamente a Página
  // DIFERENTE (page-111, De Bacco) -- prova que agora fica a critério de
  // quem clica, não de qual vem primeiro na lista.
  const debaccoConnectRes = await fetch(`${BASE}/api/social-accounts/meta/connect?brand=debacco`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const debaccoState = new URL(debaccoConnectRes.redirectUrl).searchParams.get('state');
  const debaccoCallbackRes = await fetch(`${BASE}/api/social-accounts/meta/callback?code=fake-code-456&state=${encodeURIComponent(debaccoState)}`, { redirect: 'manual' });
  const debaccoLocation = debaccoCallbackRes.headers.get('location') || '';
  check('callback da De Bacco também para em "escolher" (mesmas 2 Páginas candidatas)', debaccoLocation.includes('integracoes=escolher') && debaccoLocation.includes('brand=debacco'));
  const debaccoSelectionId = new URL(debaccoLocation, BASE).searchParams.get('selectionId');
  check('selectionId da De Bacco é DIFERENTE do da GhelPlus (não reaproveita a escolha anterior)', debaccoSelectionId && debaccoSelectionId !== ghelplusSelectionId);

  const debaccoPendingBody = await fetch(`${BASE}/api/social-accounts/meta/pending/${debaccoSelectionId}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  check('pending da De Bacco também lista as 2 Páginas (a pessoa escolhe, a Papoi não adivinha)', debaccoPendingBody.candidates.length === 2);

  const confirmDebaccoRes = await fetch(`${BASE}/api/social-accounts/meta/pending/${debaccoSelectionId}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ pageId: 'page-111' })
  });
  const confirmDebaccoBody = await confirmDebaccoRes.json();
  check('confirmar a Página da De Bacco (diferente da GhelPlus) funciona', confirmDebaccoRes.status === 200 && confirmDebaccoBody.igUsername === 'debacco_oficial');

  const listAfterBothRes = await fetch(`${BASE}/api/social-accounts`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const ghelplusAfter = listAfterBothRes.accounts.find((a) => a.brand === 'ghelplus');
  const debaccoAfter = listAfterBothRes.accounts.find((a) => a.brand === 'debacco');
  check('CORREÇÃO DO BUG: GhelPlus e De Bacco ficam com Páginas DIFERENTES (não a mesma pra ambas)',
    ghelplusAfter.account.igUsername === 'ghelplus_oficial' && debaccoAfter.account.igUsername === 'debacco_oficial' && ghelplusAfter.account.igUsername !== debaccoAfter.account.igUsername);

  // ---------- pageId que não está entre as candidatas -- rejeitado ----------
  const outroConnectRes = await fetch(`${BASE}/api/social-accounts/meta/connect?brand=ghelplus`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const outroState = new URL(outroConnectRes.redirectUrl).searchParams.get('state');
  const outroCallbackRes = await fetch(`${BASE}/api/social-accounts/meta/callback?code=fake-code-789&state=${encodeURIComponent(outroState)}`, { redirect: 'manual' });
  const outroSelectionId = new URL(outroCallbackRes.headers.get('location'), BASE).searchParams.get('selectionId');
  const badPageIdRes = await fetch(`${BASE}/api/social-accounts/meta/pending/${outroSelectionId}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ pageId: 'page-que-nao-existe' })
  });
  check('confirmar um pageId que não é candidato é rejeitado (400)', badPageIdRes.status === 400);

  // ---------- selectionId inventado/inexistente -- 404 amigável ----------
  const fakeSelectionRes = await fetch(`${BASE}/api/social-accounts/meta/pending/selecao-que-nao-existe`, { headers: { Authorization: `Bearer ${token}` } });
  check('GET pending com selectionId inventado devolve 404', fakeSelectionRes.status === 404);

  // ---------- caminhos de erro ----------
  const errParamState = jwt_sign_helper();
  function jwt_sign_helper() {
    const jwt = require('jsonwebtoken');
    return jwt.sign({ brand: 'debacco', userId }, process.env.JWT_SECRET, { expiresIn: '10m' });
  }

  const facebookErrRes = await fetch(`${BASE}/api/social-accounts/meta/callback?error=access_denied&error_description=Usu%C3%A1rio+cancelou`, { redirect: 'manual' });
  const facebookErrLocation = facebookErrRes.headers.get('location') || '';
  check('Facebook devolvendo ?error= é repassado como integracoes=erro', facebookErrLocation.includes('integracoes=erro') && facebookErrLocation.includes('Usu'));

  const missingRes = await fetch(`${BASE}/api/social-accounts/meta/callback`, { redirect: 'manual' });
  const missingLocation = missingRes.headers.get('location') || '';
  check('sem code/state nenhum -> integracoes=erro', missingLocation.includes('integracoes=erro'));

  const badStateRes = await fetch(`${BASE}/api/social-accounts/meta/callback?code=x&state=lixo-invalido`, { redirect: 'manual' });
  const badStateLocation = badStateRes.headers.get('location') || '';
  check('state inválido/adulterado -> integracoes=erro', badStateLocation.includes('integracoes=erro'));

  // Página sem Instagram vinculado -- erro amigável
  shouldFindPage = false;
  const noIgState = jwt_sign_helper();
  const noIgRes = await fetch(`${BASE}/api/social-accounts/meta/callback?code=y&state=${encodeURIComponent(noIgState)}`, { redirect: 'manual' });
  const noIgLocation = noIgRes.headers.get('location') || '';
  check('nenhuma Página com Instagram vinculado -> integracoes=erro com motivo amigável', noIgLocation.includes('integracoes=erro') && /Instagram/.test(decodeURIComponent(noIgLocation)));

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
