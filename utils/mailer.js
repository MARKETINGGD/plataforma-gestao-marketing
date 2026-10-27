// 109ª rodada, pedido da Raquel: "quero poder enviar e-mail de
// notificação para o email de cada membro da equipe- somente as
// notificações de: afastamento, demandas atrasadas (para a pessoa
// responsável), pedido de aprovação em espera a mais de 24 horas
// (somente para quem aprova), pedido de ajuste (somente para quem
// ajusta), recados dos colegas (somente para quem recebeu o recado)."
//
// 3º canal de notificação, ao lado do recado interno (routes/recados.js)
// e do push (utils/webPush.js, 81ª rodada) -- mesmo espírito
// arquitetural dos outros 2: uma função simples, chamada manualmente em
// cada ponto de disparo (nunca escondida dentro de um "decide tudo"),
// "fire and forget" -- uma falha de envio nunca derruba o fluxo
// principal (criar o recado, aprovar o post, etc.).
//
// Serviço de envio: SMTP genérico via `nodemailer` -- funciona com
// Gmail/Google Workspace (usando uma "senha de app", já que o Google
// não aceita mais a senha normal da conta por SMTP) e também com
// qualquer relé SMTP de serviço transacional (SendGrid, Mailgun, Resend,
// Amazon SES, etc.), sem prender a Papoi a um fornecedor específico --
// só muda o valor das variáveis de ambiente abaixo.
//
// Variáveis de ambiente esperadas (nenhuma configurada ainda em
// produção -- ver claude/PLATAFORMA-UNIFICADA-HANDOFF.md, Pendência
// 42, "E-mail de atualização"):
//   SMTP_HOST     -- ex.: smtp.gmail.com
//   SMTP_PORT     -- ex.: 465 (SSL) ou 587 (STARTTLS)
//   SMTP_USER     -- usuário de login SMTP (ex.: marketingghelplus@gmail.com)
//   SMTP_PASS     -- senha de app / API key
//   SMTP_SECURE   -- opcional, 'true'/'false' (default: true se a porta for 465)
//   EMAIL_FROM    -- endereço que aparece como remetente (ex.: "Papoi <marketingghelplus@gmail.com>")
//
// Sem essas variáveis configuradas, a Papoi continua funcionando 100%
// normal -- só esse canal específico fica desligado (mesmo padrão já
// usado pra LinkedIn/Pinterest/TikTok antes das credenciais existirem:
// ver routes/socialAccounts.js).
let nodemailer;
try {
  // eslint-disable-next-line global-require
  nodemailer = require('nodemailer');
} catch (e) {
  nodemailer = null;
}

const db = require('../db');
const { logAudit } = require('./audit');

let transporter = null;
let warned = false;

function warnOnce(msg) {
  if (warned) return;
  warned = true;
  console.warn(`[mailer] ${msg}`);
}

function getTransporter() {
  if (transporter) return transporter;
  if (!nodemailer) {
    warnOnce('pacote "nodemailer" não encontrado -- notificação por e-mail desativada.');
    return null;
  }
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, EMAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !EMAIL_FROM) {
    warnOnce('SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/EMAIL_FROM ainda não configuradas -- notificação por e-mail desativada (o resto da Papoi funciona normalmente).');
    return null;
  }
  const port = Number(SMTP_PORT);
  const secure = SMTP_SECURE !== undefined ? SMTP_SECURE === 'true' : port === 465;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return transporter;
}

// Resolve e-mails cadastrados (campo `email`, 109ª rodada, opcional em
// cada usuário -- ver routes/auth.js) pros ids dados, ignorando quem
// ainda não preencheu o próprio e-mail (continua recebendo recado/push
// normalmente, só não entra nesse canal).
function resolveEmails(userIds) {
  const users = db.get('users').value();
  return (userIds || [])
    .map((id) => users.find((u) => u.id === id))
    .filter((u) => u && u.email && u.email.trim())
    .map((u) => ({ id: u.id, email: u.email.trim(), name: u.name || u.username }));
}

// "Fire and forget" -- nunca lança erro pra quem chamou (mesma garantia
// de sendPushToUsers em utils/webPush.js); falha de envio só loga, nunca
// quebra o fluxo de quem criou o recado/aprovou o post/etc.
function sendEmailToUsers(userIds, { subject, text, html } = {}) {
  try {
    const t = getTransporter();
    if (!t) return;
    const recipients = resolveEmails(userIds);
    if (recipients.length === 0) return;
    const from = process.env.EMAIL_FROM;
    recipients.forEach((r) => {
      t.sendMail({
        from,
        to: r.email,
        subject: `[Papoi] ${subject || 'Notificação'}`,
        text: text || '',
        html: html || `<p>${String(text || '').replace(/\n/g, '<br>')}</p>`
      }).catch((err) => {
        console.warn(`[mailer] falha ao enviar e-mail pra ${r.email}:`, err && err.message);
        // 110ª rodada, correção de bug: antes essa falha só ficava no log
        // do servidor (console.warn), que ninguém monitora -- se a senha
        // de app do Gmail expirasse ou o SMTP bloqueasse o envio, todos os
        // e-mails automáticos passavam a falhar silenciosamente pra
        // sempre, sem ninguém perceber. Agora também fica um rastro no
        // próprio histórico de auditoria da Papoi (visível pra quem olhar
        // o histórico/auditoria), sem implementar nenhum alerta novo.
        try {
          logAudit({
            user: null,
            entityType: 'email',
            entityId: r.id || r.email,
            entityLabel: subject || 'Notificação',
            action: 'send_failed',
            details: `Falha ao enviar e-mail automático: ${subject || 'Notificação'} -- ${(err && err.message) || 'erro desconhecido'}`
          });
        } catch (auditErr) {
          console.warn('[mailer] falha ao gravar log de auditoria da falha de e-mail:', auditErr && auditErr.message);
        }
      });
    });
  } catch (e) {
    console.warn('[mailer] erro inesperado ao tentar enviar e-mail:', e && e.message);
  }
}

module.exports = { sendEmailToUsers };
