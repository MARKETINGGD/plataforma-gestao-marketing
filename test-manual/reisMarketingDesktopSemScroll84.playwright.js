// Teste (Playwright) da 84ª/85ª rodada, em cima do gráfico REIS DO
// MARKETING.
//
// 84ª rodada, pedido da Raquel: "na versão do papoi p PC, o grafico
// deve aparecer inteiro, sem a barrinha de rolar, só na versão p cel q
// deve ter a barrinha p se ajustar." 1ª tentativa: `flex-wrap:wrap`
// (quem não cabia numa linha caía pra próxima).
//
// 85ª rodada, mesma sessão, pedido seguinte -- a Raquel viu o resultado
// (1 pessoa sozinha "perdida" numa 2ª linha, print anexado) e não
// gostou: "o grafico ficou errado de novo, pode diminuir ele um pouco
// para que todos caibam na mesma linha." Ou seja, ela quer ENCOLHER as
// colunas até caber tudo numa única linha, nunca quebrar em várias. A
// solução virou uma variável CSS `--reis-scale` (ver
// `.reis-marketing-chart` no style.css), calculada no JS
// (`ajustarEscalaReisMarketing` em app.js) a partir da largura de
// verdade disponível no card e de quantas pessoas o gráfico tem --
// encolhe coluna/fotinho/barra/gap juntos, só o suficiente pra caber
// tudo numa linha só (nunca aumenta além do tamanho original, só
// diminui, e nunca encolhe abaixo de 55% pra não virar ilegível), e
// recalcula sozinho ao redimensionar a janela.
//
// Este arquivo testa o resultado final (85ª rodada) pelo CAMINHO DE
// VERDADE: cria colegas de verdade (via API, cargo "analista") antes de
// logar, deixa o próprio fluxo de login/init da Papoi carregar
// `teamMembers` e chamar `renderReisDoMarketing` sozinho (que já chama
// `ajustarEscalaReisMarketing` no fim, ver app.js) -- sem precisar
// reimplementar a fórmula de escala no teste nem montar HTML na mão. A
// quantidade de colegas criada é calculada em cima do que JÁ existe no
// banco compartilhado (consultado antes de criar), e tudo que este
// teste cria é apagado de novo no fim (`finally`) -- nunca deixa lixo
// pra trás pro próximo teste que rodar neste mesmo banco.
//
// Servidor de teste isolado precisa estar rodando em
// http://localhost:4123 (mesmo padrão dos outros testes Playwright
// desta cópia -- reaproveita o servidor já de pé, não sobe um novo).
const { chromium } = require('playwright');

const BASE = 'http://localhost:4123';
let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
  if (!cond) failures++;
}

async function login(page, username, password) {
  await page.goto(BASE);
  await page.fill('#loginUsername', username);
  await page.fill('#loginPassword', password);
  await page.click('#loginSubmit');
  await page.waitForSelector('#screen-app:not([hidden])', { timeout: 10000 });
}

async function getAdminToken() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' })
  }).then((r) => r.json());
  return res.token;
}

// Mesmo filtro de renderReisDoMarketing (app.js): gerente/coordenador
// nunca entram no gráfico.
async function contarColegasElegiveis(adminToken) {
  const team = await fetch(`${BASE}/api/auth/team`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
  return (team.users || []).filter((u) => u.cargo !== 'gerente' && u.cargo !== 'coordenador').length;
}

async function criarColegas(adminToken, prefixo, qtd) {
  const criados = [];
  for (let i = 0; i < qtd; i++) {
    const username = `${prefixo}${i}`;
    const res = await fetch(`${BASE}/api/auth/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ username, password: '123456', name: `${prefixo} ${i}`, cargo: 'analista' })
    }).then((r) => r.json());
    if (res.user) criados.push(res.user);
  }
  return criados;
}

async function apagarColegas(adminToken, criados) {
  for (const u of criados) {
    await fetch(`${BASE}/api/auth/users/${u.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } }).catch(() => {});
  }
}

