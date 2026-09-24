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
  campanhasCooperadas: [],
  // Ponto (47ª rodada, pedido da Raquel) — log de dedup dos lembretes
  // automáticos de bater o ponto (5 min antes / 5 min depois de cada
  // horário cadastrado por pessoa), pra garantir que cada lembrete dispara
  // no máximo 1 vez por dia mesmo com o servidor checando a cada poucos
  // segundos. Ver utils/pontoReminders.js — entradas antigas (+ de alguns
  // dias) são limpas automaticamente a cada checagem, pra não crescer à
  // toa.
  pontoFired: [],
  // Link externo agregado dos Influencers (51ª rodada, pedido da Raquel: "A
  // planilha geral de influencers e aquela separada por marcas, tbm deve ter
  // link externo") — mesmo espírito do link por influencer (publicToken),
  // só que 1 link por "chave" da aba "Todas as ações": 'todos' (todas as
  // marcas), 'debacco' ou 'ghelplus'. Upsert por `key`, mesmo padrão de
  // dashboardPublicLinks acima (coleção separada porque é outro recurso —
  // aqui é a tabela agregada de posts, não um dashboard SSO).
  influencerGroupLinks: [],
  // Link externo por recurso (65ª... 66ª rodada, "Rodada H" da Pendência
  // 51, pedido da Raquel: "budget, feiras, expositores, brindes, campanha
  // cooperada, devem gerar link externo") -- mesmo espírito de
  // dashboardPublicLinks/influencerGroupLinks acima, generalizado pra
  // qualquer recurso: um registro por `resource`+`scopeKey` (upsert),
  // `mode` guarda se é 'leitura' (implementado nesta rodada) ou 'edicao'
  // (ver utils/shareLinks.js -- a parte de edição com sincronia de volta
  // ainda depende de a Raquel confirmar o que cada recurso deve deixar
  // editar de fora, por segurança).
  shareLinks: [],
  // Contas de redes sociais conectadas de verdade (54ª rodada, pedido da
  // Raquel: "conectar o agendamento de redes sociais às apis de verdade").
  // Uma conta por marca+plataforma. 'meta' (Instagram+Facebook, via Login
  // do Facebook para Empresas) desde a 54ª rodada: {id, brand,
  // platform: 'meta', igUserId, igUsername, pageId, pageName,
  // pageAccessToken, tokenExpiresAt, connectedBy, connectedByName,
  // connectedAt}. 'linkedin' desde a 67ª rodada ("vamos para a proxima
  // integração de API, vamos para o linkedin"): {id, brand,
  // platform: 'linkedin', organizationId, organizationUrn, orgName,
  // accessToken, tokenExpiresAt, connectedBy, connectedByName,
  // connectedAt} — ver utils/linkedinClient.js/linkedinPublisher.js. Hoje
  // só 'ghelplus'/'debacco' entram nas 2 plataformas (únicas marcas com
  // Página pronta). O token NUNCA é devolvido pro frontend (ver
  // serialize() em routes/socialAccounts.js) — só usado no servidor, pelos
  // publicadores automáticos.
  socialAccounts: [],
  // Controle de Expositores (68ª rodada, "Rodada I" da Pendência 51,
  // pedido da Raquel: "suba exatamente a planilha que te mandei" --
  // EXPOSITORES 2026.xlsx, aba "2026", 44 itens: 26 GhelPlus + 18 De
  // Bacco). Cada registro é 1 linha da planilha (algumas linhas da
  // planilha original descrevem o mesmo "código entrada" com um "código
  // saída" diferente -- viraram registros separados aqui, com a mesma
  // descrição/código de entrada repetidos, fiéis ao que a própria
  // planilha mostrava célula por célula depois de resolvido o
  // mesclado/merge de células). Ver routes/expositores.js pro
  // significado de cada campo e quais são calculados (nunca aceitos do
  // formulário: saldoTotal, pendenciaPR/SP/NE, valorTotalMensal -- a
  // própria planilha já os calculava por fórmula, e a legenda dela
  // ("Bloqueadas p/ edição") marcava TOTAL/R$ TOTAL como não-editáveis).
  expositoresEstoque: [],
  // Catálogo (arquivo) de Produtos e de Expositores (68ª rodada, pedidos
  // separados da Raquel: "adicione em produtos um sub menu com o nome
  // catálogo... deve ser separado por marca" e, à parte, o mesmo pra
  // Expositores) -- 1 arquivo atual por marca (upload substitui o
  // anterior, que é apagado do disco), nunca um histórico de versões.
  // Coleções separadas de propósito (são 2 pedidos distintos, catálogos
  // diferentes) -- ver utils/catalogFileStore.js (mesmo módulo genérico
  // reaproveitado pelas 2).
  produtosCatalogoFiles: [],
  expositoresCatalogoFiles: []
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
