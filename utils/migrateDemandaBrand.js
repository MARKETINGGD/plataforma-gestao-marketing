const db = require('../db');

// 37ª rodada: dá um `brand` retroativo pra demanda que já tinha nascido de
// um agendamento/ação de influencer (tem `sourceSocialPostId`) ANTES desse
// campo existir -- sem essa migração, só demanda criada DAQUI PRA FRENTE
// mostraria o ícone da marca no título do card, e todo o histórico já
// criado ficaria sem ícone. Busca a marca no agendamento de origem (que já
// tinha `brand` desde sempre); se o agendamento não existir mais, não dá
// pra saber a marca e a demanda fica sem ícone mesmo (não é um erro, só não
// tem como descobrir). Idempotente (só mexe em quem ainda não tem `brand`),
// roda sozinha a cada início do servidor.
function migrateDemandaBrand() {
  let total = 0;
  const posts = db.get('socialPosts').value();
  db.get('demandas').value().forEach((d) => {
    if (d.brand || !d.sourceSocialPostId) return;
    const post = posts.find((p) => p.id === d.sourceSocialPostId);
    if (post && post.brand) {
      db.get('demandas').find({ id: d.id }).assign({ brand: post.brand }).write();
      total += 1;
    }
  });
  if (total > 0) {
    console.log(`[migrateDemandaBrand] ${total} demanda(s) receberam a marca retroativa (ícone no título).`);
  }
}

module.exports = { migrateDemandaBrand };
