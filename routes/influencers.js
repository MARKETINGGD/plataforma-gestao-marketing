const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { createLinkedSocialPost, syncInfluencerActionToSocialPost, deleteInfluencerTriad } = require('../utils/tripleSync');

const router = express.Router();

// Gerenciamento de Influencers (14ª rodada) — dividido por marca (De Bacco /
// GhelPlus). Cada influencer tem sua própria "tabela" (posts), no formato da
// planilha de referência que a Raquel mandou: Formato de conteúdo, Rede,
// Status, Data da postagem, Arquivo, Observações e um segundo campo de notas.
// Qualquer pessoa logada pode usar — mesmo padrão de acesso aberto já usado
// em Demandas (não tem permissão por usuário aqui).

const BRANDS = ['debacco', 'ghelplus'];
const REDES = ['instagram', 'tiktok', 'youtube', 'facebook', 'pinterest'];
const STATUSES = ['a_publicar', 'publicada', 'cancelada'];
// Tipo de parceria (22ª rodada, pedido da Raquel: "adicione as datas de
// saída de cada entrega, quando a parceria for em permuta, e deixe a
// opção de anexar a nota fiscal do pedido") — 'permuta' é quando o
// influencer recebe produto em troca do post, em vez de pagamento; nesse
// caso faz sentido rastrear quando o produto saiu (envio) e a nota fiscal
// do pedido. Opcional — item sem esse campo preenchido (cadastros
// anteriores a essa rodada) simplesmente não mostra essa parte.
const TIPOS_PARCERIA = ['paga', 'permuta'];

// Chaves do link externo agregado da aba "Todas as ações" (51ª rodada,
// pedido da Raquel: "a planilha geral de influencers e aquela separada por
// marcas, tbm deve ter link externo") -- 'todos' é a planilha geral (todas
// as marcas juntas), 'debacco'/'ghelplus' são a mesma tabela filtrada só
// por marca (o mesmo filtro que a aba já usa por dentro da Plataforma).
const GROUP_KEYS = ['todos', 'debacco', 'ghelplus'];
function groupKeyBrand(key) {
  return (key === 'debacco' || key === 'ghelplus') ? key : null;
}

function validColor() { return null; } // reservado — sem cor por enquanto

// Pessoas envolvidas numa ação (36ª rodada, pedido da Raquel: campo novo,
// não existia antes -- é o que permite gerar a demanda com "as pessoas
// envolvidas" quando a ação é criada). Mesma validação simples já usada em
// Demandas/Agendamento (filtra contra a lista de usuários existentes).
function validUserIds(ids) {
  if (!Array.isArray(ids)) return [];
  const users = db.get('users').value();
  return ids.filter((id) => users.some((u) => u.id === id));
}

// Dados pessoais + contrato (21ª rodada, pedido da Raquel: "na hora de
// cadastrar a influencer, temos que colocar os dados dela, dados pessoais,
// contrato (em arquivo)"). Tudo opcional — influencers já cadastrados antes
// dessa rodada simplesmente não têm esses campos preenchidos ainda (nunca
// apagar o que já existe, só passa a dar espaço pra completar).
function personalFields(body) {
  const out = {};
  ['cpf', 'rg', 'telefone', 'email', 'dataNascimento', 'endereco'].forEach((key) => {
    if (body[key] !== undefined) out[key] = (body[key] || '').toString().trim();
  });
  return out;
}

function serializeInfluencer(inf) {
  return {
    id: inf.id,
    brand: inf.brand,
    name: inf.name,
    cpf: inf.cpf || '',
    rg: inf.rg || '',
    telefone: inf.telefone || '',
    email: inf.email || '',
    dataNascimento: inf.dataNascimento || '',
    endereco: inf.endereco || '',
    contrato: inf.contrato || null,
    createdAt: inf.createdAt,
    hasPublicLink: !!inf.publicToken
  };
}

function findInfluencerOr404(req, res) {
  const inf = db.get('influencers').find({ id: req.params.id }).value();
  if (!inf) {
    res.status(404).json({ error: 'Influencer não encontrado.' });
    return null;
  }
  return inf;
}

