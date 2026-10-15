// Limite de tentativas de login (rodada de segurança, 15/10/2026) — pedido
// da Raquel: "o que falta para deixar 100% segura a plataforma papoi?".
// Antes, não existia NENHUM limite: um script poderia tentar milhares de
// senhas seguidas pro mesmo usuário sem nada travar (ataque de força
// bruta). Agora, depois de MAX_ATTEMPTS senhas erradas seguidas pro MESMO
// usuário, login nesse usuário fica bloqueado por um tempo — mesmo que a
// senha certa seja digitada durante o bloqueio, continua recusando (é assim
// que trava de verdade um ataque automatizado, que tentaria a senha certa
// dentro da leva de tentativas).
//
// Em memória, por processo (um Map simples) — não precisa de banco nem de
// coleção nova: o objetivo é atrapalhar um ataque em andamento agora, não
// guardar histórico (isso já existe à parte, no Histórico de alterações,
// via auditLog). Reseta sozinho a cada redeploy do servidor, o que é
// aceitável pra esse propósito.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutos — janela em que as tentativas contam juntas
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutos — duração do bloqueio depois de estourar o limite

const attemptsByUsername = new Map(); // username normalizado -> { count, firstAttemptAt, lockedUntil }

function normalize(username) {
  return String(username || '').trim().toLowerCase();
}

// Devolve quantos milissegundos ainda faltam de bloqueio pra esse usuário
// (0 = não está bloqueado).
function msLockedFor(username) {
  const key = normalize(username);
  if (!key) return 0;
  const entry = attemptsByUsername.get(key);
  if (!entry || !entry.lockedUntil) return 0;
  const remaining = entry.lockedUntil - Date.now();
  if (remaining <= 0) {
    attemptsByUsername.delete(key); // bloqueio expirado, limpa pra não guardar lixo pra sempre
    return 0;
  }
  return remaining;
}

function registerFailedAttempt(username) {
  const key = normalize(username);
  if (!key) return;
  const now = Date.now();
  let entry = attemptsByUsername.get(key);
  if (!entry || now - entry.firstAttemptAt > WINDOW_MS) {
    entry = { count: 0, firstAttemptAt: now, lockedUntil: 0 };
  }
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_MS;
  }
  attemptsByUsername.set(key, entry);
}

// Login bem-sucedido zera o contador desse usuário — a pessoa certa não
// fica penalizada por ter errado a senha algumas vezes antes de acertar.
function registerSuccessfulLogin(username) {
  attemptsByUsername.delete(normalize(username));
}

module.exports = { msLockedFor, registerFailedAttempt, registerSuccessfulLogin, MAX_ATTEMPTS, LOCKOUT_MS };
