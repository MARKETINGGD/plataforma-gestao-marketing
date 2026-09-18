const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const adapter = new FileSync(path.join(dataDir, 'db.json'));
const db = low(adapter);

db.defaults({
  users: [],
  // Orçamento planejado x realizado (aba "Orçamento" da plataforma)
  budgetEntries: [],
  // Acompanhamento de Demandas (quadro estilo Trello, listas por pessoa).
  // Cada demanda tem visibility 'geral' (quadro visto por todo mundo) ou
  // 'pessoal' (só visível pra quem criou + quem foi marcado).
  demandas: [],
  // Etiquetas coloridas usadas nos cards de Demandas (nome + cor, editável)
  labels: [],
  // Recados do mural da tela Início — coloridos, com destinatários
  recados: [],
  // Agendamento de posts de redes sociais (manual por enquanto — a ideia é
  // no futuro conectar com as APIs da Meta/LinkedIn/TikTok/YouTube/Pinterest)
  socialPosts: [],
  // Brindes — catálogo/estoque e registro de saídas por representante
  brindesCatalog: [],
  brindesLog: [],
  // Retiradas Internas (38ª rodada, pedido da Raquel: submenu novo dentro
  // de Brindes) — registro de retirada interna de brinde/vinho (não é
  // saída pra representante/cliente, isso já é o `brindesLog` acima). Ver
  // routes/retiradasInternas.js.
  retiradasInternas: [],
  auditLog: [],
  // Gerenciamento de Influencers (14ª rodada) — dividido por marca
  // (De Bacco / GhelPlus). Cada influencer tem sua própria "tabela"
  // (influencerPosts) e pode ter um link externo próprio (publicToken).
  influencers: [],
  influencerPosts: [],
  // Chat da Equipe (18ª rodada) — mural único de conversa, visível pra
  // qualquer pessoa logada na Plataforma (não são conversas privadas).
  chatMessages: [],
  // Conversas do Chat (40ª rodada, pedido da Raquel: grupos + conversas
  // privadas) — cada registro é um grupo ('group', com `name` e
  // `participantIds`) ou uma conversa privada de 2 pessoas ('dm', sem
  // `name`, só `participantIds` com exatamente 2 ids). O mural "Geral" de
  // sempre NÃO tem registro aqui — continua sendo o `chatMessages` sem
  // `conversationId` (ou com o valor 'geral'), pra não precisar migrar
  // nada e a janelinha flutuante de chat continuar funcionando sem
  // nenhuma mudança (ela só fala com o mural Geral). Ver routes/chat.js.
  chatConversations: [],
  // Link externo por dashboard (28ª rodada) — igual ao link externo dos
  // Influencers: um token por dashboard (Mídias, Tráfego Pago), pra gente
  // de fora acompanhar sem precisar de conta na Plataforma. Um registro
  // por dashboard, upsert por 'key' (ver routes/dashboards.js).
  dashboardPublicLinks: [],
  // Produtos (33ª rodada, pedido da Raquel: "no botão produtos deve ter um
  // sub menu com: análise de concorrência, lançamentos de produtos") — duas
  // listas independentes, por marca, com o mesmo padrão de permissão
  // "produtos" (editor/admin) já usado pra editar Brindes/Expositores.
  concorrencia: [],
  lancamentosProdutos: [],
  // Feiras (41ª rodada, pedido da Raquel) — cada feira (FEICON, ExpoRevestir
  // etc.) é uma edição por marca/ano/fluxo, com uma lista de itens (nome,
  // quantidade, fornecedor, valor mês a mês). Ver routes/feiras.js.
  feiras: [],
  // Campanha Cooperada (43ª rodada, pedido da Raquel: botão novo logo
  // abaixo de Brindes) — cada registro é uma campanha cooperada com um
  // cliente/representante, separada por marca (De Bacco / GhelPlus), com
  // um documento de orçamento anexo. Ver routes/campanhaCooperada.js.
  campanhasCooperadas: []
}).write();

// Migração: os cards de Demandas tinham só 1 responsável (assigneeId).
// Agora o quadro é organizado em listas por pessoa e um card pode ser
// compartilhado com várias pessoas (assigneeIds) e ter etiquetas (labelIds).
const demandasParaMigrar = db.get('demandas').filter((d) => d.assigneeIds === undefined).value();
if (demandasParaMigrar.length > 0) {
  demandasParaMigrar.forEach((d) => {
    const assigneeIds = d.assigneeId ? [d.assigneeId] : [];
    db.get('demandas').find({ id: d.id }).assign({
      assigneeIds,
      labelIds: d.labelIds || []
    }).write();
  });
}

// Migração: demandas antigas não tinham o conceito de quadro pessoal —
// todas elas continuam valendo como quadro geral (visível a todo mundo).
const demandasSemVisibilidade = db.get('demandas').filter((d) => d.visibility === undefined).value();
if (demandasSemVisibilidade.length > 0) {
  demandasSemVisibilidade.forEach((d) => {
    db.get('demandas').find({ id: d.id }).assign({ visibility: 'geral' }).write();
  });
}

// Migração: Agendamento para Redes Sociais passou a ser dividido por marca
// (De Bacco / GhelPlus). Posts antigos, criados antes dessa separação,
// caem em 'debacco' por padrão — a Raquel pode reclassificar editando o post.
const socialPostsSemMarca = db.get('socialPosts').filter((p) => p.brand === undefined).value();
if (socialPostsSemMarca.length > 0) {
  socialPostsSemMarca.forEach((p) => {
    db.get('socialPosts').find({ id: p.id }).assign({ brand: 'debacco' }).write();
  });
}

module.exports = db;