router.get('/meta', requireAuth, (req, res) => {
  res.json({ brands: BRANDS, redes: REDES, statuses: STATUSES });
});

// Versão do influencer pro link externo (sem login) — só nome e marca, sem
// dados pessoais nem contrato (21ª rodada). Esse link é pensado pra
// compartilhar a tabela de postagens com quem não está na Plataforma; os
// dados pessoais/contrato adicionados nessa rodada são sensíveis e não
// devem vazar por um link que qualquer um com a URL consegue abrir.
function serializeInfluencerPublic(inf) {
  return {
    id: inf.id,
    brand: inf.brand,
    name: inf.name,
    createdAt: inf.createdAt
  };
}

// Versão de cada item da tabela pro link público — sem os campos de
// parceria/nota fiscal adicionados na 22ª rodada, que são informação
// financeira/interna (tipo de parceria, data de saída do produto, nota
// fiscal) e não devem vazar por um link que qualquer um com a URL abre,
// mesmo cuidado já tomado com os dados pessoais/contrato na 21ª rodada.
function serializePostPublic(p) {
  return {
    id: p.id,
    formato: p.formato,
    rede: p.rede,
    status: p.status,
    dataPostagem: p.dataPostagem,
    arquivo: p.arquivo || null,
    observacoes: p.observacoes,
    notas: p.notas
  };
}

// Link externo por influencer — página pública, sem login, acessada com o
// token no lugar do id (ninguém de fora da plataforma sabe o id interno).
// Fica ANTES de tudo que exige login, pra não passar pela tela de login.
router.get('/public/:token', (req, res) => {
  const inf = db.get('influencers').find({ publicToken: req.params.token }).value();
  if (!inf) return res.status(404).json({ error: 'Link inválido ou desativado.' });
  const posts = db.get('influencerPosts').filter({ influencerId: inf.id }).value();
  res.json({ influencer: serializeInfluencerPublic(inf), posts: posts.map(serializePostPublic) });
});

// Versão de cada item pro link externo da tabela AGREGADA (51ª rodada) —
// mesma sanitização de serializePostPublic (sem dados de parceria/nota
// fiscal/envolvidos, que são internos), com influencerName/brand
// adicionados, igual ao que a própria aba "Todas as ações" já mostra pra
// quem está logado.
function serializePostPublicGroup(p, byId) {
  const base = serializePostPublic(p);
  return Object.assign({}, base, {
    influencerName: byId[p.influencerId].name,
    brand: byId[p.influencerId].brand
  });
}

// Link externo agregado (51ª rodada) — mesma ideia do link por influencer
// acima, só que reúne os itens de vários influencers (toda a "planilha
// geral", ou só a de uma marca), igual ao que GET /all/posts monta pra
// quem está logado. Path com dois segmentos depois de /public/ (não colide
// com a rota /public/:token acima, que só casa com UM segmento).
router.get('/public/group/:token', (req, res) => {
  const link = db.get('influencerGroupLinks').find({ token: req.params.token }).value();
  if (!link) return res.status(404).json({ error: 'Link inválido ou desativado.' });
  const brand = groupKeyBrand(link.key);
  let influencers = db.get('influencers').value();
  if (brand) influencers = influencers.filter((i) => i.brand === brand);
  const byId = {};
  influencers.forEach((i) => { byId[i.id] = i; });
  const posts = db.get('influencerPosts').value()
    .filter((p) => byId[p.influencerId])
    .map((p) => serializePostPublicGroup(p, byId))
    .sort((a, b) => {
      if (!a.dataPostagem && !b.dataPostagem) return (a.createdAt || '').localeCompare(b.createdAt || '');
      if (!a.dataPostagem) return 1;
      if (!b.dataPostagem) return -1;
      return a.dataPostagem.localeCompare(b.dataPostagem);
    });
  res.json({ key: link.key, posts });
});

// Lista influencers de uma marca
router.get('/', requireAuth, (req, res) => {
  const brand = BRANDS.includes(req.query.brand) ? req.query.brand : null;
  let list = db.get('influencers').value();
  if (brand) list = list.filter((i) => i.brand === brand);
  res.json({ influencers: list.map(serializeInfluencer) });
});

