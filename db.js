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
  // Acompanhamento de Demandas (quadro estilo Trello)
  demandas: [],
  // Brindes — catálogo/estoque e registro de saídas por representante
  brindesCatalog: [],
  brindesLog: [],
  auditLog: []
}).write();

module.exports = db;
