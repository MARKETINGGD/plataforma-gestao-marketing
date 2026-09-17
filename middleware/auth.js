const jwt = require('jsonwebtoken');
const db = require('../db');

// MESMO valor precisa estar configurado nas Variables do Railway dos outros
// 3 dashboards — é isso que faz o login único funcionar (ver .env.example).
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-troque-em-producao';

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado. Faça login novamente.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // O token em si só carrega {id, username, role} (contrato compartilhado
    // com o SSO dos outros 3 dashboards — não dá pra mudar isso). Mas
    // dentro da própria Plataforma, "as pessoas não devem ser
    // identificadas pelo usuário, e sim pelo nome" (pedido da Raquel,
    // 16ª rodada) — então aqui enriquecemos req.user com o nome de
    // exibição, buscando no banco local, sem tocar no formato do token.
    const dbUser = db.get('users').find({ id: payload.id }).value();
    req.user = dbUser ? { ...payload, name: dbUser.name || dbUser.username } : payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
  }
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Apenas administradores da plataforma podem fazer isso.' });
  }
  next();
}

module.exports = { requireAuth, requireSuperAdmin, JWT_SECRET };