router.post('/', requireAuth, (req, res) => {
  const { brand, name } = req.body || {};
  if (!BRANDS.includes(brand)) return res.status(400).json({ error: 'Marca inválida.' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Informe o nome do influencer.' });
  const inf = Object.assign({
    id: nanoid(),
    brand,
    name: name.trim(),
    publicToken: null,
    contrato: null,
    createdAt: new Date().toISOString(),
    createdBy: req.user.id
  }, personalFields(req.body || {}));
  db.get('influencers').push(inf).write();
  logAudit({ user: req.user, entityType: 'influencer', entityId: inf.id, entityLabel: inf.name, action: 'create' });
  res.json({ influencer: serializeInfluencer(inf) });
});

router.put('/:id', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  const { name } = req.body || {};
  const updates = Object.assign({}, personalFields(req.body || {}));
  if (name && name.trim()) updates.name = name.trim();
  db.get('influencers').find({ id: inf.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'influencer', entityId: inf.id, entityLabel: updates.name || inf.name, action: 'update' });
  res.json({ influencer: serializeInfluencer(db.get('influencers').find({ id: inf.id }).value()) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  db.get('influencerPosts').remove({ influencerId: inf.id }).write();
  db.get('influencers').remove({ id: inf.id }).write();
  const dir = path.join(__dirname, '..', 'data', 'uploads', 'influencers', inf.id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  logAudit({ user: req.user, entityType: 'influencer', entityId: inf.id, entityLabel: inf.name, action: 'delete' });
  res.json({ ok: true });
});

// ---------- link externo (por influencer) ----------
router.get('/:id/public-link', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  res.json({ publicToken: inf.publicToken || null });
});

router.post('/:id/public-link/generate', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  const token = crypto.randomBytes(20).toString('hex');
  db.get('influencers').find({ id: inf.id }).assign({ publicToken: token }).write();
  logAudit({ user: req.user, entityType: 'influencer', entityId: inf.id, entityLabel: inf.name, action: 'generate_public_link' });
  res.json({ publicToken: token });
});

router.delete('/:id/public-link', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  db.get('influencers').find({ id: inf.id }).assign({ publicToken: null }).write();
  logAudit({ user: req.user, entityType: 'influencer', entityId: inf.id, entityLabel: inf.name, action: 'revoke_public_link' });
  res.json({ ok: true });
});

// ---------- link externo agregado ("Todas as ações", 51ª rodada) ----------
// Mesmo padrão CRUD do link por influencer acima, só que por "chave"
// (todos/debacco/ghelplus) em vez de por id de influencer -- upsert em vez
// de sempre um registro (o registro só existe depois do primeiro "Gerar").
router.get('/group-links', requireAuth, (req, res) => {
  const links = db.get('influencerGroupLinks').value();
  const out = {};
  GROUP_KEYS.forEach((key) => {
    const l = links.find((x) => x.key === key);
    out[key] = l ? l.token : null;
  });
  res.json({ links: out });
});

router.post('/group-links/:key/generate', requireAuth, (req, res) => {
  const key = req.params.key;
  if (!GROUP_KEYS.includes(key)) return res.status(400).json({ error: 'Chave inválida.' });
  const token = crypto.randomBytes(20).toString('hex');
  if (db.get('influencerGroupLinks').find({ key }).value()) {
    db.get('influencerGroupLinks').find({ key }).assign({ token }).write();
  } else {
    db.get('influencerGroupLinks').push({ key, token }).write();
  }
  logAudit({ user: req.user, entityType: 'influencerGroupLink', entityId: key, entityLabel: key, action: 'generate_public_link' });
  res.json({ token });
});

router.delete('/group-links/:key', requireAuth, (req, res) => {
  const key = req.params.key;
  if (!GROUP_KEYS.includes(key)) return res.status(400).json({ error: 'Chave inválida.' });
  db.get('influencerGroupLinks').remove({ key }).write();
  logAudit({ user: req.user, entityType: 'influencerGroupLink', entityId: key, entityLabel: key, action: 'revoke_public_link' });
  res.json({ ok: true });
});

// ---------- "Todas as ações" (30ª rodada, pedido da Raquel) ----------
// Aba agregada dentro de Influencers: reúne os itens de TODAS as tabelas
// (de todos os influencers, de todas as marcas) numa lista só, ordenada
// pela data de entrega (dataPostagem) -- pra acompanhar cada ação separada
// sem abrir influencer por influencer, e também dá pra ver tudo junto.
// Sempre lê os dados direto do banco na hora da chamada (não guarda cópia
// em lugar nenhum), então qualquer item novo adicionado na planilha
// pessoal de um influencer já aparece aqui automaticamente, sem precisar
// de nenhuma sincronização manual. `?brand=` filtra por marca, igual à
// listagem normal de influencers -- o front usa isso pra "dividir por
// marca" dentro da própria aba.
// Fica ANTES de "GET /:id" de propósito: como é uma rota fixa de dois
// segmentos (sem parâmetro no primeiro), não colide com ela, mas é mais
// claro deixar perto do topo do bloco de rotas de tabela.
router.get('/all/posts', requireAuth, (req, res) => {
  const brand = BRANDS.includes(req.query.brand) ? req.query.brand : null;
  let influencers = db.get('influencers').value();
  if (brand) influencers = influencers.filter((i) => i.brand === brand);
  const byId = {};
  influencers.forEach((i) => { byId[i.id] = i; });
  const posts = db.get('influencerPosts').value()
    .filter((p) => byId[p.influencerId])
    .map((p) => Object.assign({}, p, {
      influencerName: byId[p.influencerId].name,
      brand: byId[p.influencerId].brand
    }))
    .sort((a, b) => {
      // Item sem data vai pro fim da lista -- não dá pra "acompanhar pela
      // data de entrega" algo que ainda não tem data definida.
      if (!a.dataPostagem && !b.dataPostagem) return (a.createdAt || '').localeCompare(b.createdAt || '');
      if (!a.dataPostagem) return 1;
      if (!b.dataPostagem) return -1;
      return a.dataPostagem.localeCompare(b.dataPostagem);
    });
  res.json({ posts });
});

// ---------- tabela (posts) do influencer ----------
router.get('/:id', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  const posts = db.get('influencerPosts').filter({ influencerId: inf.id }).value();
  res.json({ influencer: serializeInfluencer(inf), posts });
});

