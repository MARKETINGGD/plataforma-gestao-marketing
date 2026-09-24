// Link externo genérico, reaproveitado por vários recursos (65ª... 66ª
// rodada, "Rodada H" da Pendência 51, pedido da Raquel: "as abas budget,
// feiras, expositores, brindes, campanha cooperada, devem gerar link
// externo (com a possibilidade de 2 tipos de link, apenas leitura ou
// edição)"). Mesmo espírito já usado em dashboardPublicLinks
// (routes/dashboards.js) e influencerGroupLinks (routes/influencers.js) —
// só que generalizado, pra não duplicar essa lógica em cada arquivo de
// rota que precisar de um link externo novo.
//
// **68ª rodada**: o 1º uso de verdade do tipo "edição" chegou -- pedido
// explícito da Raquel pro catálogo geral de Brindes: "deve ter a opção
// de apenas visualizar ou editar (pessoas que não acessam a planilha,
// precisam fazer esse controle)". `generateLink` agora aceita um `mode`
// opcional ('leitura', o padrão de sempre, ou 'edicao') -- cada recurso
// que quiser oferecer edição decide POR SI SÓ quais campos aceita
// escrever num link sem login (ver `PUT /public/:token/...` em
// routes/brindes.js) -- este módulo só guarda QUAL modo aquele link tem,
// nunca decide o que pode ser editado.
const db = require('../db');
const crypto = require('crypto');

// `scopeKey` desambigua dentro do mesmo `resource` -- ex.: a marca
// ('debacco'/'ghelplus') pra Budget/Brindes/Campanha Cooperada, ou
// 'geral' pra um recurso que não separa por marca.
function getLink(resource, scopeKey) {
  return db.get('shareLinks').find({ resource, scopeKey }).value() || null;
}

function findByToken(token) {
  return db.get('shareLinks').find({ token }).value() || null;
}

function generateLink(resource, scopeKey, req, mode) {
  const token = crypto.randomBytes(20).toString('hex');
  const existing = getLink(resource, scopeKey);
  const patch = { token, mode: mode === 'edicao' ? 'edicao' : 'leitura', createdAt: new Date().toISOString(), createdBy: req.user.id, createdByName: req.user.name };
  if (existing) {
    db.get('shareLinks').find({ resource, scopeKey }).assign(patch).write();
  } else {
    db.get('shareLinks').push(Object.assign({ resource, scopeKey }, patch)).write();
  }
  return token;
}

function revokeLink(resource, scopeKey) {
  db.get('shareLinks').remove({ resource, scopeKey }).write();
}

module.exports = { getLink, findByToken, generateLink, revokeLink };
