// Autenticação interna entre serviços (41ª rodada) — usada só pela rota de
// sincronização com o dashboard de Ações Sazonais (routes/integrations.js).
// Não é login de usuário: é uma chave fixa (INTERNAL_SYNC_TOKEN), a mesma
// configurada nos dois lados (Plataforma e Ações Sazonais) via variável de
// ambiente no Railway.
function requireInternalToken(req, res, next) {
  const expected = process.env.INTERNAL_SYNC_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'Integração com Ações Sazonais não configurada (falta INTERNAL_SYNC_TOKEN no ambiente).' });
  }
  const got = req.get('x-internal-token');
  if (!got || got !== expected) {
    return res.status(401).json({ error: 'Token interno inválido.' });
  }
  next();
}

module.exports = { requireInternalToken };