router.post('/:id/posts', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  const { formato, rede, status, dataPostagem, observacoes, notas, tipoParceria, dataSaida, involvedUserIds, responsibleId } = req.body || {};
  const finalInvolvedIds = validUserIds(involvedUserIds);
  const post = {
    id: nanoid(),
    influencerId: inf.id,
    formato: (formato || '').trim(),
    rede: REDES.includes(rede) ? rede : null,
    status: STATUSES.includes(status) ? status : 'a_publicar',
    dataPostagem: dataPostagem || null,
    arquivo: null,
    observacoes: (observacoes || '').trim(),
    notas: (notas || '').trim(),
    // Parceria em permuta (22ª rodada) — ver comentário de TIPOS_PARCERIA.
    tipoParceria: TIPOS_PARCERIA.includes(tipoParceria) ? tipoParceria : null,
    dataSaida: dataSaida || null,
    notaFiscal: null,
    // Pessoas envolvidas + agendamento ligado (36ª rodada, ver
    // utils/tripleSync.js) — toda ação nova já nasce com um agendamento em
    // Redes Sociais e, pra cada pessoa marcada aqui, uma demanda no quadro.
    involvedUserIds: finalInvolvedIds,
    // Responsável geral (51ª rodada, pedido da Raquel: mesma marcação já
    // usada em Demandas) — precisa ser uma das pessoas envolvidas marcadas
    // acima, senão não é gravado.
    responsibleId: finalInvolvedIds.includes(responsibleId) ? responsibleId : null,
    linkedSocialPostId: null,
    createdAt: new Date().toISOString()
  };
  db.get('influencerPosts').push(post).write();
  const linkedPost = createLinkedSocialPost(inf, post, req);
  db.get('influencerPosts').find({ id: post.id }).assign({ linkedSocialPostId: linkedPost.id }).write();
  logAudit({ user: req.user, entityType: 'influencerPost', entityId: post.id, entityLabel: `${inf.name} · ${post.formato}`, action: 'create' });
  res.json({ post: db.get('influencerPosts').find({ id: post.id }).value() });
});

