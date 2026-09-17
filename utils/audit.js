const db = require('../db');
const { nanoid } = require('./id');

// `meta` (22ª rodada): campos extras mesclados no registro, sem mexer em
// nada que já usava logAudit antes (todo mundo que chama sem meta continua
// funcionando igual). Usado hoje só por Demandas, pra gravar a
// visibilidade ('geral'/'pessoal') junto de cada ação — necessário pro
// histórico do quadro geral saber filtrar, sem depender de olhar o
// registro atual (que pode já ter sido excluído).
function logAudit({ user, entityType, entityId, entityLabel, action, details, meta }) {
  db.get('auditLog').push(Object.assign({
    id: nanoid(),
    userId: user ? user.id : null,
    username: user ? user.username : 'sistema',
    entityType,
    entityId,
    entityLabel,
    action,
    details: details || '',
    createdAt: new Date().toISOString()
  }, meta || {})).write();
}

module.exports = { logAudit };
