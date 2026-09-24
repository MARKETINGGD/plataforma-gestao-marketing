const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth, requireSuperAdmin, JWT_SECRET } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// Foto de perfil (20ª rodada, pedido da Raquel: "Em usuários, deve ter a
// opção de cadastrar a foto da pessoa, e ai no bate papo e no calendário,
// cronograma, deve aparecer a fotinho da pessoa"). Uma foto por pessoa —
// cada upload novo soma um arquivo (mesmo padrão de nunca apagar nada
// já usado nos outros uploads da Plataforma), e o registro só passa a
// apontar pro arquivo mais recente.
const avatarsRoot = path.join(__dirname, '..', 'data', 'uploads', 'avatars');
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // req.params.id existe em POST /users/:id/photo (admin); em POST
    // /me/photo (autoatendimento) usa o id de quem está logado.
    const userId = req.params.id || (req.user && req.user.id);
    const dir = path.join(avatarsRoot, userId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, Date.now() + '-' + safe);
  }
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB — suficiente pra uma foto de perfil
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('Envie uma imagem (JPG, PNG, etc.).'));
    cb(null, true);
  }
});

// Brindes/Produtos/Expositores: view fica aberta a todo mundo (não são
// gates de visualização como o Orçamento) — essas 3 chaves controlam só
// quem pode EDITAR em cada uma. Produtos e Expositores ainda são só
// placeholders na tela, mas o campo já fica pronto no cadastro de usuário
// pra quando ganharem conteúdo de verdade.
const EMPTY_PERMISSIONS = { trafegoPago: 'none', acoesSazonais: 'none', redesSociais: 'none', budget: 'none', brindes: 'none', produtos: 'none', expositores: 'none', campanhaCooperada: 'none' };
const FULL_PERMISSIONS = { trafegoPago: 'admin', acoesSazonais: 'admin', redesSociais: 'admin', budget: 'admin', brindes: 'admin', produtos: 'admin', expositores: 'admin', campanhaCooperada: 'admin' };
// 43ª rodada, pedido da Raquel: nova chave 'campanhaCooperada' — mesmo
// padrão de Brindes/Produtos/Expositores (view aberta a todo mundo, só
// controla quem pode EDITAR).
const PERMISSION_KEYS = ['trafegoPago', 'acoesSazonais', 'redesSociais', 'budget', 'brindes', 'produtos', 'expositores', 'campanhaCooperada'];

// Cargo (função) da pessoa na equipe — usado pro Cronograma de Marketing:
// a aba Calendário fica restrita a todo mundo, exceto quem tem cargo
// 'gerente'. '' (não definido) conta como liberado, pra não travar
// usuários antigos que ainda não tiveram o cargo cadastrado.
const CARGOS = ['gerente', 'analista', 'auxiliar', 'coordenador', 'designer', 'designer3d', 'videomaker'];

// Horário de ponto (47ª rodada, pedido da Raquel: "cada colaborador tem um
// horário diferente de entrada e saida... deixe um campo que apenas o
// admin pode ver, para ajustar os horarios quando necessário"). 4 horários
// por pessoa (entrada da manhã, saída pro almoço, volta do almoço, saída
// final) — usados por utils/pontoReminders.js pra disparar os lembretes
// automáticos em Recados. Campo NÃO exposto por publicUser() (usado em
// /me, /team e no login) — só as rotas /users (já restritas a super
// admin) devolvem esse campo, exatamente como a Raquel pediu ("só o admin
// vê"). Pessoa sem nenhum horário preenchido (`pontoSchedule: null`, ou
// os 4 campos vazios) simplesmente não recebe nenhum lembrete — é assim
// que a Raquel/Melissa, que não batem ponto, ficam de fora, sem precisar
// de nenhuma flag especial.
const PONTO_SLOTS = ['entradaManha', 'saidaAlmoco', 'voltaAlmoco', 'saidaFinal'];
function validTimeHHMM(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : null;
}
function sanitizePontoSchedule(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  let any = false;
  PONTO_SLOTS.forEach((k) => {
    const v = validTimeHHMM(input[k]);
    out[k] = v;
    if (v) any = true;
  });
  return any ? out : null;
}

