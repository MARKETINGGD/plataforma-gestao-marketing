const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth, requireSuperAdmin, JWT_SECRET } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// Brindes/Produtos/Expositores: view fica aberta a todo mundo (não são
// gates de visualização como o Orçamento) — essas 3 chaves controlam só
// quem pode EDITAR em cada uma. Produtos e Expositores ainda são só
// placeholders na tela, mas o campo já fica pronto no cadastro de usuário
// pra quando ganharem conteúdo de verdade.
const EMPTY_PERMISSIONS = { trafegoPago: 'none', acoesSazonais: 'none', redesSociais: 'none', budget: 'none', brindes: 'none', produtos: 'none', expositores: 'none' };
const FULL_PERMISSIONS = { trafegoPago: 'admin', acoesSazonais: 'admin', redesSociais: 'admin', budget: 'admin', brindes: 'admin', produtos: 'admin', expositores: 'admin' };
const PERMISSION_KEYS = ['trafegoPago', 'acoesSazonais', 'redesSociais', 'budget', 'brindes', 'produtos', 'expositores'];

// Cargo (função) da pessoa na equipe — usado pro Cronograma de Marketing:
// a aba Calendário fica restrita a todo mundo, exceto quem tem cargo
// 'gerente'. '' (não definido) conta como liberado, pra não travar
// usuários antigos que ainda não tiveram o cargo cadastrado.
const CARGOS = ['gerente', 'analista', 'auxiliar', 'coordenador', 'designer', 'designer3d', 'videomaker'];

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
    cargo: u.cargo || '',
    createdAt: u.createdAt
  };
}

function sanitizePermissions(input) {
  const allowed = ['none', 'editor', 'admin'];
  const out = { ...EMPTY_PERMISSIONS };
  PERMISSION_KEYS.forEach((key) => {
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

// Cada usuário pode trocar a própria senha, sem precisar de um super admin —
// só exige confirmar a senha atual.
router.put('/me/password', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado. Faça login novamente.' });
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !bcrypt.compareSync(currentPassword, user.passwordHash)) {
    return res.status(400).json({ error: 'Senha atual incorreta.' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 6 caracteres.' });
  }
  db.get('users').find({ id: user.id }).assign({ passwordHash: bcrypt.hashSync(newPassword, 10) }).write();
  logAudit({ user, entityType: 'user', entityId: user.id, entityLabel: user.username, action: 'update', details: 'Senha alterada pelo próprio usuário' });
  res.json({ ok: true });
});

// Lista leve de usuários da plataforma (id/nome/cargo), usada para escolher
// o responsável de uma Demanda ou as pessoas envolvidas num Agendamento.
// Qualquer pessoa logada pode ver — não expõe senha nem permissões.
router.get('/team', requireAuth, (req, res) => {
  const users = db.get('users').value().map((u) => ({ id: u.id, username: u.username, name: u.name || u.username, cargo: u.cargo || '' }));
  res.json({ users, cargos: CARGOS });
});

// Gerenciamento leve de equipe, direto da tela de Acompanhamento de
// Demandas — qualquer pessoa logada pode adicionar ou remover um colega,
// pra manter as colunas do quadro em dia sem precisar ser administrador
// da plataforma. Continua criando um usuário de verdade (com login), só
// que sempre sem permissões especiais e sem admin — isso continua só na
// tela Usuários, restrita a super admin.
router.post('/team', requireAuth, (req, res) => {
  const { username, password, name, cargo } = req.body || {};
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
    isSuperAdmin: false,
    permissions: { ...EMPTY_PERMISSIONS },
    cargo: CARGOS.includes(cargo) ? cargo : '',
    createdAt: new Date().toISOString()
  };
  db.get('users').push(user).write();
  logAudit({ user: req.user, entityType: 'user', entityId: user.id, entityLabel: user.username, action: 'create', details: 'Adicionado(a) pela tela de Acompanhamento de Demandas' });
  res.json({ user: publicUser(user) });
});

router.delete('/team/:id', requireAuth, (req, res) => {
  const target = db.get('users').find({ id: req.params.id }).value();
  if (!target) return res.status(404).json({ error: 'Pessoa não encontrada.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Você não pode remover a si mesmo(a).' });
  if (target.isSuperAdmin) return res.status(400).json({ error: 'Não é possível remover um administrador da plataforma por aqui — peça pra outro admin fazer isso na tela de Usuários.' });
  db.get('users').remove({ id: req.params.id }).write();
  logAudit({ user: req.user, entityType: 'user', entityId: target.id, entityLabel: target.username, action: 'delete', details: 'Removido(a) pela tela de Acompanhamento de Demandas' });
  res.json({ ok: true });
});

// Gestão de usuários da plataforma — só super admin
router.get('/users', requireAuth, requireSuperAdmin, (req, res) => {
  res.json({ users: db.get('users').value().map(publicUser) });
});

router.post('/users', requireAuth, requireSuperAdmin, (req, res) => {
  const { username, password, name, isSuperAdmin, permissions, cargo } = req.body || {};
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
    cargo: CARGOS.includes(cargo) ? cargo : '',
    createdAt: new Date().toISOString()
  };
  db.get('users').push(user).write();
  logAudit({ user: req.user, entityType: 'user', entityId: user.id, entityLabel: user.username, action: 'create', details: `Super admin: ${user.isSuperAdmin}` });
  res.json({ user: publicUser(user) });
});

router.put('/users/:id', requireAuth, requireSuperAdmin, (req, res) => {
  const target = db.get('users').find({ id: req.params.id }).value();
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const { name, password, isSuperAdmin, permissions, cargo } = req.body || {};
  const updates = {};
  if (name) updates.name = name.trim();
  if (typeof isSuperAdmin === 'boolean') updates.isSuperAdmin = isSuperAdmin;
  if (cargo !== undefined) updates.cargo = CARGOS.includes(cargo) ? cargo : '';
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
