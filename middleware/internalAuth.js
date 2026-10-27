const crypto = require('crypto');

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
  // 110ª rodada, correção de bug: comparação de string comum (`!==`) deixa
  // o tempo de resposta vazar informação sobre quantos caracteres do
  // token batem (timing attack), numa rota exposta publicamente e sem
  // rate limit. `crypto.timingSafeEqual` compara em tempo constante, mas
  // exige os 2 buffers do MESMO tamanho (lança erro se os tamanhos forem
  // diferentes) -- por isso a conferência de tamanho vem antes, e pode
  // usar `!==` normal aí (o tamanho do token esperado não é segredo, não
  // há timing attack relevante nesse passo).
  if (!got || Buffer.byteLength(got) !== Buffer.byteLength(expected) ||
      !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Token interno inválido.' });
  }
  next();
}

module.exports = { requireInternalToken };
