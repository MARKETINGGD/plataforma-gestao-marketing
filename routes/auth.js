const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth, requireSuperAdmin, JWT_SECRET } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

const EMPTY_PERMISSIONS = { trafegoPago: 'none', acoesSazonais: 'none', redesSociais: 'none', budget: 'none' };
const FULL_PERMISSIONS = { trafegoPago: 'admin', acoesSazonais: 'admin', redesSociais: 'admin', budget: 'admin' };

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.isSuperAdmin ? 'super_admin' : 'user' },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    name: u.name || u.username,
    isSuperAdmin: !!u.isSuperAdmin,
    permissions: u.permissions || EMPTY_PERMISSIONS,
    createdAt: u.createdAt
  };
}

function sanitizePermissions(input) {
  const allowed = ['none', 'editor', 'admin'];
  const out = { ...EMPTY_PERMISSIONS };
  ['trafegoPago', 'acoesSazonais', 'redesSociais', 'budget'].forEach((key) => {
    if (input && allowed.includes(input[key])) out[key] = input[key];
  });
  return out;
}

// Diz ao frontend se ainda não existe nenhum usuário (primeiro acesso)
router.get('/status', (req, res) => {
  const existing = db.get('users').value();
  res.json({ needsSetup: existing.length === 0 });
});

// Cria o primeiro usuário — sempre super admin com acesso total. Só funciona
// se ainda não existir ninguém (mesmo padrão dos outros 3 dashboards).
router.post('/setup', (req, res) => {
  const existing = db.get('users').value();
  if (existing.length > 0) {
    return res.status(400).json({ error: 'Já existe um administrador configurado. Peça para ele criar seu usuário.' });
  }
  const { username, password, name } = req.body || {};
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: 'Informe um usuário e uma senha com pelo menos 6 caracteres.' });
  }
  const user = {
    id: nanoid(),
    username: username.trim(),
    passwordHash: bcrypt.hashSync(password, 10),
    name: (name || username).trim(),
    isSuperAdmin: true,
    permissions: FULL_PERMISSIONS,
    createdAt: new Date().toISOString()
  };
  db.get('users').push(user).write();
  logAudit({ user, entityType: 'user', entityId: user.id, entityLabel: user.username, action: 'create', details: 'Primeiro administrador da plataforma criado' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.get('users').find({ username: (username || '').trim() }).value();
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado. Faça login novamente.' });
  res.json({ user: publicUser(user) });
});

// Gestão de usuários da plataforma — só super admin
router.get('/users', requireAuth, requireSuperAdmin, (req, res) => {
  res.json({ users: db.get('users').value().map(publicUser) });
});

router.post('/users', requireAuth, requireSuperAdmin, (req, res) => {
  const { username, password, name, isSuperAdmin, permissions } = req.body || {};
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: 'Informe um usuário e uma senha com pelo menos 6 caracteres.' });
  }
  if (db.get('users').find({ username: username.trim() }).value()) {
    return res.status(400).json({ error: 'Já existe um usuário com esse nome.' });
  }
  const user = {
    id: nanoid(),
    username: username.trim(),
    passwordHash: bcrypt.hashSync(password, 10),
    name: (name || username).trim(),
    isSuperAdmin: !!isSuperAdmin,
    permissions: isSuperAdmin ? FULL_PERMISSIONS : sanitizePermissions(permissions),
    createdAt: new Date().toISOString()
  };
  db.get('users').push(user).write();
  logAudit({ user: req.user, entityType: 'user', entityId: user.id, entityLabel: user.username, action: 'create', details: `Super admin: ${user.isSuperAdmin}` });
  res.json({ user: publicUser(user) });
});

router.put('/users/:id', requireAuth, requireSuperAdmin, (req, res) => {
  const target = db.get('users').find({ id: req.params.id }).value();
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const { name, password, isSuperAdmin, permissions } = req.body || {};
  const updates = {};
  if (name) updates.name = name.trim();
  if (typeof isSuperAdmin === 'boolean') updates.isSuperAdmin = isSuperAdmin;
  updates.permissions = updates.isSuperAdmin || (updates.isSuperAdmin === undefined && target.isSuperAdmin)
    ? FULL_PERMISSIONS
    : sanitizePermissions(permissions || target.permissions);
  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
    updates.passwordHash = bcrypt.hashSync(password, 10);
  }
  db.get('users').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'user', entityId: target.id, entityLabel: target.username, action: 'update', details: 'Permissões/dados atualizados' });
  res.json({ user: publicUser(db.get('users').find({ id: req.params.id }).value()) });
});

router.delete('/users/:id', requireAuth, requireSuperAdmin, (req, res) => {
  const target = db.get('users').find({ id: req.params.id }).value();
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Você não pode excluir o próprio usuário logado.' });
  db.get('users').remove({ id: req.params.id }).write();
  logAudit({ user: req.user, entityType: 'user', entityId: target.id, entityLabel: target.username, action: 'delete', details: 'Usuário removido' });
  res.json({ ok: true });
});

module.exports = router;