router.put('/:id/posts/:postId', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  const post = db.get('influencerPosts').find({ id: req.params.postId, influencerId: inf.id }).value();
  if (!post) return res.status(404).json({ error: 'Item não encontrado.' });
  const { formato, rede, status, dataPostagem, observacoes, notas, tipoParceria, dataSaida, involvedUserIds, responsibleId } = req.body || {};
  const updates = {};
  if (formato !== undefined) updates.formato = (formato || '').trim();
  if (rede !== undefined) updates.rede = REDES.includes(rede) ? rede : null;
  if (status !== undefined) updates.status = STATUSES.includes(status) ? status : post.status;
  if (dataPostagem !== undefined) updates.dataPostagem = dataPostagem || null;
  if (observacoes !== undefined) updates.observacoes = (observacoes || '').trim();
  if (notas !== undefined) updates.notas = (notas || '').trim();
  if (tipoParceria !== undefined) updates.tipoParceria = TIPOS_PARCERIA.includes(tipoParceria) ? tipoParceria : null;
  if (dataSaida !== undefined) updates.dataSaida = dataSaida || null;
  if (involvedUserIds !== undefined) updates.involvedUserIds = validUserIds(involvedUserIds);
  // Responsável geral (51ª rodada) — mesma validação/queda automática já
  // usada em Demandas (routes/demandas.js): precisa estar entre os
  // envolvidos que vão valer DEPOIS dessa atualização; se o responsável
  // atual sair da lista de envolvidos nessa mesma edição, a marcação cai
  // junto.
  if (responsibleId !== undefined) {
    const effectiveInvolvedIds = updates.involvedUserIds !== undefined ? updates.involvedUserIds : (post.involvedUserIds || []);
    updates.responsibleId = effectiveInvolvedIds.includes(responsibleId) ? responsibleId : null;
  } else if (updates.involvedUserIds !== undefined && post.responsibleId && !updates.involvedUserIds.includes(post.responsibleId)) {
    updates.responsibleId = null;
  }
  db.get('influencerPosts').find({ id: post.id }).assign(updates).write();
  // 36ª rodada: propaga a edição pro agendamento ligado a essa ação (rede,
  // data, status, envolvidos etc.) — ver utils/tripleSync.js.
  syncInfluencerActionToSocialPost(post, updates, req);
  logAudit({ user: req.user, entityType: 'influencerPost', entityId: post.id, entityLabel: `${inf.name} · ${updates.formato || post.formato}`, action: 'update' });
  res.json({ post: db.get('influencerPosts').find({ id: post.id }).value() });
});

router.delete('/:id/posts/:postId', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  const post = db.get('influencerPosts').find({ id: req.params.postId, influencerId: inf.id }).value();
  if (!post) return res.status(404).json({ error: 'Item não encontrado.' });
  // 36ª rodada: excluir a ação já apaga junto o agendamento e TODAS as
  // demandas ligadas a ela (inclusive os arquivos de arquivo/nota fiscal
  // da própria ação) — ver utils/tripleSync.js. Antes disso, registrava
  // um 'delete' comum; agora quem registra é o deleteInfluencerTriad,
  // então não duplica a linha de auditoria aqui.
  deleteInfluencerTriad({ influencerPostId: post.id }, req);
  res.json({ ok: true });
});

// ---------- upload do arquivo (por item da tabela) ----------
const uploadsRoot = path.join(__dirname, '..', 'data', 'uploads', 'influencers');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsRoot, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, Date.now() + '-' + safe);
  }
});
const upload = multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB, mesmo limite de Demandas

