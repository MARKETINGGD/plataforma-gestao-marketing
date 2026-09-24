// Regressão Playwright (61ª rodada, pedido direto da Raquel: "Na tela de
// início, onde aparece os resumos, ao clicar deve mostrar os dados:
// Demandas atrasadas, em andamento, em aprovação, concluídas (mostrar
// quais são as demandas)"). Antes disso, clicar num resumo não fazia
// nada -- só dava pra ver o número. Cria 2 demandas de verdade pela API
// (uma "Em andamento", uma "Atrasada" -- data de entrega no passado) e
// confere que elas aparecem certinho ao clicar no resumo certo, e que
// clicar num item da lista abre o card dela no Quadro Geral.
// Servidor de teste isolado precisa estar rodando em
// http://localhost:4123 (mesmo padrão dos outros testes Playwright).
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  // 64ª rodada: 'serviceWorkers: block' evita que o service worker novo
  // (public/service-worker.js, Rodada F da Pendência 51) atrapalhe o
  // page.route()/tempos deste teste -- achado por acaso ao rodar a suíte
  // inteira depois de registrar o service worker: vários testes, que
  // não têm nada a ver com PWA, começaram a falhar/travar junto (ver
  // test-manual/pwaInstalavel.playwright.js, o Único que PRECISA do
  // service worker ativo de verdade e por isso não bloqueia).
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(BASE);
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForSelector('#reisMarketingChart .reis-bar-col', { timeout: 15000 });

  // Cria as 2 demandas de teste direto pela API (mais confiável e rápido
  // que preencher o formulário do quadro pra este teste), usando o mesmo
  // token que a sessão logada já tem guardado.
  const created = await page.evaluate(async () => {
    const token = localStorage.getItem('token');
    async function criar(title, status, dueDate) {
      const res = await fetch('/api/demandas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ title, status, dueDate })
      });
      const data = await res.json();
      return data.demanda;
    }
    const andamento = await criar('[Teste 61ª rodada] Demanda em andamento', 'andamento', null);
    const atrasada = await criar('[Teste 61ª rodada] Demanda atrasada', 'a_fazer', '2020-01-01');
    return { andamento, atrasada };
  });
  check('demanda "em andamento" de teste foi criada', !!created.andamento && !!created.andamento.id);
  check('demanda "atrasada" de teste foi criada', !!created.atrasada && !!created.atrasada.id && created.atrasada.overdue === true);

  // loadHome() só roda uma vez, no boot (voltar pra Início depois não
  // refaz a busca) -- recarrega a página pra pegar as demandas recém-
  // criadas nos resumos, já que o token de login continua salvo.
  await page.reload();
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
  await page.waitForSelector('#reisMarketingChart .reis-bar-col', { timeout: 15000 });
  await page.waitForFunction(() => {
    const list = document.querySelector('#demandasStatList');
    return list && /Em andamento/i.test(list.textContent);
  }, { timeout: 10000 });

  check('linhas do resumo ficaram clicáveis (classe nova)', await page.evaluate(() => {
    const rows = document.querySelectorAll('#demandasStatList .stat-bar-row');
    return rows.length === 4 && Array.from(rows).every((r) => r.classList.contains('stat-bar-row-clickable'));
  }));

  // Clica no resumo "Em andamento" e confere que a demanda certa aparece
  // na listinha do modal.
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#demandasStatList .stat-bar-row'));
    const row = rows.find((r) => /Em andamento/i.test(r.textContent));
    row.click();
  });
  await page.waitForSelector('#demandaStatModal:not([hidden])', { timeout: 5000 });
  const andamentoModalText = await page.textContent('#demandaStatList');
  check('modal de "Em andamento" abriu com a demanda de teste certa', andamentoModalText.includes('Demanda em andamento'));
  check('modal de "Em andamento" NÃO mostra a demanda atrasada', !andamentoModalText.includes('Demanda atrasada'));

  // Clica no item da lista -- deve fechar o modal, ir pro Quadro Geral e
  // abrir o card certo (mesmo caminho já usado pelos avisos de Recados).
  await page.click('#demandaStatList .stat-bar-row');
  await page.waitForSelector('#demandaStatModal', { state: 'hidden', timeout: 5000 });
  await page.waitForSelector('#view-demandas:not([hidden])', { timeout: 10000 });
  await page.waitForSelector('#demandaModal:not([hidden])', { timeout: 10000 });
  const openedTitle = await page.inputValue('#demCardTitle').catch(() => null);
  check('clicar no item do resumo abre o card certo no Quadro Geral', (openedTitle || '') === '[Teste 61ª rodada] Demanda em andamento');
  await page.click('#demCardClose');

  // Volta pra Início e confere o resumo "Atrasadas" também.
  await page.click('#navHome');
  await page.waitForSelector('#demandasStatList .stat-bar-row', { timeout: 10000 });
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#demandasStatList .stat-bar-row'));
    const row = rows.find((r) => /Atrasadas/i.test(r.textContent));
    row.click();
  });
  await page.waitForSelector('#demandaStatModal:not([hidden])', { timeout: 5000 });
  const atrasadaModalText = await page.textContent('#demandaStatList');
  check('modal de "Atrasadas" abriu com a demanda atrasada de teste', atrasadaModalText.includes('Demanda atrasada'));
  await page.click('#demandaStatModalClose');
  await page.waitForSelector('#demandaStatModal', { state: 'hidden', timeout: 5000 });

  check('nenhum erro de console em toda a navegação', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros de console:', consoleErrors);

  // Limpa as demandas de teste -- sem isso, cada rodada do teste deixaria
  // lixo acumulando no quadro geral de verdade (e inflando os resumos de
  // testes futuros).
  await page.evaluate(async (ids) => {
    const token = localStorage.getItem('token');
    for (const id of ids) {
      await fetch('/api/demandas/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }).catch(() => {});
    }
  }, [created.andamento && created.andamento.id, created.atrasada && created.atrasada.id].filter(Boolean));

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
