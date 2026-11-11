const db = require('../db');
const { logAudit } = require('./audit');
const migration = require('./trafegoPagoMigrationData156.json');

// 156ª rodada, pedido da Raquel: "eu quero que ele pertença a plataforma,
// que fique dentro dela. Com o login dela, mas quero que mantenha o link
// externo de visualização" -- importação ÚNICA (idempotente, mesmo padrão
// de seedBudget2026GhelplusGranular.js e companhia) dos dados reais do
// Tráfego Pago, que até aqui só existiam no volume persistente do Railway
// do app separado (nunca em nenhum arquivo local da Papoi).
//
// Os dados vieram de uma rota temporária criada só pra essa migração
// (routes/exportAll.js no app separado — já removida depois de usada uma
// vez, ver commit da migração), chamada 1x pela própria Raquel com um
// token gerado especialmente pra isso (nunca com a senha/login real dela).
//
// Tratamento aplicado aos `results` antes de congelar neste arquivo (o
// app separado ganhou resultado por rede/plataforma numa rodada
// posterior à maioria destes dados — por isso boa parte das linhas
// antigas não tinha o campo `platform`):
//   - linha sem `platform` e nunca editada (`updatedAt: null`, só zeros) —
//     descartada: é só o placeholder automático que toda campanha ganha
//     pra cada rede declarada, sem nenhum dado real dentro.
//   - linha sem `platform` mas EDITADA (`updatedAt` real) e que já existe
//     uma linha IRMÃ com `platform` definido e `updatedAt` igual ou mais
//     recente — descartada: é a mesma informação, só que já capturada de
//     novo na linha nova (confirmado comparando os números das duas,
//     campanha por campanha, antes de congelar este arquivo).
//   - linha sem `platform`, editada, e SEM nenhuma linha irmã mais nova —
//     (só 1 caso: campanha "Institucional #1" da De Bacco) — preenchida
//     com a 1ª rede declarada da campanha, pra não perder o dado real.
// Resultado: 54 linhas originais -> 19 linhas finais, sem perder nenhum
// gasto real (soma de `spend` antes de descartar duplicata batia exatamente
// com a soma depois, campanha por campanha — conferido nesta rodada).
//
// auditLog: só migra entityType campaign/result/monthly/settings (268 das
// 273 linhas originais — as outras 5 eram "user", sobre contas do login
// PRÓPRIO do app separado, que não existe mais/não tem equivalente na
// Papoi), renomeados para trafegoPagoCampaign/trafegoPagoResult/
// trafegoPagoMonthly/trafegoPagoSettings (ver routes/trafegoPago.js) e com
// `userId` zerado (apontava pra conta de um sistema de login que deixou
// de existir — o nome da pessoa em `username` continua exibido
// normalmente, igual a qualquer ação sem usuário fica como "sistema").
function seedTrafegoPagoMigration156() {
  const already = db.get('trafegoPagoCampaigns').filter({ importBatch: migration.importBatch }).value();
  if (already.length > 0) {
    console.log(`[seedTrafegoPagoMigration156] Pulado: já existem ${already.length} campanha(s) importada(s) desse lote.`);
    return;
  }
  const campaigns = migration.campaigns.map((c) => Object.assign({}, c, { importBatch: migration.importBatch }));
  db.get('trafegoPagoCampaigns').push(...campaigns).write();
  db.get('trafegoPagoResults').push(...migration.results).write();
  if (migration.monthly.length) db.get('trafegoPagoMonthly').push(...migration.monthly).write();
  db.get('trafegoPagoSettings').push(...migration.settings).write();
  // Push em lote (1 escrita só) em vez de 1 escrita por entrada -- 268
  // reescritas inteiras do arquivo (o adaptador do lowdb reescreve o
  // db.json inteiro a cada .write()) deixavam essa importação bem mais
  // lenta do que precisa, sem nenhum ganho (ninguém lê o arquivo no meio
  // do processo mesmo assim).
  if (migration.auditLog.length) db.get('auditLog').push(...migration.auditLog).write();
  logAudit({
    user: null, entityType: 'trafegoPagoMigration', entityId: migration.importBatch,
    entityLabel: 'Migração do Tráfego Pago pra dentro da Papoi', action: 'import',
    details: `${campaigns.length} campanhas, ${migration.results.length} resultados, ${migration.settings.length} configuração(ões) de marca, ${migration.auditLog.length} entradas de histórico. Exportado do app separado em ${migration.exportedAt}.`
  });
  console.log(`[seedTrafegoPagoMigration156] Importados: ${campaigns.length} campanhas, ${migration.results.length} resultados, ${migration.auditLog.length} entradas de histórico.`);
}

module.exports = { seedTrafegoPagoMigration156 };
