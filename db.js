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
  // Acompanhamento de Demandas (quadro estilo Trello, listas por pessoa)
  demandas: [],
  // Etiquetas coloridas usadas nos cards de Demandas (nome + cor, editável)
  labels: [],
  // Brindes — catálogo/estoque e registro de saídas por representante
  brindesCatalog: [],
  brindesLog: [],
  auditLog: []
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

module.exports = db;
