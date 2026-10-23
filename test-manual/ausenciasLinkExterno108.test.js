// Teste de integração (servidor de verdade, mesmo padrão dos demais
// test-manual/*.test.js) da 108ª rodada -- pedido literal da Raquel: "a
// aba das ausencias, deve ter um link externo de compartilhamento, que
// apareça o calendario e a explicação, exatamente como ela esta hoje na
// plataforma." Mesmo mecanismo genérico de link externo já usado em
// Budget/Feiras/Brindes/Campanha Cooperada/Expositores/Concorrência (ver
// utils/shareLinks.js), aplicado aqui em routes/ausencias.js.
//
// Ponto central deste teste (ATUALIZADO ainda na 108ª rodada): a 1ª
// versão escondia "saida" (saída/chegada fora do horário, restrito
// desde a 107ª rodada a coordenador/gerente/admin) do link público, por
// quem abre esse link estar sempre DESLOGADO. A própria Raquel pediu
// pra reverter isso ("preciso que a saida fora do horario apareça no
// link externo") -- o endpoint `GET /api/ausencias/public/:token` agora
// devolve TODOS os tipos (férias/afastamento/viagem/saida), sem nenhum
// filtro por tipo, igual a listagem completa da aba Usuários.
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'teste-ausencias-link-externo-108';
process.env.PORT = '4371';
process.env.META_APP_ID = '1749362466318676';
process.env.META_APP_SECRET = 'fake-secret';
process.env.PAPOI_BASE_URL = 'http://localhost:4371';

const realDbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = path.join(__dirname, '..', 'data', 'db.json.bak-ausencias-link-externo-108-test');
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

  const BASE = 'http://localhost:4371';

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
      body: JSON.stringify({ name: 'Admin Ausencias Link 108', username: 'admin', password: '123456' })
    }).then((r) => r.json());
    adminToken = setupRes.token;
  } else {
    adminToken = await login('admin', '123456');
  }
  check('login/setup do admin devolveu token', !!adminToken);

  // Pessoa comum (sem nenhuma permissão), só pra confirmar que gerar/
  // revogar o link exige super admin de verdade.
  await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'semAcessoLink108', password: '123456', name: 'Sem Acesso Link 108' })
  });
  const tokenSemAcesso = await login('semAcessoLink108', '123456');

  // Colaborador usado nos registros de teste.
  const colab = await fetch(`${BASE}/api/auth/users`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ username: 'colabLink108', password: '123456', name: 'Colaboradora Link 108' })
  }).then((r) => r.json()).then((d) => d.user);

  // ---------- 1. Painel admin (`GET /public-link`): sem link ainda ----------
  const painelAntes = await fetch(`${BASE}/api/ausencias/public-link`, { headers: hj(adminToken) }).then((r) => r.json());
  check('[108ª rodada] antes de gerar, o painel admin devolve publicToken null', painelAntes.publicToken === null);

  // ---------- 2. Gerar/ver/revogar o link exige super admin de verdade ----------
  const gerarBloqueado = await fetch(`${BASE}/api/ausencias/public-link/generate`, { method: 'POST', headers: hj(tokenSemAcesso) });
  check('[108ª rodada] gerar o link externo é bloqueado pra quem não é super admin (403)', gerarBloqueado.status === 403);
  const verBloqueado = await fetch(`${BASE}/api/ausencias/public-link`, { headers: hj(tokenSemAcesso) });
  check('[108ª rodada] ver o painel do link externo é bloqueado pra quem não é super admin (403)', verBloqueado.status === 403);

  // ---------- 3. Gerar o link de verdade (super admin) ----------
  const gerarResp = await fetch(`${BASE}/api/ausencias/public-link/generate`, { method: 'POST', headers: hj(adminToken) });
  check('[108ª rodada] gerar o link externo (super admin) funciona (200)', gerarResp.status === 200);
  const { publicToken } = await gerarResp.json();
  check('[108ª rodada] a geração devolve um token', !!publicToken);

  const painelDepois = await fetch(`${BASE}/api/ausencias/public-link`, { headers: hj(adminToken) }).then((r) => r.json());
  check('[108ª rodada] depois de gerado, o painel admin devolve o mesmo token', painelDepois.publicToken === publicToken);

  // ---------- 4. Cadastrar os 4 tipos de ausência ----------
  const feriasResp = await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ userId: colab.id, tipo: 'ferias', dataInicio: '2026-12-01', dataFim: '2026-12-10' })
  }).then((r) => r.json()).then((d) => d.ausencia);
  const afastamentoResp = await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ userId: colab.id, tipo: 'afastamento', dataInicio: '2026-11-01', dataFim: '2026-11-05' })
  }).then((r) => r.json()).then((d) => d.ausencia);
  const viagemResp = await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ userId: colab.id, tipo: 'viagem', dataInicio: '2026-10-20', dataFim: '2026-10-25' })
  }).then((r) => r.json()).then((d) => d.ausencia);
  // "saida" com horário detalhado -- o tipo restrito desde a 107ª rodada.
  const saidaResp = await fetch(`${BASE}/api/ausencias`, {
    method: 'POST', headers: hj(adminToken),
    body: JSON.stringify({ userId: colab.id, tipo: 'saida', dataInicio: '2026-10-22', horaSaida: '15:00', horaRetorno: '16:30' })
  }).then((r) => r.json()).then((d) => d.ausencia);
  check('[108ª rodada] os 4 registros de teste foram criados', !!(feriasResp.id && afastamentoResp.id && viagemResp.id && saidaResp.id));

  // ---------- 5. O link público (SEM login nenhum) devolve os 4 tipos ----------
  const publicoResp = await fetch(`${BASE}/api/ausencias/public/${publicToken}`);
  check('[108ª rodada] acessar o link público sem nenhum header de auth funciona (200)', publicoResp.status === 200);
  const publicoData = await publicoResp.json();
  const ids = publicoData.ausencias.map((a) => a.id);
  check('[108ª rodada] o link público mostra "férias"', ids.includes(feriasResp.id));
  check('[108ª rodada] o link público mostra "afastamento"', ids.includes(afastamentoResp.id));
  check('[108ª rodada] o link público mostra "viagem a trabalho"', ids.includes(viagemResp.id));

  // ---------- 6. ATUALIZADO: o link público agora TAMBÉM mostra "saida", com horário --------
  // Pedido explícito da Raquel ("preciso que a saida fora do horario
  // apareça no link externo"), revertendo a 1ª versão desta mesma
  // rodada (que escondia por padrão de segurança).
  check('[108ª rodada] o link público AGORA mostra "saída fora do horário" (pedido explícito da Raquel revertendo a decisão original)', ids.includes(saidaResp.id));
  const saidaNoPublico = publicoData.ausencias.find((a) => a.id === saidaResp.id);
  check('[108ª rodada] o registro de "saida" no link público vem com os horários certos (saiu 15:00, retornou 16:30)', !!saidaNoPublico && saidaNoPublico.horaSaida === '15:00' && saidaNoPublico.horaRetorno === '16:30');

  // ---------- 7. Token inválido/inexistente nunca funciona ----------
  const tokenInvalido = await fetch(`${BASE}/api/ausencias/public/token-que-nao-existe-108`);
  check('[108ª rodada] um token inválido/inexistente devolve 404', tokenInvalido.status === 404);

  // ---------- 8. Revogar o link (super admin) invalida o token na hora ----------
  const revogarBloqueado = await fetch(`${BASE}/api/ausencias/public-link`, { method: 'DELETE', headers: hj(tokenSemAcesso) });
  check('[108ª rodada] revogar o link é bloqueado pra quem não é super admin (403)', revogarBloqueado.status === 403);
  const revogarResp = await fetch(`${BASE}/api/ausencias/public-link`, { method: 'DELETE', headers: hj(adminToken) });
  check('[108ª rodada] revogar o link externo (super admin) funciona (200)', revogarResp.status === 200);
  const painelAposRevogar = await fetch(`${BASE}/api/ausencias/public-link`, { headers: hj(adminToken) }).then((r) => r.json());
  check('[108ª rodada] depois de revogado, o painel admin volta a devolver publicToken null', painelAposRevogar.publicToken === null);
  const publicoAposRevogar = await fetch(`${BASE}/api/ausencias/public/${publicToken}`);
  check('[108ª rodada] depois de revogado, o token antigo não funciona mais (404)', publicoAposRevogar.status === 404);

  // ---------- 9. Gerar um link novo depois de revogar funciona de novo (novo token) ----------
  const gerarNovoResp = await fetch(`${BASE}/api/ausencias/public-link/generate`, { method: 'POST', headers: hj(adminToken) }).then((r) => r.json());
  check('[108ª rodada] gerar um link novo depois de revogar funciona e devolve um token diferente do antigo', !!gerarNovoResp.publicToken && gerarNovoResp.publicToken !== publicToken);
  const publicoNovoResp = await fetch(`${BASE}/api/ausencias/public/${gerarNovoResp.publicToken}`);
  check('[108ª rodada] o novo link funciona (200)', publicoNovoResp.status === 200);

  // ---------- 10. O resolvedor genérico (/api/share-links/resolve/:token) identifica o recurso certo ----------
  const resolveResp = await fetch(`${BASE}/api/share-links/resolve/${gerarNovoResp.publicToken}`).then((r) => r.json());
  check('[108ª rodada] o resolvedor genérico identifica resource="ausencias"', resolveResp.resource === 'ausencias');
  check('[108ª rodada] o resolvedor genérico devolve o rótulo em português "Ausências"', resolveResp.resourceLabel === 'Ausências');

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
