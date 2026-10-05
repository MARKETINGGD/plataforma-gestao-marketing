// Notificações push de verdade (81ª rodada, pedido da Raquel: "as
// notificações devem vir no cel, mesmo qdo o app esta fechado").
//
// A 80ª rodada corrigiu a notificação do sistema operacional, mas ela
// dependia da PÁGINA da Papoi estar aberta e rodando: um temporizador
// dentro do app.js (polling) é quem detectava recado/mensagem nova e
// pedia pro service worker mostrar a notificação (`notifyOS` em
// app.js). Fechando a aba -- ou o Android/iOS matando o processo em
// segundo plano, que costuma acontecer rápido -- esse temporizador para
// de rodar, e nada mais chega.
//
// Web Push resolve isso de outro jeito: o PRÓPRIO SERVIDOR manda a
// notificação pro navegador entregar (via um serviço de push do
// Google/Apple/Microsoft, dependendo do navegador), e é o SISTEMA
// OPERACIONAL quem acorda o service worker da Papoi sozinho pra mostrar
// a notificação -- sem precisar de nenhuma aba aberta. É o mesmo
// mecanismo por trás da notificação de qualquer app instalado de
// verdade (WhatsApp Web, Gmail, Instagram etc.).
//
// Funciona com um par de chaves "VAPID" (geradas 1 vez só, pra sempre --
// diferente de credencial de API de rede social, NÃO depende de
// aprovação de ninguém de fora, a própria Papoi se auto-assina) --
// `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` no .env/Railway. Sem essas 2
// variáveis configuradas, a Papoi continua funcionando normalmente em
// tudo o mais -- só a notificação com o app fechado fica indisponível
// (silenciosamente: ver `isConfigured()` abaixo, checado antes de tentar
// mandar qualquer push).
const webpush = require('web-push');
const db = require('../db');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
// "mailto:" exigido pelo padrão VAPID (contato pro serviço de push poder
// avisar o dono do app em caso de abuso) -- não precisa ser um e-mail
// monitorado especificamente pra isso, só precisa existir.
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:marketingghelplus@gmail.com';

let configured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
} else {
  // eslint-disable-next-line no-console
  console.warn('[webPush] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas -- notificação push com o app fechado fica desativada (o resto da Papoi funciona normalmente).');
}

function isConfigured() {
  return configured;
}

// Mesma chave pública exposta pro navegador assinar a inscrição
// (`PushManager.subscribe`, ver GET /api/push/vapid-public-key em
// routes/push.js).
function getPublicKey() {
  return VAPID_PUBLIC_KEY;
}

// Manda 1 notificação push pra TODAS as inscrições (navegador/aparelho)
// de uma lista de pessoas -- usado pelos mesmos lugares que já disparam
// recado automático/mensagem de chat (ver createAutoRecado em
// routes/recados.js e as rotas de mensagem em routes/chat.js).
//
// Deliberadamente "fire and forget" (não é `await`ado por quem chama) --
// mandar um push é uma chamada de rede pro serviço de push de cada
// navegador (Google/Mozilla/Apple), que pode demorar; a ação principal
// (criar o recado, mandar a mensagem) não deve esperar isso pra responder
// pra quem fez a ação.
//
// Uma inscrição que o serviço de push devolve como definitivamente morta
// (410 Gone -- pessoa desinstalou o navegador, limpou os dados do site,
// etc.) é removida do banco sozinha, pra não ficar tentando pra sempre.
function sendPushToUsers(userIds, { title, body, tag, url }) {
  if (!configured) return;
  const ids = Array.isArray(userIds) ? userIds.filter(Boolean) : [];
  if (ids.length === 0) return;
  const subs = db.get('pushSubscriptions').filter((s) => ids.includes(s.userId)).value();
  if (subs.length === 0) return;
  const payload = JSON.stringify({
    title: title || 'Papoi',
    body: body || '',
    tag: tag || 'papoi-push-' + Date.now(),
    url: url || '/'
  });
  subs.forEach((sub) => {
    const pushSubscription = { endpoint: sub.endpoint, keys: sub.keys };
    webpush.sendNotification(pushSubscription, payload).catch((err) => {
      const statusCode = err && err.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Inscrição morta de vez (navegador/serviço confirmou que não
        // existe mais) -- remove pra não acumular lixo nem tentar de novo.
        db.get('pushSubscriptions').remove({ id: sub.id }).write();
      }
      // Qualquer outra falha (rede instável, serviço de push fora do ar
      // por um instante) é só ignorada -- não é crítica pro resto da
      // Papoi, e o próximo evento tenta de novo naturalmente.
    });
  });
}

module.exports = { isConfigured, getPublicKey, sendPushToUsers };
