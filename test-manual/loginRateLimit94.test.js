// Teste da rodada de segurança (15/10/2026), pedido direto da Raquel: "o
// que falta para deixar 100% segura a plataforma papoi?". Esta rodada
// adicionou um limite de tentativas de login (anti força-bruta) -- antes,
// não existia NENHUM limite: um script poderia testar senhas sem parar
// pro mesmo usuário.
//
// Duas partes: (1) checagem direta da lógica de tempo em
// utils/loginRateLimit.js (sem precisar esperar os 15 minutos de verdade
// -- "engana" o relógio trocando Date.now temporariamente, mesmo truque
// de qualquer teste de timer em JS); (2) teste de integração contra o
// servidor de verdade, confirmando que routes/auth.js está mesmo ligado
// nessa lógica.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-login-rate-limit-94';
process.env.PORT = '4356';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4356';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-login-rate-limit-94-test');
let hadOriginal = false;
if (fs.existsSync(realDbPath)) {
  fs.copyFileSync(realDbPath, backupPath);
  hadOriginal = true;
}

let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

// ---------- Parte 1: lógica de tempo, direto no módulo (sem servidor) ----------
function testarLogicaDeTempo() {
  // Cada require novo do módulo, com cache limpo, começa com o Map vazio --
  // garante que esta parte não interfere com a Parte 2 (que usa o MESMO
  // processo, mas é um módulo requerido de novo dentro do server, então na
  // prática já são instâncias diferentes; limpar o cache aqui só deixa
  // isso explícito e à prova de ordem de execução).
  delete require.cache[require.resolve('../utils/loginRateLimit')];
  const rl = require('../utils/loginRateLimit');

  const realDateNow = Date.now;
  let fakeNow = 1700000000000; // qualquer instante fixo serve de ponto de partida
  Date.now = () => fakeNow;

  try {
    check('usuário novo começa sem bloqueio', rl.msLockedFor('raquel.teste94') === 0);

    for (let i = 0; i < rl.MAX_ATTEMPTS - 1; i++) rl.registerFailedAttempt('raquel.teste94');
    check(`${rl.MAX_ATTEMPTS - 1} tentativas erradas (abaixo do limite) ainda não bloqueiam`, rl.msLockedFor('raquel.teste94') === 0);

    rl.registerFailedAttempt('raquel.teste94'); // atinge o MAX_ATTEMPTS
    const lockedMs = rl.msLockedFor('raquel.teste94');
    check(`na tentativa nº ${rl.MAX_ATTEMPTS}, o usuário fica bloqueado`, lockedMs > 0 && lockedMs <= rl.LOCKOUT_MS);

    // Outro usuário, no mesmo instante, não é afetado -- o bloqueio é só
    // por usuário, nunca global.
    check('usuário DIFERENTE continua livre mesmo com outro bloqueado', rl.msLockedFor('outra.pessoa94') === 0);

    // Login bem-sucedido (ou qualquer chamada) ainda dentro do bloqueio
    // continua recusado -- só o tempo resolve.
    fakeNow += 5 * 60 * 1000; // +5 minutos, ainda dentro dos 15 de bloqueio
    check('ainda dentro da janela de bloqueio, continua bloqueado', rl.msLockedFor('raquel.teste94') > 0);

    // Passado o tempo de bloqueio, libera sozinho -- sem precisar de
    // nenhuma ação manual (nem reiniciar o servidor).
    fakeNow += rl.LOCKOUT_MS; // ultrapassa o fim do bloqueio
    check('depois do tempo de bloqueio passar, libera sozinho', rl.msLockedFor('raquel.teste94') === 0);

    // Login bem-sucedido zera o contador -- a pessoa não fica "acumulando"
    // tentativas erradas antigas de antes de acertar a senha.
    rl.registerFailedAttempt('zero.teste94');
    rl.registerFailedAttempt('zero.teste94');
    rl.registerSuccessfulLogin('zero.teste94');
    for (let i = 0; i < rl.MAX_ATTEMPTS - 1; i++) rl.registerFailedAttempt('zero.teste94');
    check('login certo reseta o contador (não soma com tentativas de antes)', rl.msLockedFor('zero.teste94') === 0);
  } finally {
    Date.now = realDateNow;
  }
}

// ---------- Parte 2: integração, servidor de verdade ----------
async function testarContraServidorDeVerdade() {
  require('../server');
  await new Promise((r) => setTimeout(r, 800));

  const BASE = 'http://localhost:4356';

  const statusRes = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  if (statusRes.needsSetup) {
    await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin Teste 94', username: 'admin', password: 'SenhaCerta123' })
    }).then((r) => r.json());
  }

  async function tentarLogin(username, password) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  // 4 tentativas erradas seguidas pro mesmo usuário -- todas 401 normal.
  let todasErradasForam401 = true;
  for (let i = 0; i < 4; i++) {
    const r = await tentarLogin('admin', 'senha-errada-' + i);
    if (r.status !== 401) todasErradasForam401 = false;
  }
  check('4 tentativas erradas seguidas (abaixo do limite) continuam 401', todasErradasForam401);

  // 5ª tentativa errada -- ainda 401 (é a que estoura o limite).
  const quinta = await tentarLogin('admin', 'senha-errada-5');
  check('5ª tentativa errada ainda devolve 401 (é a que bloqueia)', quinta.status === 401);

  // 6ª tentativa, agora com a SENHA CERTA -- deve ser recusada (429), já
  // que o usuário está bloqueado -- é isso que prova que o bloqueio
  // realmente trava um ataque automatizado (que acertaria a senha
  // dentro da leva de tentativas).
  const comSenhaCerta = await tentarLogin('admin', 'SenhaCerta123');
  check('[94ª rodada] mesmo com a senha CERTA, login recusado durante o bloqueio (429)', comSenhaCerta.status === 429);
  check('mensagem do bloqueio menciona "tentativas"', /tentativas/i.test(comSenhaCerta.data.error || ''));

  // Criar um 2º usuário (via setup não dá, já tem admin -- usa a API de
  // usuários do próprio admin, mas o admin está bloqueado agora... então
  // cria direto no banco pra não depender do admin logar) -- mais simples:
  // confirma que outro USERNAME, nunca tentado, loga normalmente mesmo
  // enquanto "admin" está bloqueado.
  const outroUsuario = await tentarLogin('usuario-que-nunca-tentou-94', 'qualquer-coisa');
  check('usuário diferente (nunca tentado) NÃO é afetado pelo bloqueio do "admin"', outroUsuario.status === 401 && !/tentativas/i.test(outroUsuario.data.error || ''));

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(process.exitCode);
}

testarLogicaDeTempo();
testarContraServidorDeVerdade().catch((e) => {
  console.error(e);
  if (hadOriginal) fs.copyFileSync(backupPath, realDbPath);
  fs.rmSync(backupPath, { force: true });
  process.exit(1);
});