// Cores customizáveis pedidas pela Raquel na 13ª rodada: a cor da lista de
// cada pessoa no quadro de Demandas (columnColor) e a cor de fundo da
// própria tela Início (homeColor, preferência pessoal — cada um escolhe a
// sua). Mesmo padrão de validação usado em routes/demandas.js pra cor do
// card: hex de 6 dígitos ou null (sem cor / volta ao padrão).
function validColor(color) {
  if (!color || typeof color !== 'string') return null;
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
}

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
    columnColor: u.columnColor || null,
    homeColor: u.homeColor || null,
    // Tema escuro (14ª melhoria, 24/09/2026, pedido da Raquel: "deixe a
    // possibilidade de deixar o tema escuro") -- preferência pessoal,
    // mesmo espírito do homeColor (cada um escolhe o próprio, não afeta
    // quem mais está usando a Papoi). 'light' é o padrão pra quem nunca
    // mexeu (inclusive contas antigas, sem esse campo salvo ainda).
    theme: u.theme === 'dark' ? 'dark' : 'light',
    // Ordem pessoal das colunas do quadro de Demandas (17ª rodada, pedido
    // da Raquel: cada um pode arrastar as listas e deixar do jeito que
    // quiser organizar — é preferência de quem está vendo, não muda o que
    // os outros enxergam, mesma lógica do homeColor).
    columnOrder: Array.isArray(u.columnOrder) ? u.columnOrder : [],
    photoUrl: u.photoUrl || null,
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
  const users = db.get('users').value().map((u) => ({ id: u.id, username: u.username, name: u.name || u.username, cargo: u.cargo || '', columnColor: u.columnColor || null, photoUrl: u.photoUrl || null }));
  res.json({ users, cargos: CARGOS });
});

// Cor da lista de cada pessoa no quadro de Demandas (13ª rodada, pedido da
// Raquel: "quero a opção de trocar a cor das listas tbm, onde tem os
// nomes"). Mesmo padrão de acesso aberto já usado em Demandas — qualquer
// pessoa logada pode ajustar a cor de qualquer lista, não só a própria.
router.put('/team/:id/color', requireAuth, (req, res) => {
  const target = db.get('users').find({ id: req.params.id }).value();
  if (!target) return res.status(404).json({ error: 'Pessoa não encontrada.' });
  const columnColor = validColor((req.body || {}).color);
  db.get('users').find({ id: req.params.id }).assign({ columnColor }).write();
  res.json({ ok: true, columnColor });
});

// Cor de fundo da tela Início — preferência pessoal (só a própria pessoa
// muda a dela, não afeta o que os outros veem).
router.put('/me/home-color', requireAuth, (req, res) => {
  const homeColor = validColor((req.body || {}).color);
  db.get('users').find({ id: req.user.id }).assign({ homeColor }).write();
  res.json({ ok: true, homeColor });
});

// Tema escuro (14ª melhoria) -- mesmo padrão do home-color acima, mas
// pra tela inteira: só 'light'/'dark' são aceitos, qualquer outra coisa
// cai em 'light' (nunca guarda lixo no banco).
router.put('/me/theme', requireAuth, (req, res) => {
  const theme = (req.body || {}).theme === 'dark' ? 'dark' : 'light';
  db.get('users').find({ id: req.user.id }).assign({ theme }).write();
  res.json({ ok: true, theme });
});

