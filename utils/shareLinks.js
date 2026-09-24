// Link externo genérico, reaproveitado por vários recursos (65ª... 66ª
// rodada, "Rodada H" da Pendência 51, pedido da Raquel: "as abas budget,
// feiras, expositores, brindes, campanha cooperada, devem gerar link
// externo (com a possibilidade de 2 tipos de link, apenas leitura ou
// edição)"). Mesmo espírito já usado em dashboardPublicLinks
// (routes/dashboards.js) e influencerGroupLinks (routes/influencers.js) —
// só que generalizado, pra não duplicar essa lógica em cada arquivo de
// rota que precisar de um link externo novo.
//
// **Escopo desta rodada**: só o tipo "leitura" está implementado (usado
// por Budget/Feiras/Brindes/Campanha Cooperada). O tipo "edição" (deixar
// alguém de fora, sem login, editar dados que sincronizam de volta pra
// Papoi automaticamente) é uma decisão de segurança real -- expor
// escrita sem login em dados de negócio (orçamento, campanhas) exige
// saber exatamente QUAIS campos cada recurso deve deixar editar de fora,
// pra não abrir mais do que deveria só porque um link vazou ou foi
// encaminhado pra alguém errado. Por isso o campo `mode` já existe no
// formato ('leitura'/'edicao'), pronto pra quando a Raquel confirmar o
// escopo de edição por recurso, mas só 'leitura' é gerado por enquanto.
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

function generateLink(resource, scopeKey, req) {
  const token = crypto.randomBytes(20).toString('hex');
  const existing = getLink(resource, scopeKey);
  const patch = { token, mode: 'leitura', createdAt: new Date().toISOString(), createdBy: req.user.id, createdByName: req.user.name };
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
