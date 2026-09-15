const db = require('../db');
const { nanoid } = require('./id');

function logAudit({ user, entityType, entityId, entityLabel, action, details }) {
  db.get('auditLog').push({
    id: nanoid(),
    userId: user ? user.id : null,
    username: user ? user.username : 'sistema',
    entityType,
    entityId,
    entityLabel,
    action,
    details: details || '',
    createdAt: new Date().toISOString()
  }).write();
}

module.exports = { logAudit };
