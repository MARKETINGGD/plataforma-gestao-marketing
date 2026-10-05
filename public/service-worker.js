// Service worker da Papoi (63ª... 64ª rodada, "Rodada F" da Pendência
// 51, pedido da Raquel: "preciso que o Papoi tbm seja um app e possa ser
// instalado no cel"). Existe só pra deixar a Papoi INSTALÁVEL (ganhar o
// botão "Instalar app"/"Adicionar à tela de início" no celular e no
// Chrome do computador) -- não existe pra guardar a Plataforma
// funcionando 100% offline, o que seria perigoso pra um sistema que vive
// mudando (nova rodada quase todo dia) e mostra dados que precisam estar
// sempre atualizados (Demandas, Recados, Agendamento...).
//
// Estratégia deliberadamente simples, "network-first": toda vez que dá
// pra buscar da rede, busca da rede (nunca serve uma versão em cache por
// cima de uma resposta de verdade do servidor) -- o cache só entra em
// cena como uma rede de segurança, pra mostrar ALGUMA coisa (em vez do
// erro cru do navegador) nos raros momentos sem internet nenhuma. Isso
// evita de propósito o problema mais comum de service worker mal
// configurado: alguém instalar o app e ficar preso numa versão antiga da
// tela (app.js/index.html) depois de uma rodada nova, sem nem saber por
// quê.
//
// `CACHE_VERSION` só precisa mudar se um dia a lista de arquivos do
// "casco" abaixo mudar (novo ícone, etc.) -- graças ao index.html já ter
// seu próprio "carimbo de versão" por deploy (`BUILD_VERSION` em
// server.js, 32ª rodada), o service worker não precisa saber de cada
// deploy novo pra servir a versão certa quando online.
const CACHE_VERSION = 'papoi-shell-v1';
const SHELL_FILES = [
  '/',
  '/style.css',
  '/app.js',
  '/manifest.webmanifest',
  '/img/icon-192.png',
  '/img/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_FILES))
      // Ativa a versão nova sem esperar todas as abas antigas fecharem --
      // condiz com o mesmo espírito de "sempre a versão mais nova" do
      // `BUILD_VERSION` do index.html.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// 80ª rodada, pedido da Raquel: "no celular a notificação não aparece"
// -- causa real era no app.js (ver comentário lá em notifyOS): no
// Android/Chrome, chamar `new Notification(...)` direto da PÁGINA dá
// erro sempre que já existe um service worker registrado (é sempre o
// caso aqui) -- o jeito certo é pedir pro PRÓPRIO service worker mostrar
// a notificação (`registration.showNotification`, chamado em app.js).
// Esse listener só cuida do CLIQUE nela: fecha a notificação, acha uma
// aba já aberta da Papoi (ou abre uma nova, se não tiver nenhuma) e
// repassa pra ela qual era a ação (clickId) -- quem de fato executa a
// ação (abrir o chat, ir pro card certo etc.) é a própria página, que já
// tem a função de verdade guardada (ver pendingOsNotifClicks em app.js);
// o service worker não tem como guardar/chamar uma função de JS da
// página, só sabe repassar um id de volta pra ela.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const clickId = event.notification.data && event.notification.data.clickId;
  // `url` (81ª rodada) só vem preenchido numa notificação PUSH (disparada
  // pelo servidor, ver listener 'push' acima) -- uma notificação
  // disparada pela própria página (clickId, 80ª rodada) não tem isso, já
  // resolve o clique repassando pra função certa via postMessage.
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      const client = clientsList[0];
      if (client) {
        client.focus();
        if (clickId) client.postMessage({ type: 'papoi-notification-click', clickId });
      } else {
        self.clients.openWindow(url);
      }
    })
  );
});

// 81ª rodada, pedido da Raquel: "as notificações devem vir no cel, mesmo
// qdo o app esta fechado" -- esse é o pedaço que de fato resolve isso.
// `showNotification` (acima) só roda enquanto a PÁGINA está aberta e
// pede pro service worker mostrar -- esse `push` aqui é diferente: quem
// chama é o PRÓPRIO SISTEMA OPERACIONAL, acordando o service worker
// sozinho quando o servidor manda uma notificação nova (ver
// utils/webPush.js), mesmo com a Papoi inteira fechada/fora da memória.
//
// Antes de mostrar, confere se já existe uma aba da Papoi ABERTA E EM
// FOCO -- se tiver, quem está vendo a tela já recebe o aviso de dentro
// dela mesma (o toast colorido + som, pelo polling de sempre, ver
// showNotifToast/showChatToast em app.js) e mostrar a notificação do
// sistema também viraria um aviso duplicado do mesmo evento. Sem
// nenhuma aba em foco (app fechado, em segundo plano, ou só sem
// ninguém olhando no momento), mostra normalmente -- é exatamente esse
// o caso que não tinha solução nenhuma antes desta rodada.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* payload não era JSON válido -- ignora, usa os padrões abaixo */ }
  const title = data.title || 'Papoi';
  const icon = '/img/icon-192.png';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      const hasFocusedClient = clientsList.some((c) => c.focused);
      if (hasFocusedClient) return;
      return self.registration.showNotification(title, {
        body: data.body || '',
        icon,
        badge: icon,
        tag: data.tag || ('papoi-push-' + Date.now()),
        data: { url: data.url || '/' }
      });
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Só GET entra no jogo de cache -- POST/PUT/DELETE (toda escrita da
  // Papoi) sempre vai direto pra rede, sem passar perto do service
  // worker (nunca faria sentido "cachear" uma escrita).
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Só guarda no cache respostas de verdade (200) do PRÓPRIO
        // domínio da Papoi -- nunca chamadas de API (Demandas, Recados
        // etc. precisam estar sempre atualizadas) nem de fora (CDN de
        // terceiro, se algum dia existir).
        const url = new URL(event.request.url);
        const isOwnOrigin = url.origin === self.location.origin;
        const isApi = url.pathname.startsWith('/api/');
        if (response && response.status === 200 && isOwnOrigin && !isApi) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })
        // Sem internet e sem nada parecido no cache: pra navegação de
        // tela (abrir a Papoi), cai pro casco salvo da própria Início
        // (`/`) em vez de um erro cru -- pra chamadas de API, deixa a
        // falha de rede estourar normalmente (a tela já sabe lidar com
        // isso, mostrando erro/tentando de novo, como sempre fez).
        .then((cached) => cached || (event.request.mode === 'navigate' ? caches.match('/') : undefined)))
  );
});