router.post('/:id/posts/:postId/file', requireAuth, upload.single('file'), (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  const post = db.get('influencerPosts').find({ id: req.params.postId, influencerId: inf.id }).value();
  if (!post) return res.status(404).json({ error: 'Item não encontrado.' });
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  const arquivo = {
    url: `/uploads/influencers/${inf.id}/${req.file.filename}`,
    name: req.file.originalname,
    uploadedAt: new Date().toISOString()
  };
  db.get('influencerPosts').find({ id: post.id }).assign({ arquivo }).write();
  logAudit({ user: req.user, entityType: 'influencerPost', entityId: post.id, entityLabel: `${inf.name} · arquivo`, action: 'update', details: `Arquivo enviado: ${arquivo.name}` });
  res.json({ post: db.get('influencerPosts').find({ id: post.id }).value() });
});

// ---------- nota fiscal do pedido (22ª rodada, parceria em permuta) ----------
// Pasta separada (uploadsRoot/<id>/nota-fiscal/), mesmo padrão já usado
// pro contrato do influencer (21ª rodada) — não se mistura com o arquivo
// do item nem com o contrato.
const notaFiscalStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsRoot, req.params.id, 'nota-fiscal');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, Date.now() + '-' + safe);
  }
});
const uploadNotaFiscal = multer({ storage: notaFiscalStorage, limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB, de sobra pra PDF/imagem de nota fiscal

router.post('/:id/posts/:postId/nota-fiscal', requireAuth, uploadNotaFiscal.single('notaFiscal'), (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  const post = db.get('influencerPosts').find({ id: req.params.postId, influencerId: inf.id }).value();
  if (!post) return res.status(404).json({ error: 'Item não encontrado.' });
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  const notaFiscal = {
    url: `/uploads/influencers/${inf.id}/nota-fiscal/${req.file.filename}`,
    name: req.file.originalname,
    uploadedAt: new Date().toISOString()
  };
  db.get('influencerPosts').find({ id: post.id }).assign({ notaFiscal }).write();
  logAudit({ user: req.user, entityType: 'influencerPost', entityId: post.id, entityLabel: `${inf.name} · nota fiscal`, action: 'update', details: `Nota fiscal enviada: ${notaFiscal.name}` });
  res.json({ post: db.get('influencerPosts').find({ id: post.id }).value() });
});

// ---------- contrato do influencer (21ª rodada) ----------
// Pasta separada (uploadsRoot/<id>/contrato/) pra não se misturar com os
// arquivos dos itens da tabela, que ficam direto em uploadsRoot/<id>/.
const contractStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsRoot, req.params.id, 'contrato');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, Date.now() + '-' + safe);
  }
});
// 25MB é de sobra pra um contrato em PDF/imagem escaneada — bem menor que
// o limite de 1GB dos arquivos de post (pensado pra vídeo/criativo).
const uploadContract = multer({ storage: contractStorage, limits: { fileSize: 25 * 1024 * 1024 } });

router.post('/:id/contract', requireAuth, uploadContract.single('contract'), (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
  const contrato = {
    url: `/uploads/influencers/${inf.id}/contrato/${req.file.filename}`,
    name: req.file.originalname,
    uploadedAt: new Date().toISOString(),
    uploadedBy: req.user.id
  };
  db.get('influencers').find({ id: inf.id }).assign({ contrato }).write();
  logAudit({ user: req.user, entityType: 'influencer', entityId: inf.id, entityLabel: inf.name, action: 'update', details: `Contrato enviado: ${contrato.name}` });
  res.json({ influencer: serializeInfluencer(db.get('influencers').find({ id: inf.id }).value()) });
});

router.delete('/:id/contract', requireAuth, (req, res) => {
  const inf = findInfluencerOr404(req, res);
  if (!inf) return;
  if (inf.contrato && inf.contrato.url) {
    const filePath = path.join(uploadsRoot, inf.id, 'contrato', path.basename(inf.contrato.url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  db.get('influencers').find({ id: inf.id }).assign({ contrato: null }).write();
  logAudit({ user: req.user, entityType: 'influencer', entityId: inf.id, entityLabel: inf.name, action: 'update', details: 'Contrato removido' });
  res.json({ influencer: serializeInfluencer(db.get('influencers').find({ id: inf.id }).value()) });
});

module.exports = router;
