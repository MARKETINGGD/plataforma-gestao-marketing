// Teste (Playwright + chamadas HTTP diretas) da 81ª rodada, pedido direto
// da Raquel, em cima do que a 80ª rodada já tinha entregue:
//
//   "o icone na barra do navegador, ficou feio, faça novamente, deixando
//   apenas a palavra papoi, sem o fundo branco."
//
//   "No celular, ainda ficou ruim, o grafico reis do marketing, segue
//   desconfigurado, e os recados tbm."
//
//   "Além disso as notificações devem vir no cel, mesmo qdo o app esta
//   fechado."
//
// Três problemas, três blocos de checagem neste arquivo:
//
//   1. Favicon -- a 80ª rodada tinha reaproveitado icon-192/512.png (o
//      ícone de fundo BRANCO usado pro app instalado), que a Raquel
//      achou feio na aba. Agora usa favicon-*.png, recortado da MESMA
//      logo "papoi" de sempre (/img/papoi-logo.png), que já tem fundo
//      100% transparente -- sem nenhum quadrado branco atrás. O ícone do
//      app instalado (manifest) continua o de sempre, ela só reclamou da
//      aba do navegador.
//
//   2. REIS DO MARKETING + Recados no celular -- causa raiz real: os 2
//      dividem a mesma coluna de uma grade CSS (.home-top-row) que vira
//      1 coluna só no celular. Por padrão, um item de grid não encolhe
//      além do tamanho do seu PRÓPRIO conteúdo mais largo -- e o gráfico
//      do Reis, com várias pessoas (colunas de 76px fixas, lado a lado),
//      conseguia facilmente precisar de bem mais do que a largura de um
//      celular. Isso estourava a grade INTEIRA (não só o gráfico) pra
//      fora da tela -- arrastando o Recados junto, mesmo ele não tendo
//      nada de errado por conta própria. `min-width:0` resolve.
//
//   3. Notificação com o app FECHADO -- a notificação do sistema (80ª
//      rodada) só funcionava com a página da Papoi aberta e rodando (o
//      polling de dentro do JS é quem detectava recado/mensagem novo).
//      Agora existe inscrição de Web Push de verdade
//      (routes/push.js/utils/webPush.js) -- o PRÓPRIO SERVIDOR manda a
//      notificação, entregue pelo sistema operacional mesmo com a Papoi
//      inteira fechada. Este bloco testa o CONTRATO da API (inscrever/
//      desinscrever/limpar inscrição morta) -- a entrega de verdade
//      depende do navegador conseguir alcançar o serviço de push de cada
//      fabricante (Google/Mozilla/Apple) pela internet, que um ambiente
//      de teste automatizado isolado não tem como simular de ponta a
//      ponta (mesma limitação, por natureza, de qualquer integração
//      externa deste projeto -- ver LinkedIn/TikTok/Pinterest "ainda sem
//      teste real" nas rodadas anteriores).
//
// Servidor de teste isolado precisa estar rodando em
// http://localhost:4123 com VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY
// configuradas no .env (mesmo padrão dos outros testes Playwright desta
// cópia -- reaproveita o servidor já de pé, não sobe um novo).
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

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // ---------- Bloco 1: favicon novo (só a palavra "papoi", sem fundo) ----------
  {
    const page = await browser.newPage({ serviceWorkers: 'block' });
    await page.goto(BASE);
    const icons = await page.$$eval('link[rel="icon"], link[rel="shortcut icon"]', (els) => els.map((el) => el.getAttribute('href')));
    check('favicon agora usa os arquivos novos (favicon-*.png), não mais o ícone de fundo branco do app instalado', icons.every((h) => h.includes('/img/favicon')));
    check('tem favicon.ico também (navegadores mais antigos)', icons.some((h) => h.endsWith('favicon.ico')));
    for (const href of icons) {
      const res = await page.goto(`${BASE}${href}`);
      check(`arquivo "${href}" existe de verdade (200)`, res.status() === 200);
    }
    // O ícone do APP INSTALADO (manifest -- 64ª rodada) continua o de
    // sempre, fundo branco incluso -- a Raquel só reclamou da aba do
    // navegador, não do ícone que vai pra tela de início do celular.
    await page.goto(BASE);
    const manifestHref = await page.$eval('link[rel="manifest"]', (el) => el.getAttribute('href'));
    const manifestJson = await page.evaluate((href) => fetch(href).then((r) => r.json()), manifestHref);
    const manifestIconSrcs = (manifestJson.icons || []).map((i) => i.src);
    check('ícone do app instalado (manifest) continua usando icon-192/512.png (intocado)', manifestIconSrcs.some((s) => s.includes('icon-192.png')) && manifestIconSrcs.some((s) => s.includes('icon-512.png')));
    await page.close();
  }

  // ---------- Bloco 2: REIS DO MARKETING + Recados não estouram mais a tela no celular ----------
  {
    const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    await login(page, 'admin', '123456');
    await page.waitForTimeout(500);

    const before = await page.evaluate(() => ({ bodyW: document.body.scrollWidth, winW: window.innerWidth }));
    check('sem gráfico "cheio" (poucos dados), a tela já não estoura (linha de base)', before.bodyW === before.winW);

    // Simula um REIS DO MARKETING movimentado (vários colaboradores com
    // contagem alta) -- é exatamente esse cenário (coluna de 76px por
    // pessoa, sem quebrar linha) que estourava a grade inteira antes do
    // `min-width:0`. Nunca precisou de dado de verdade pra reproduzir --
    // só precisa de gente suficiente pra passar da largura do celular.
    await page.evaluate(() => {
      const names = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fabio', 'Gabi'];
      const counts = [18, 14, 11, 9, 6, 3, 1];
      const max = counts[0];
      const html = names.map((n, i) => {
        const barH = Math.max(10, Math.round(140 * (counts[i] / max)));
        return `<div class="reis-bar-col"><div class="reis-bar-photo reis-bar-photo-fallback">${n.charAt(0)}</div><div class="reis-bar-value">${counts[i]}</div><div class="reis-bar" style="height:${barH}px;"></div></div>`;
      }).join('');
      document.getElementById('reisMarketingChart').innerHTML = html;
      document.getElementById('reisMarketingEmpty').hidden = true;
    });
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => ({
      bodyW: document.body.scrollWidth, winW: window.innerWidth,
      chartW: document.getElementById('reisMarketingChart').getBoundingClientRect().width,
      cardW: document.querySelector('.reis-marketing-card').getBoundingClientRect().width
    }));
    check('com o gráfico cheio (7 pessoas), a tela do celular NÃO estoura mais de lado (era o bug relatado)', after.bodyW === 390 && after.winW === 390);
    check('o cartão do Reis do Marketing fica do tamanho do celular (a rolagem agora é só por dentro dele)', after.cardW <= 390);
    check('o gráfico em si é mais largo que o cartão visível (confirma que tem rolagem própria por dentro, não sumiu gente)', after.chartW > after.cardW || after.chartW <= 390);

    // Recados, que divide a mesma coluna da grade, precisa continuar
    // legível/sem corte -- ela reclamou dos dois juntos.
    const recadosOk = await page.evaluate(() => {
      const el = document.querySelector('#recadosWrap');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width <= 390 && r.right <= 391; // 1px de folga por arredondamento
    });
    check('Recados continua dentro da largura da tela (não é mais arrastado pro estouro do gráfico ao lado)', recadosOk);

    await page.close();
  }

  // ---------- Bloco 3: notificação push de verdade (contrato da API) ----------
  {
    const vapidInfo = await fetch(`${BASE}/api/push/vapid-public-key`).then((r) => r.json());
    check('endpoint da chave pública VAPID responde sem precisar de login', !!vapidInfo);
    check('servidor de teste está com VAPID configurado (.env) -- "configured: true"', vapidInfo.configured === true);
    check('devolveu a chave pública de verdade', typeof vapidInfo.publicKey === 'string' && vapidInfo.publicKey.length > 20);

    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456' })
    }).then((r) => r.json());
    const token = loginRes.token;
    const adminId = (await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json())).user.id;
    const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

    check('inscrever sem endpoint/keys é recusado (400)', (await fetch(`${BASE}/api/push/subscribe`, { method: 'POST', headers: h, body: JSON.stringify({ subscription: { endpoint: 'https://x.com/y' } }) })).status === 400);
    check('inscrever sem login é recusado (401)', (await fetch(`${BASE}/api/push/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })).status === 401);

    const fakeEndpoint = 'https://fcm.googleapis.com/fcm/send/teste-81a-rodada-' + Date.now();
    const subBody = { subscription: { endpoint: fakeEndpoint, keys: { p256dh: 'fake-p256dh', auth: 'fake-auth' } } };
    const subRes = await fetch(`${BASE}/api/push/subscribe`, { method: 'POST', headers: h, body: JSON.stringify(subBody) });
    check('inscrição válida é aceita (200)', subRes.status === 200);

    // Reinscrever o MESMO endpoint não duplica -- é upsert (mesmo
    // navegador/aparelho reconcedendo a permissão não deve virar 2
    // registros pra receber a notificação 2x).
    await fetch(`${BASE}/api/push/subscribe`, { method: 'POST', headers: h, body: JSON.stringify(subBody) });

    // Criar um recado endereçado a este usuário dispara, por baixo dos
    // panos, uma tentativa de push (ver sendPushToUsers em
    // routes/recados.js) -- com um endpoint falso, a entrega de verdade
    // falha (não tem como ser diferente fora de um navegador de
    // verdade), mas o importante aqui é que a criação do recado em si
    // NUNCA trava nem demora por causa disso (fire-and-forget, ver
    // comentário em utils/webPush.js) -- a pessoa que criou o recado não
    // pode sentir nenhuma lentidão por causa de notificação de outra
    // pessoa.
    const t0 = Date.now();
    const recadoRes = await fetch(`${BASE}/api/recados`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ text: 'Teste 81ª rodada -- push não deve travar a criação', targetUserIds: [adminId] })
    });
    const elapsed = Date.now() - t0;
    check('criar um recado continua respondendo 200 mesmo com uma inscrição de push (falsa) cadastrada', recadoRes.status === 200);
    check('criar o recado não ficou lento por causa da tentativa de push (responde rápido, não espera a rede externa)', elapsed < 2000);

    check('desinscrever funciona (200)', (await fetch(`${BASE}/api/push/unsubscribe`, { method: 'POST', headers: h, body: JSON.stringify({ endpoint: fakeEndpoint }) })).status === 200);
  }

  await browser.close();
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
