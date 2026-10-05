// Teste (Playwright) da 84ª rodada, pedido direto da Raquel:
//
//   "na versão do papoi p PC, o grafico deve aparecer inteiro, sem a
//   barrinha de rolar, só na versão p cel q deve ter a barrinha p se
//   ajustar."
//
// Causa raiz: `.reis-marketing-chart` usava `overflow-x:auto` pra
// QUALQUER tamanho de tela -- então, com time grande (cada colega tem
// uma coluna de largura fixa, 76px, lado a lado, sem quebrar linha),
// o PC também ganhava a barrinha de rolar horizontal sempre que não
// coubesse todo mundo numa única linha, mesmo tendo espaço de sobra
// (só não o bastante numa linha só). Ver comentário em
// public/style.css (.reis-marketing-chart) para a explicação completa.
//
// Fix: no PC (acima de 900px, mesmo corte já usado pro .home-top-row
// virar 1 coluna no celular), o gráfico agora usa `flex-wrap:wrap` e
// NÃO tem `overflow-x` nenhum -- quem não cabe numa linha cai pra
// próxima, dentro do próprio card, e o gráfico sempre aparece inteiro.
// No celular (@media max-width:900px), continua exatamente como a 81ª
// rodada deixou: uma linha só, com rolagem própria por dentro do card
// (overflow-x:auto) -- é ali que faz sentido ter a barrinha, por
// faltar espaço de verdade.
//
// Dois blocos de checagem: PC sem scrollbar (gráfico cheio quebra
// linha) e celular com scrollbar (comportamento da 81ª rodada
// continua intacto, sem regressão).
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

// Mesmo truque do teste da 81ª rodada: enche o gráfico com gente o
// bastante pra passar da largura de UMA linha só -- nunca precisou de
// dado de verdade pra reproduzir o cenário.
async function preencherReisCheio(page, qtdPessoas) {
  await page.evaluate((qtd) => {
    const html = Array.from({ length: qtd }, (_, i) => {
      const count = qtd - i;
      const barH = Math.max(10, Math.round(140 * (count / qtd)));
      return `<div class="reis-bar-col"><div class="reis-bar-photo reis-bar-photo-fallback">${String.fromCharCode(65 + (i % 26))}</div><div class="reis-bar-value">${count}</div><div class="reis-bar" style="height:${barH}px;"></div></div>`;
    }).join('');
    document.getElementById('reisMarketingChart').innerHTML = html;
    document.getElementById('reisMarketingEmpty').hidden = true;
  }, qtdPessoas);
  await page.waitForTimeout(300);
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // ---------- Bloco 1: PC -- gráfico cheio aparece INTEIRO, sem barrinha de rolar ----------
  {
    const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
    await login(page, 'admin', '123456');
    await page.waitForTimeout(500);

    // Time bem grande (16 pessoas) -- de propósito mais gente do que
    // caberia numa única linha mesmo num PC, pra garantir que o teste
    // cobre o cenário que antes forçava a barrinha de rolar.
    await preencherReisCheio(page, 16);

    const info = await page.evaluate(() => {
      const chart = document.getElementById('reisMarketingChart');
      const style = getComputedStyle(chart);
      const cols = chart.querySelectorAll('.reis-bar-col');
      const rows = new Set(Array.from(cols).map((c) => Math.round(c.getBoundingClientRect().top)));
      return {
        flexWrap: style.flexWrap,
        overflowX: style.overflowX,
        scrollWidthEqualsClientWidth: chart.scrollWidth <= chart.clientWidth + 1, // 1px de folga por arredondamento
        qtdLinhas: rows.size,
        qtdColunas: cols.length
      };
    });
    check('no PC, .reis-marketing-chart quebra linha (flex-wrap:wrap), não fica numa linha só', info.flexWrap === 'wrap');
    check('no PC, .reis-marketing-chart não tem rolagem própria (overflow-x não é "auto"/"scroll")', info.overflowX !== 'auto' && info.overflowX !== 'scroll');
    check('no PC, o conteúdo do gráfico cabe todo dentro da área visível (scrollWidth <= clientWidth) -- sem precisar rolar', info.scrollWidthEqualsClientWidth);
    check('com 16 pessoas, o gráfico de fato quebrou em mais de 1 linha no PC (confirma que é o "wrap" que resolve, não um card gigante)', info.qtdLinhas > 1);
    check('nenhum colega "desapareceu" ao quebrar linha -- as 16 colunas continuam todas no DOM', info.qtdColunas === 16);

    // A tela/body também não deve ganhar rolagem HORIZONTAL por causa
    // disso (o gráfico quebrando linha não pode estourar a página).
    const pagina = await page.evaluate(() => ({ bodyW: document.body.scrollWidth, winW: window.innerWidth }));
    check('a página inteira continua sem rolagem horizontal no PC', pagina.bodyW <= pagina.winW + 1);

    await page.close();
  }

  // ---------- Bloco 2: celular -- continua com a barrinha de rolar (comportamento da 81ª rodada, sem regressão) ----------
  {
    const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    await login(page, 'admin', '123456');
    await page.waitForTimeout(500);

    await preencherReisCheio(page, 7);

    const info = await page.evaluate(() => {
      const chart = document.getElementById('reisMarketingChart');
      const style = getComputedStyle(chart);
      return {
        flexWrap: style.flexWrap,
        overflowX: style.overflowX,
        chartW: chart.getBoundingClientRect().width,
        cardW: document.querySelector('.reis-marketing-card').getBoundingClientRect().width
      };
    });
    check('no celular, .reis-marketing-chart continua numa linha só (flex-wrap:nowrap), não quebra linha', info.flexWrap === 'nowrap');
    check('no celular, .reis-marketing-chart continua com rolagem própria (overflow-x:auto) -- herdada da 81ª rodada', info.overflowX === 'auto');
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