// Ordem pessoal das colunas do quadro de Demandas (17ª rodada): a Raquel
// pediu pra cada pessoa poder arrastar as listas e organizar do seu jeito
// (por exemplo, deixar algumas pessoas antes de outras), e isso muda só
// pra quem arrastou — igual o homeColor, não é uma ordem compartilhada.
// Guarda só uma lista de ids de usuário na ordem desejada; ids que não
// estão na lista (gente nova, por exemplo) aparecem depois, na ordem de
// sempre — ver kanbanColumns() no app.js.
router.put('/me/column-order', requireAuth, (req, res) => {
  const order = (req.body || {}).order;
  if (!Array.isArray(order) || !order.every((id) => typeof id === 'string')) {
    return res.status(400).json({ error: 'Ordem inválida.' });
  }
  db.get('users').find({ id: req.user.id }).assign({ columnOrder: order }).write();
  res.json({ ok: true, columnOrder: order });
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

// Gestão de usuários da plataforma — só super admin. `pontoSchedule` (47ª
// rodada) só é devolvido/aceito por essas rotas (admin) — nunca por /me
// ou /team, que qualquer pessoa logada pode chamar.
function adminUserView(u) {
  return { ...publicUser(u), pontoSchedule: u.pontoSchedule || null };
}
router.get('/users', requireAuth, requireSuperAdmin, (req, res) => {
  res.json({ users: db.get('users').value().map(adminUserView) });
});

router.post('/users', requireAuth, requireSuperAdmin, (req, res) => {
  const { username, password, name, isSuperAdmin, permissions, cargo, pontoSchedule } = req.body || {};
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
    pontoSchedule: sanitizePontoSchedule(pontoSchedule),
    createdAt: new Date().toISOString()
  };
  db.get('users').push(user).write();
  logAudit({ user: req.user, entityType: 'user', entityId: user.id, entityLabel: user.username, action: 'create', details: `Super admin: ${user.isSuperAdmin}` });
  res.json({ user: adminUserView(user) });
});

router.put('/users/:id', requireAuth, requireSuperAdmin, (req, res) => {
  const target = db.get('users').find({ id: req.params.id }).value();
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const { name, username, password, isSuperAdmin, permissions, cargo, pontoSchedule } = req.body || {};
  const updates = {};
  if (name) updates.name = name.trim();
  if (username && username.trim() !== target.username) {
    const novoUsername = username.trim();
    const jaExiste = db.get('users').find({ username: novoUsername }).value();
    if (jaExiste && jaExiste.id !== target.id) {
      return res.status(400).json({ error: 'Já existe um usuário com esse nome.' });
    }
    updates.username = novoUsername;
  }
  if (typeof isSuperAdmin === 'boolean') updates.isSuperAdmin = isSuperAdmin;
  if (cargo !== undefined) updates.cargo = CARGOS.includes(cargo) ? cargo : '';
  if (pontoSchedule !== undefined) updates.pontoSchedule = sanitizePontoSchedule(pontoSchedule);
  updates.permissions = updates.isSuperAdmin || (updates.isSuperAdmin === undefined && target.isSuperAdmin)
    ? FULL_PERMISSIONS
    : sanitizePermissions(permissions || target.permissions);
  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
    updates.passwordHash = bcrypt.hashSync(password, 10);
  }
  db.get('users').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'user', entityId: target.id, entityLabel: target.username, action: 'update', details: 'Permissões/dados atualizados' });
  res.json({ user: adminUserView(db.get('users').find({ id: req.params.id }).value()) });
});

// Foto de perfil — pela tela Usuários, um super admin pode cadastrar/trocar
// a foto de qualquer pessoa. `req.params.id` já é usado como pasta de
// destino pelo multer configurado acima.
router.post('/users/:id/photo', requireAuth, requireSuperAdmin, uploadAvatar.single('photo'), (req, res) => {
  const target = db.get('users').find({ id: req.params.id }).value();
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (!req.file) return res.status(400).json({ error: 'Envie uma imagem.' });
  const photoUrl = `/uploads/avatars/${req.params.id}/${req.file.filename}`;
  db.get('users').find({ id: req.params.id }).assign({ photoUrl }).write();
  logAudit({ user: req.user, entityType: 'user', entityId: target.id, entityLabel: target.username, action: 'update', details: 'Foto de perfil atualizada' });
  res.json({ user: publicUser(db.get('users').find({ id: req.params.id }).value()) });
});

// Cada pessoa também pode cadastrar/trocar a própria foto (sem precisar de
// um super admin), mesmo padrão de autoatendimento já usado em /me/password.
router.post('/me/photo', requireAuth, uploadAvatar.single('photo'), (req, res) => {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado. Faça login novamente.' });
  if (!req.file) return res.status(400).json({ error: 'Envie uma imagem.' });
  const photoUrl = `/uploads/avatars/${req.user.id}/${req.file.filename}`;
  db.get('users').find({ id: req.user.id }).assign({ photoUrl }).write();
  res.json({ user: publicUser(db.get('users').find({ id: req.user.id }).value()) });
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
// Reaproveitado por utils/pontoReminders.js (47ª rodada) — mesma lista de
// horários e mesma regex de validação usada aqui, sem duplicar a fonte.
module.exports.PONTO_SLOTS = PONTO_SLOTS;
