const jwt = require('jsonwebtoken');

// MESMO valor precisa estar configurado nas Variables do Railway dos outros
// 3 dashboards — é isso que faz o login único funcionar (ver .env.example).
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-troque-em-producao';

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado. Faça login novamente.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
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