// Fórmula igual à de ajustarEscalaReisMarketing (app.js) -- usada só
// pra decidir QUANTOS colegas criar neste teste (não pra validar o
// resultado; o resultado vem sempre da Papoi de verdade).
function capacidadeDeColunas(availW, scale) {
  const BASE_COL_W = 76, BASE_GAP = 22;
  // n*colW + (n-1)*gap <= availW*0.98  =>  n <= (availW*0.98 + gap) / (colW+gap)
  const colW = BASE_COL_W * scale, gap = BASE_GAP * scale;
  return Math.floor((availW * 0.98 + gap) / (colW + gap));
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const adminToken = await getAdminToken();
  check('login do admin (fetch direto) devolveu token', !!adminToken);

  let criadosBloco1 = [];
  try {
    // ---------- Bloco 1: PC -- time que não cabe no tamanho cheio, mas cabe encolhido (o caso real da Raquel) ----------
    {
      const baseline = await contarColegasElegiveis(adminToken);
      // Mede a largura real do card ANTES de criar ninguém novo (card já
      // existe mesmo com o time atual) -- usa uma aba só pra medir.
      const medidaPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await login(medidaPage, 'admin', '123456');
      await medidaPage.waitForTimeout(600);
      const availW = await medidaPage.evaluate(() => document.getElementById('reisMarketingChart').clientWidth);
      await medidaPage.close();

      const capFull = capacidadeDeColunas(availW, 1); // cabe sem encolher nada
      const capMin = capacidadeDeColunas(availW, 0.55); // cabe mesmo no encolhimento máximo
      // Alvo: 2 pessoas a mais do que cabe no tamanho cheio (precisa
      // encolher de verdade), mas ainda bem dentro do que cabe no
      // encolhimento mínimo (senão o teste pede o impossível).
      const alvoTotal = Math.min(capFull + 2, capMin - 1);
      const qtdNova = Math.max(0, alvoTotal - baseline);
      check(`espaço de teste faz sentido pra esta rodada (cabe ${capFull} sem encolher, ${capMin} encolhido ao máximo, baseline já tem ${baseline})`, capMin > capFull && alvoTotal > baseline);

      criadosBloco1 = await criarColegas(adminToken, 'reis85grande', qtdNova);

      const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
      await login(page, 'admin', '123456');
      // O login dispara o fluxo de init de verdade (GET /api/auth/team
      // preenche teamMembers, loadReisDoMarketing() chama
      // renderReisDoMarketing com os dados reais).
      await page.waitForTimeout(800);

      const info = await page.evaluate(() => {
        const chart = document.getElementById('reisMarketingChart');
        const style = getComputedStyle(chart);
        const cols = chart.querySelectorAll('.reis-bar-col');
        const rows = new Set(Array.from(cols).map((c) => Math.round(c.getBoundingClientRect().top)));
        return {
          flexWrap: style.flexWrap,
          overflowX: style.overflowX,
          scale: parseFloat(style.getPropertyValue('--reis-scale')) || 1,
          scrollWidthEqualsClientWidth: chart.scrollWidth <= chart.clientWidth + 2,
          qtdLinhas: rows.size,
          qtdColunas: cols.length,
          colWidth: cols[0] ? cols[0].getBoundingClientRect().width : 0
        };
      });
      check('no PC, .reis-marketing-chart continua numa linha só (flex-wrap:nowrap) -- não quebra linha mais', info.flexWrap === 'nowrap');
      check('no PC, .reis-marketing-chart não tem rolagem própria (overflow-x não é "auto"/"scroll")', info.overflowX !== 'auto' && info.overflowX !== 'scroll');
      check('com um time que não cabia no tamanho cheio, a Papoi de verdade calculou um --reis-scale < 1 sozinha (encolheu)', info.scale < 1);
      check('depois do encolhimento de verdade, o conteúdo cabe todo dentro da área visível (scrollWidth <= clientWidth) -- sem precisar rolar', info.scrollWidthEqualsClientWidth);
      check('o gráfico encolhido continua numa ÚNICA linha (era o problema da 1ª tentativa desta mesma rodada, que quebrava em 2 linhas)', info.qtdLinhas === 1);
      check('nenhum colega "desapareceu" ao encolher -- todas as colunas continuam no DOM', info.qtdColunas >= alvoTotal);
      check('a coluna de cada pessoa realmente ficou mais estreita que o tamanho original (76px) -- confirma que encolheu de verdade', info.colWidth < 76 && info.colWidth > 76 * 0.55 - 1);

      const pagina = await page.evaluate(() => ({ bodyW: document.body.scrollWidth, winW: window.innerWidth }));
      check('a página inteira continua sem rolagem horizontal no PC', pagina.bodyW <= pagina.winW + 1);

      // Redimensiona a janela pra uma largura menor (ainda "PC", acima do
      // corte de 900px) -- o gráfico precisa recalcular sozinho
      // (listener de resize em app.js) e continuar numa linha só, sem
      // rolar.
      await page.setViewportSize({ width: 1000, height: 900 });
      await page.waitForTimeout(400); // dá tempo pro debounce do listener de resize

      const infoResize = await page.evaluate(() => {
        const chart = document.getElementById('reisMarketingChart');
        const style = getComputedStyle(chart);
        return {
          scale: parseFloat(style.getPropertyValue('--reis-scale')) || 1,
          overflowX: style.overflowX,
          fits: chart.scrollWidth <= chart.clientWidth + 2
        };
      });
      check('ao redimensionar a janela pra uma largura PC menor, o --reis-scale recalcula sozinho (fica <= o de antes, já que sobrou menos espaço)', infoResize.scale <= info.scale + 0.001);
      // Numa janela bem mais estreita (ainda "PC"), o espaço pode ter
      // ficado tão pequeno que nem o encolhimento máximo (55%) resolve
      // mais -- nesse caso a saída final descrita no comentário de
      // ajustarEscalaReisMarketing (JS) é ligar rolagem própria sozinha,
      // em vez de deixar o gráfico vazar pra fora do card. Então o
      // comportamento correto aqui é UM dos dois: ou continua cabendo
      // sem rolar, ou -- se não coube nem encolhido ao máximo -- a
      // rolagem própria liga sozinha (nunca fica "vazando" sem nenhuma
      // das duas saídas).
      check('depois de redimensionar pra uma janela mais estreita, o gráfico OU continua cabendo numa linha sem rolar OU liga a rolagem própria sozinha como saída final (nunca vaza pra fora do card sem nenhuma das duas)', infoResize.fits || infoResize.overflowX === 'auto');

      const paginaResize = await page.evaluate(() => ({ bodyW: document.body.scrollWidth, winW: window.innerWidth }));
      check('mesmo se a saída final (rolagem) precisou ligar, a PÁGINA inteira continua sem estourar de lado (a rolagem fica só por dentro do card)', paginaResize.bodyW <= paginaResize.winW + 1);

      await page.close();
    }
  } finally {
    // Sempre limpa os colegas criados neste bloco, mesmo se alguma
    // checagem acima falhou -- nunca deixa o banco compartilhado mais
    // "sujo" pro próximo teste que rodar aqui.
    await apagarColegas(adminToken, criadosBloco1);
  }

  // ---------- Bloco 2: PC -- time pequeno (cabe fácil, igual o baseline depois da limpeza do bloco 1) NÃO encolhe à toa ----------
  {
    const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
    await login(page, 'admin', '123456');
    await page.waitForTimeout(800);

    const info = await page.evaluate(() => {
      const chart = document.getElementById('reisMarketingChart');
      const style = getComputedStyle(chart);
      const cols = chart.querySelectorAll('.reis-bar-col');
      return {
        scale: parseFloat(style.getPropertyValue('--reis-scale')) || 1,
        scrollWidthEqualsClientWidth: chart.scrollWidth <= chart.clientWidth + 2,
        qtdColunas: cols.length
      };
    });
    check('--reis-scale nunca passa de 1 (o gráfico nunca fica MAIOR que o tamanho original)', info.scale <= 1);
    check('com o time de baseline (sem os colegas extras do bloco 1, já apagados), o gráfico cabe numa linha só sem precisar rolar', info.scrollWidthEqualsClientWidth);
    check('o bloco 1 realmente limpou os colegas que criou (não sobrou nada extra rodando os dois blocos em sequência)', info.qtdColunas < 20);

    await page.close();
  }

  // ---------- Bloco 3: celular -- continua com a barrinha de rolar, SEM encolher (comportamento da 81ª rodada, sem regressão) ----------
  {
    const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    await login(page, 'admin', '123456');
    await page.waitForTimeout(800);

    // Confirma também que um --reis-scale pequeno, se por algum motivo
    // chegasse a ser calculado (ex.: o JS rodou antes da media query se
    // aplicar), é IGNORADO pelo !important do CSS do celular.
    await page.evaluate(() => {
      document.getElementById('reisMarketingChart').style.setProperty('--reis-scale', '0.5');
    });
    await page.waitForTimeout(200);

    const info = await page.evaluate(() => {
      const chart = document.getElementById('reisMarketingChart');
      const style = getComputedStyle(chart);
      const col = chart.querySelector('.reis-bar-col');
      return {
        flexWrap: style.flexWrap,
        overflowX: style.overflowX,
        colWidth: col ? col.getBoundingClientRect().width : 0,
        cardW: document.querySelector('.reis-marketing-card').getBoundingClientRect().width
      };
    });
    check('no celular, .reis-marketing-chart continua numa linha só (flex-wrap:nowrap)', info.flexWrap === 'nowrap');
    check('no celular, .reis-marketing-chart continua com rolagem própria (overflow-x:auto) -- herdada da 81ª rodada', info.overflowX === 'auto');
    check('no celular, o --reis-scale forçado na mão (0.5) é IGNORADO -- a coluna continua no tamanho cheio de 76px (o !important do CSS venceu)', Math.round(info.colWidth) >= 75);
    check('no celular, o cartão continua do tamanho da tela (a rolagem é só por dentro dele)', info.cardW <= 390);

    const pagina = await page.evaluate(() => ({ bodyW: document.body.scrollWidth, winW: window.innerWidth }));
    check('no celular, a página continua sem estourar de lado (bug original da 81ª rodada permanece corrigido)', pagina.bodyW === 390 && pagina.winW === 390);

    await page.close();
  }

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
