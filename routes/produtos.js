const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const shareLinks = require('../utils/shareLinks');
const { makeCatalogFileRouter } = require('../utils/catalogFileStore');

const router = express.Router();

// Produtos (33ª rodada, pedido da Raquel: "no botão produtos deve ter um sub
// menu com: análise de concorrência, lançamentos de produtos"). Duas listas
// independentes, cada uma dividida por marca (De Bacco / GhelPlus), mesmo
// padrão de acesso já usado em Brindes/Expositores: qualquer pessoa logada
// pode VER, só quem tem permissão "produtos" = editor/admin (ou é admin da
// plataforma) pode criar/editar/excluir — permissão configurada na tela de
// Usuários (a chave 'produtos' já existia em PERMISSION_KEYS antes desta
// rodada, só não tinha nenhuma tela usando ela ainda).
//
// 39ª rodada, pedido da Raquel: as duas telas ganharam campos novos.
//
// Análise de Concorrência agora compara lado a lado o produto do
// concorrente COM o produto equivalente da nossa marca: além dos campos
// que já existiam do lado do concorrente (concorrente, produto, preço,
// observações, link), ganhou "diferenciais"; e ganhou um segundo grupo de
// campos inteiro, espelhado, pro nosso produto equivalente (produto,
// preço, diferenciais, observações, link) — prefixo `nosso*`/`nossa*` pra
// diferenciar dos campos do concorrente sem precisar de objeto aninhado.
//
// 42ª rodada, pedido da Raquel: "deve ter tbm a opção de colocar varias
// marcas na analise, e não apenas 1 versus a outra" — o lado do
// concorrente virou uma LISTA (`concorrentes[]`, 1 ou mais), cada um com
// os mesmos campos de antes (nome, produto, preço, diferenciais,
// observações, link). Os campos soltos antigos (concorrente/produto/
// preco/diferenciais/observacoes/link) continuam sendo gravados também,
// sempre espelhando o 1º concorrente da lista, só por compatibilidade com
// qualquer coisa antiga que ainda leia esses campos direto — ver
// utils/migrateConcorrenciaMultiMarca.js pra quem já existia antes disso.
//
// Lançamentos de Produtos ganhou "produto" (categoria/tipo, junto do nome
// específico que já existia), "código", "diferenciais" e "arquivos"
// (upload, mesmo padrão de Demandas: um arquivo por vez, guardado em
// `data/uploads/lancamentos/:id/`). O status trocou de
// planejado/em_andamento/lançado pra um fluxo mais realista de lançamento
// de produto físico: certificação → compra → fiscal → liberado (pedido
// explícito da Raquel). Lançamento cadastrado ANTES desta rodada, com um
// status do conjunto antigo, mantém esse valor salvo (não é migrado
// automaticamente) — só não vai bater com nenhuma das 4 opções novas do
// formulário até alguém abrir e salvar de novo escolhendo um status atual.

const BRANDS = ['debacco', 'ghelplus'];
const BRAND_LABEL_PT = { debacco: 'De Bacco', ghelplus: 'GhelPlus' };
// 78ª rodada, pedido explícito da Raquel: "adicione também o status -
// Lançado. E adicione depois de certificação - Engenharia" -- fluxo passa
// de 4 pra 6 etapas: Certificação → Engenharia → Compra → Fiscal →
// Liberado → Lançado (a etapa final, de verdade, separada de "Liberado").
const LANCAMENTO_STATUSES = ['certificacao', 'engenharia', 'compra', 'fiscal', 'liberado', 'lancado'];
// Chaves válidas do link externo AGREGADO de Concorrência (68ª rodada,
// pedido da Raquel: "compartilhar... ou todas as análises") -- mesmo
// padrão "todos/debacco/ghelplus" já usado em Feiras/Influencers.
const CONCORRENCIA_SHARE_KEYS = ['todos', 'debacco', 'ghelplus'];

function canEdit(req) {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  const access = (user.permissions || {}).produtos || 'none';
  return access === 'editor' || access === 'admin';
}
function requireProdutosEdit(req, res, next) {
  if (!canEdit(req)) return res.status(403).json({ error: 'Você não tem permissão para editar Produtos.' });
  next();
}
function validBrand(b) {
  return BRANDS.includes(b) ? b : BRANDS[0];
}
function str(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}
function priceOrNull(v) {
  return v === null || v === undefined || v === '' ? null : Number(v);
}
// 42ª rodada: normaliza a lista de concorrentes de uma análise — aceita
// qualquer array vindo do front, sanitiza cada linha com os mesmos
// helpers de sempre (str/priceOrNull) e descarta linha sem nome de
// concorrente (linha "em branco" que sobrou no formulário, por ex.).
function sanitizeConcorrentes(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((c) => ({
      id: (c && str(c.id)) || nanoid(),
      nome: str(c && c.nome),
      produto: str(c && c.produto),
      preco: priceOrNull(c && c.preco),
      diferenciais: str(c && c.diferenciais),
      observacoes: str(c && c.observacoes),
      // 78ª rodada, pedido explícito da Raquel: "link de pagina de venda,
      // deve ter em todas as marcas concorrentes, menos na nossa. Link de
      // referencia, deve ter em todas as marcas, inclusive na nossa" --
      // antes só existia 1 campo `link` genérico por concorrente. Agora
      // são 2 campos -- `link` continua gravado, igual à `linkReferencia`,
      // só por compatibilidade com quem ainda lê esse campo direto (ex.:
      // exportação em Excel, análise criada antes desta rodada).
      linkReferencia: str(c && (c.linkReferencia !== undefined ? c.linkReferencia : c.link)) || null,
      linkPaginaVenda: str(c && c.linkPaginaVenda) || null,
      link: str(c && (c.linkReferencia !== undefined ? c.linkReferencia : c.link)) || null
    }))
    .filter((c) => c.nome);
}

// ---------- Análise de concorrência ----------
router.get('/concorrencia', requireAuth, (req, res) => {
  res.json({ items: db.get('concorrencia').value() });
});

// ---------- link externo (68ª rodada, pedido da Raquel: "deve ter a
// opção de compartilhar cada análise em link externo, ou todas as
// análises") -- 2 tipos de link, os dois só LEITURA:
// (a) agregado, 1 por "escopo" (todos/debacco/ghelplus, mesmo padrão de
//     Feiras/Influencers) -- mostra a lista inteira filtrada;
// (b) por análise -- mostra só 1 card. Ficam ANTES de PUT/DELETE
// /concorrencia/:id (mesmo cuidado da 66ª rodada -- rota literal
// registrada depois de "/:id" seria capturada por ela).
router.get('/concorrencia/public-link', requireAuth, requireProdutosEdit, (req, res) => {
  const { scope } = req.query;
  const link = shareLinks.getLink('concorrencia', scope);
  res.json({ publicToken: link ? link.token : null });
});
router.post('/concorrencia/public-link/generate', requireAuth, requireProdutosEdit, (req, res) => {
  const { scope } = req.body || {};
  if (!CONCORRENCIA_SHARE_KEYS.includes(scope)) return res.status(400).json({ error: 'Escolha o escopo do link (todas as marcas, De Bacco ou GhelPlus).' });
  const token = shareLinks.generateLink('concorrencia', scope, req);
  logAudit({ user: req.user, entityType: 'shareLink', entityId: 'concorrencia:' + scope, entityLabel: 'Análise de Concorrência · ' + scope, action: 'generate_public_link' });
  res.json({ publicToken: token });
});
router.delete('/concorrencia/public-link', requireAuth, requireProdutosEdit, (req, res) => {
  const { scope } = req.query;
  shareLinks.revokeLink('concorrencia', scope);
  logAudit({ user: req.user, entityType: 'shareLink', entityId: 'concorrencia:' + scope, entityLabel: 'Análise de Concorrência · ' + scope, action: 'revoke_public_link' });
  res.json({ ok: true });
});
router.get('/concorrencia/public/:token', (req, res) => {
  const link = shareLinks.findByToken(req.params.token);
  if (!link || link.resource !== 'concorrencia') return res.status(404).json({ error: 'Link inválido ou desativado.' });
  const items = db.get('concorrencia').value().filter((it) => link.scopeKey === 'todos' || it.brand === link.scopeKey);
  res.json({ scope: link.scopeKey, items });
});

// Link por análise única -- caminho próprio ("concorrencia-item"), nunca
// colide com "/concorrencia/:id" (tem 1 segmento a mais), então não
// precisa se preocupar com a ordem das rotas pra este par.
router.get('/concorrencia/:id/public-link', requireAuth, requireProdutosEdit, (req, res) => {
  const link = shareLinks.getLink('concorrenciaItem', req.params.id);
  res.json({ publicToken: link ? link.token : null });
});
router.post('/concorrencia/:id/public-link/generate', requireAuth, requireProdutosEdit, (req, res) => {
  const item = db.get('concorrencia').find({ id: req.params.id }).value();
  if (!item) return res.status(404).json({ error: 'Análise não encontrada.' });
  const token = shareLinks.generateLink('concorrenciaItem', req.params.id, req);
  logAudit({ user: req.user, entityType: 'shareLink', entityId: 'concorrenciaItem:' + req.params.id, entityLabel: 'Análise · ' + (item.titulo || item.id), action: 'generate_public_link' });
  res.json({ publicToken: token });
});
router.delete('/concorrencia/:id/public-link', requireAuth, requireProdutosEdit, (req, res) => {
  shareLinks.revokeLink('concorrenciaItem', req.params.id);
  logAudit({ user: req.user, entityType: 'shareLink', entityId: 'concorrenciaItem:' + req.params.id, entityLabel: 'Análise de concorrência', action: 'revoke_public_link' });
  res.json({ ok: true });
});
router.get('/concorrencia-item/public/:token', (req, res) => {
  const link = shareLinks.findByToken(req.params.token);
  if (!link || link.resource !== 'concorrenciaItem') return res.status(404).json({ error: 'Link inválido ou desativado.' });
  const item = db.get('concorrencia').find({ id: link.scopeKey }).value();
  if (!item) return res.status(404).json({ error: 'Essa análise foi excluída.' });
  res.json({ item });
});

router.post('/concorrencia', requireAuth, requireProdutosEdit, (req, res) => {
  const {
    brand, titulo, data, concorrentes,
    // campos soltos (compat com formulário antigo, de antes da 42ª rodada)
    concorrente, produto, preco, diferenciais, link, observacoes,
    nossoProduto, nossoPreco, nossoDiferenciais, nossoLink, nossasObservacoes,
    // 68ª rodada: "página de venda" tinha nascido aqui, no nosso lado.
    // 78ª rodada, pedido explícito da Raquel, reverte isso: "link de
    // pagina de venda... menos na nossa" -- passou a ser um campo só dos
    // CONCORRENTES (ver linkPaginaVenda em sanitizeConcorrentes acima), o
    // nosso lado fica só com "Link de referência" (nossoLink). O campo
    // ainda é aceito aqui por compatibilidade com análise antiga que já
    // tinha isso preenchido, mas a tela não mostra/edita mais esse campo
    // do nosso lado.
    nossoLinkVenda
  } = req.body || {};
  const tituloTrim = str(titulo);
  if (!tituloTrim) return res.status(400).json({ error: 'Informe o título da análise.' });
  if (!data) return res.status(400).json({ error: 'Informe a data da análise.' });
  let concorrentesList = sanitizeConcorrentes(concorrentes);
  if (concorrentesList.length === 0 && str(concorrente)) {
    concorrentesList = sanitizeConcorrentes([{ nome: concorrente, produto, preco, diferenciais, observacoes, link }]);
  }
  if (concorrentesList.length === 0) return res.status(400).json({ error: 'Informe ao menos um concorrente.' });
  const item = {
    id: nanoid(),
    brand: validBrand(brand),
    // ---- identificação da análise (41ª rodada) ----
    titulo: tituloTrim,
    data: data || null,
    // ---- lado do(s) concorrente(s) (42ª rodada: vira lista) ----
    concorrentes: concorrentesList,
    // campos soltos mantidos em sincronia com o 1º concorrente, só por
    // compatibilidade com o que ainda lê esses campos direto.
    concorrente: concorrentesList[0].nome,
    produto: concorrentesList[0].produto,
    preco: concorrentesList[0].preco,
    diferenciais: concorrentesList[0].diferenciais,
    observacoes: concorrentesList[0].observacoes,
    link: concorrentesList[0].link,
    // ---- lado "nossa marca" (39ª rodada) — mesmos campos, espelhados ----
    nossoProduto: str(nossoProduto),
    nossoPreco: priceOrNull(nossoPreco),
    nossoDiferenciais: str(nossoDiferenciais),
    nossasObservacoes: str(nossasObservacoes),
    nossoLink: str(nossoLink) || null,
    nossoLinkVenda: str(nossoLinkVenda) || null,
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    updatedAt: new Date().toISOString()
  };
  db.get('concorrencia').push(item).write();
  logAudit({ user: req.user, entityType: 'concorrencia', entityId: item.id, entityLabel: item.titulo, action: 'create', details: `Análise de concorrência criada: "${item.titulo}" (${concorrentesList.length} concorrente(s))` });
  res.json({ item });
});

router.put('/concorrencia/:id', requireAuth, requireProdutosEdit, (req, res) => {
  const existing = db.get('concorrencia').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Registro não encontrado.' });
  const {
    brand, titulo, data, concorrentes,
    concorrente, produto, preco, diferenciais, link, observacoes,
    nossoProduto, nossoPreco, nossoDiferenciais, nossoLink, nossasObservacoes, nossoLinkVenda
  } = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  if (brand !== undefined) updates.brand = validBrand(brand);
  if (titulo !== undefined) updates.titulo = str(titulo);
  if (data !== undefined) updates.data = data || null;
  if (concorrentes !== undefined) {
    const list = sanitizeConcorrentes(concorrentes);
    if (list.length === 0) return res.status(400).json({ error: 'Informe ao menos um concorrente.' });
    updates.concorrentes = list;
    updates.concorrente = list[0].nome;
    updates.produto = list[0].produto;
    updates.preco = list[0].preco;
    updates.diferenciais = list[0].diferenciais;
    updates.observacoes = list[0].observacoes;
    updates.link = list[0].link;
  } else if (concorrente !== undefined) {
    // compat: PUT antigo mandando só os campos soltos de 1 concorrente
    const list = sanitizeConcorrentes([{ nome: concorrente, produto, preco, diferenciais, observacoes, link }]);
    if (list.length) {
      updates.concorrentes = list;
      updates.concorrente = list[0].nome;
      updates.produto = list[0].produto;
      updates.preco = list[0].preco;
      updates.diferenciais = list[0].diferenciais;
      updates.observacoes = list[0].observacoes;
      updates.link = list[0].link;
    }
  }
  if (nossoProduto !== undefined) updates.nossoProduto = str(nossoProduto);
  if (nossoPreco !== undefined) updates.nossoPreco = priceOrNull(nossoPreco);
  if (nossoDiferenciais !== undefined) updates.nossoDiferenciais = str(nossoDiferenciais);
  if (nossoLink !== undefined) updates.nossoLink = str(nossoLink) || null;
  if (nossoLinkVenda !== undefined) updates.nossoLinkVenda = str(nossoLinkVenda) || null;
  if (nossasObservacoes !== undefined) updates.nossasObservacoes = str(nossasObservacoes);
  db.get('concorrencia').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'concorrencia', entityId: existing.id, entityLabel: updates.titulo || existing.titulo, action: 'update', details: 'Análise de concorrência atualizada' });
  res.json({ item: db.get('concorrencia').find({ id: req.params.id }).value() });
});

router.delete('/concorrencia/:id', requireAuth, requireProdutosEdit, (req, res) => {
  const target = db.get('concorrencia').find({ id: req.params.id }).value();
  db.get('concorrencia').remove({ id: req.params.id }).write();
  if (target) logAudit({ user: req.user, entityType: 'concorrencia', entityId: target.id, entityLabel: target.titulo || target.concorrente, action: 'delete', details: `Análise de concorrência excluída: "${target.titulo || target.concorrente}"` });
  res.json({ ok: true });
});

// ---------- Checklist de Processos do Lançamento (96ª rodada) ----------
// Modelo editável (setor responsável + atividade) -- a Raquel ainda vai
// mandar um fluxograma com os setores de verdade ("ainda n tenho os
// setores"), por enquanto a tela deixa criar/editar/excluir os itens
// livremente, igual o Gerenciar Etiquetas de Demandas. `ordem` é só a
// posição de criação (número crescente), pra manter a lista sempre na
// mesma ordem que foi montada.
function nextChecklistTemplateOrdem() {
  const items = db.get('produtosChecklistTemplate').value();
  return items.length ? Math.max(...items.map((it) => it.ordem || 0)) + 1 : 1;
}

router.get('/checklist-template', requireAuth, (req, res) => {
  const items = db.get('produtosChecklistTemplate').value().slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  res.json({ items });
});

router.post('/checklist-template', requireAuth, requireProdutosEdit, (req, res) => {
  const { setor, atividade } = req.body || {};
  const atividadeTrim = str(atividade);
  if (!atividadeTrim) return res.status(400).json({ error: 'Informe a atividade do checklist.' });
  const item = {
    id: nanoid(),
    setor: str(setor),
    atividade: atividadeTrim,
    ordem: nextChecklistTemplateOrdem(),
    createdAt: new Date().toISOString(),
    createdBy: req.user.id
  };
  db.get('produtosChecklistTemplate').push(item).write();
  logAudit({ user: req.user, entityType: 'produtosChecklistTemplate', entityId: item.id, entityLabel: item.atividade, action: 'create', details: `Item de checklist de processos criado: "${item.atividade}" (setor: ${item.setor || '—'})` });
  res.json({ item });
});

router.put('/checklist-template/:id', requireAuth, requireProdutosEdit, (req, res) => {
  const existing = db.get('produtosChecklistTemplate').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Item do checklist não encontrado.' });
  const { setor, atividade } = req.body || {};
  const updates = {};
  if (setor !== undefined) updates.setor = str(setor);
  if (atividade !== undefined) updates.atividade = str(atividade);
  db.get('produtosChecklistTemplate').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'produtosChecklistTemplate', entityId: existing.id, entityLabel: updates.atividade || existing.atividade, action: 'update', details: 'Item de checklist de processos atualizado' });
  res.json({ item: db.get('produtosChecklistTemplate').find({ id: req.params.id }).value() });
});

router.delete('/checklist-template/:id', requireAuth, requireProdutosEdit, (req, res) => {
  const existing = db.get('produtosChecklistTemplate').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Item do checklist não encontrado.' });
  db.get('produtosChecklistTemplate').remove({ id: req.params.id }).write();
  // Importante: excluir um item do MODELO não mexe nos lançamentos que já
  // tinham ele copiado no próprio checklist (`syncChecklist` abaixo nunca
  // remove item nenhum, só adiciona os novos) -- o histórico de quem já
  // conferiu aquela etapa num produto já lançado nunca se perde.
  logAudit({ user: req.user, entityType: 'produtosChecklistTemplate', entityId: existing.id, entityLabel: existing.atividade, action: 'delete', details: `Item de checklist de processos excluído: "${existing.atividade}"` });
  res.json({ ok: true });
});

// Garante que um lançamento tenha, no próprio checklist, todos os itens
// que existem HOJE no modelo -- sem nunca mexer num item que já estava lá
// (preserva `concluido`/`concluidoBy`/`concluidoAt` de quem já conferiu).
// Chamado na leitura (mesmo padrão "on read" já usado em Brindes acima);
// só grava de volta no banco se alguma coisa realmente mudou.
function syncChecklist(item) {
  const template = db.get('produtosChecklistTemplate').value();
  const existing = Array.isArray(item.checklist) ? item.checklist : [];
  const existingIds = new Set(existing.map((c) => c.templateItemId));
  const missing = template
    .filter((t) => !existingIds.has(t.id))
    .map((t) => ({ templateItemId: t.id, setor: t.setor, atividade: t.atividade, concluido: false, concluidoBy: null, concluidoByName: '', concluidoAt: null }));
  if (missing.length === 0) return item;
  const checklist = existing.concat(missing);
  db.get('lancamentosProdutos').find({ id: item.id }).assign({ checklist }).write();
  return Object.assign({}, item, { checklist });
}

// ---------- Lançamentos de produtos ----------
router.get('/lancamentos', requireAuth, (req, res) => {
  const items = db.get('lancamentosProdutos').value().map(syncChecklist);
  res.json({ items });
});

router.post('/lancamentos', requireAuth, requireProdutosEdit, (req, res) => {
  const { brand, produto, nome, codigo, diferenciais, dataLancamento, status, descricao } = req.body || {};
  const nomeTrim = str(nome);
  if (!nomeTrim) return res.status(400).json({ error: 'Informe o nome do produto.' });
  // Todo lançamento novo já nasce com o checklist de processos atual
  // (modelo inteiro, tudo desmarcado) -- "cada produto lançado deve ter
  // esse check list conferido".
  const checklist = db.get('produtosChecklistTemplate').value().map((t) => ({
    templateItemId: t.id, setor: t.setor, atividade: t.atividade,
    concluido: false, concluidoBy: null, concluidoByName: '', concluidoAt: null
  }));
  const item = {
    id: nanoid(),
    brand: validBrand(brand),
    produto: str(produto),
    nome: nomeTrim,
    codigo: str(codigo),
    diferenciais: str(diferenciais),
    dataLancamento: dataLancamento || null,
    status: LANCAMENTO_STATUSES.includes(status) ? status : LANCAMENTO_STATUSES[0],
    descricao: str(descricao),
    arquivos: [],
    checklist,
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    updatedAt: new Date().toISOString()
  };
  db.get('lancamentosProdutos').push(item).write();
  logAudit({ user: req.user, entityType: 'lancamentoProduto', entityId: item.id, entityLabel: item.nome, action: 'create', details: `Lançamento de produto criado: "${item.nome}"` });
  res.json({ item });
});

// Marca/desmarca 1 item do checklist DE UM lançamento específico --
// carimba quem conferiu e quando (só quando está marcando; desmarcar
// limpa o carimbo, já que deixou de estar conferido por aquela pessoa).
router.put('/lancamentos/:id/checklist/:itemId', requireAuth, requireProdutosEdit, (req, res) => {
  const existingRaw = db.get('lancamentosProdutos').find({ id: req.params.id }).value();
  if (!existingRaw) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  const existing = syncChecklist(existingRaw);
  const alvo = (existing.checklist || []).find((c) => c.templateItemId === req.params.itemId);
  if (!alvo) return res.status(404).json({ error: 'Item do checklist não encontrado neste lançamento.' });
  const concluido = !!(req.body || {}).concluido;
  const checklist = existing.checklist.map((c) => {
    if (c.templateItemId !== req.params.itemId) return c;
    return concluido
      ? Object.assign({}, c, { concluido: true, concluidoBy: req.user.id, concluidoByName: req.user.name, concluidoAt: new Date().toISOString() })
      : Object.assign({}, c, { concluido: false, concluidoBy: null, concluidoByName: '', concluidoAt: null });
  });
  db.get('lancamentosProdutos').find({ id: req.params.id }).assign({ checklist }).write();
  logAudit({ user: req.user, entityType: 'lancamentoProduto', entityId: existing.id, entityLabel: existing.nome, action: 'update', details: `Checklist "${alvo.atividade}" ${concluido ? 'marcado como conferido' : 'desmarcado'}` });
  res.json({ item: db.get('lancamentosProdutos').find({ id: req.params.id }).value() });
});

router.put('/lancamentos/:id', requireAuth, requireProdutosEdit, (req, res) => {
  const existing = db.get('lancamentosProdutos').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  const { brand, produto, nome, codigo, diferenciais, dataLancamento, status, descricao } = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  if (brand !== undefined) updates.brand = validBrand(brand);
  if (produto !== undefined) updates.produto = str(produto);
  if (nome !== undefined) updates.nome = str(nome);
  if (codigo !== undefined) updates.codigo = str(codigo);
  if (diferenciais !== undefined) updates.diferenciais = str(diferenciais);
  if (dataLancamento !== undefined) updates.dataLancamento = dataLancamento || null;
  if (status !== undefined) updates.status = LANCAMENTO_STATUSES.includes(status) ? status : existing.status;
  if (descricao !== undefined) updates.descricao = str(descricao);
  db.get('lancamentosProdutos').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'lancamentoProduto', entityId: existing.id, entityLabel: updates.nome || existing.nome, action: 'update', details: 'Lançamento de produto atualizado' });
  res.json({ item: db.get('lancamentosProdutos').find({ id: req.params.id }).value() });
});

router.delete('/lancamentos/:id', requireAuth, requireProdutosEdit, (req, res) => {
  const target = db.get('lancamentosProdutos').find({ id: req.params.id }).value();
  db.get('lancamentosProdutos').remove({ id: req.params.id }).write();
  if (target) {
    const dir = path.join(__dirname, '..', 'data', 'uploads', 'lancamentos', req.params.id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    logAudit({ user: req.user, entityType: 'lancamentoProduto', entityId: target.id, entityLabel: target.nome, action: 'delete', details: `Lançamento de produto excluído: "${target.nome}"` });
  }
  res.json({ ok: true });
});

// ---------- Arquivos do lançamento (39ª rodada) ----------
// Mesmo padrão já usado em Demandas: um arquivo por vez, guardado em
// data/uploads/lancamentos/:id/, com metadados (nome, tamanho, quem
// enviou) na própria lista `arquivos` do lançamento.
const lancamentosUploadsRoot = path.join(__dirname, '..', 'data', 'uploads', 'lancamentos');
const lancamentosStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(lancamentosUploadsRoot, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, Date.now() + '-' + safe);
  }
});
const uploadLancamento = multer({ storage: lancamentosStorage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB

router.post('/lancamentos/:id/files', requireAuth, requireProdutosEdit, uploadLancamento.single('file'), (req, res) => {
  const existing = db.get('lancamentosProdutos').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
  const fileMeta = {
    id: nanoid(),
    name: req.file.originalname,
    url: `/uploads/lancamentos/${req.params.id}/${req.file.filename}`,
    size: req.file.size,
    uploadedAt: new Date().toISOString(),
    uploadedBy: req.user.id,
    uploadedByName: req.user.name
  };
  const arquivos = [...(existing.arquivos || []), fileMeta];
  db.get('lancamentosProdutos').find({ id: req.params.id }).assign({ arquivos, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'lancamentoProduto', entityId: existing.id, entityLabel: existing.nome, action: 'file_upload', details: `Arquivo enviado: ${fileMeta.name}` });
  res.json({ item: db.get('lancamentosProdutos').find({ id: req.params.id }).value() });
});

router.delete('/lancamentos/:id/files/:fileId', requireAuth, requireProdutosEdit, (req, res) => {
  const existing = db.get('lancamentosProdutos').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  const target = (existing.arquivos || []).find((f) => f.id === req.params.fileId);
  const arquivos = (existing.arquivos || []).filter((f) => f.id !== req.params.fileId);
  db.get('lancamentosProdutos').find({ id: req.params.id }).assign({ arquivos, updatedAt: new Date().toISOString() }).write();
  if (target) {
    const filePath = path.join(lancamentosUploadsRoot, req.params.id, path.basename(target.url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    logAudit({ user: req.user, entityType: 'lancamentoProduto', entityId: existing.id, entityLabel: existing.nome, action: 'file_delete', details: `Arquivo removido: ${target.name}` });
  }
  res.json({ item: db.get('lancamentosProdutos').find({ id: req.params.id }).value() });
});

// ---------- Catálogo (68ª rodada, pedido da Raquel: "adicione em
// produtos um sub menu com o nome catálogo... deve ser separado por
// marca") -- 1 arquivo atual (upload substitui o anterior) por marca,
// mesmo módulo genérico usado pelo Catálogo de Expositores (ver
// routes/expositores.js) -- são 2 catálogos DIFERENTES, coleções
// separadas de propósito, só a mecânica de upload é compartilhada.
router.use('/catalogo', makeCatalogFileRouter({
  collectionName: 'produtosCatalogoFiles',
  uploadsSubdir: 'produtos-catalogo',
  brands: BRANDS,
  brandLabelPt: BRAND_LABEL_PT,
  permissionKey: 'produtos',
  resourceLabel: 'Catálogo de Produtos'
}));

// ---------- Produtos fora de linha → Comunicados (96ª rodada) ----------
// Item 6 da fila de pedidos da Raquel: novo submenu "Produtos fora de
// linha", começando com a aba "Comunicados" -- cada comunicado tem nome,
// data, descrição e um arquivo anexado (upload novo substitui o anterior,
// mesmo padrão já usado no Catálogo). Lista única (sem separação por
// marca -- não foi pedido aqui).
router.get('/comunicados', requireAuth, (req, res) => {
  const items = db.get('produtosComunicados').value().slice().sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  res.json({ items });
});

router.post('/comunicados', requireAuth, requireProdutosEdit, (req, res) => {
  const b = req.body || {};
  if (!str(b.nome)) return res.status(400).json({ error: 'Preencha o nome do comunicado.' });
  const item = {
    id: nanoid(),
    nome: str(b.nome),
    data: str(b.data),
    descricao: str(b.descricao),
    arquivo: null,
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    createdByName: req.user.name,
    updatedAt: new Date().toISOString()
  };
  db.get('produtosComunicados').push(item).write();
  logAudit({ user: req.user, entityType: 'produtoComunicado', entityId: item.id, entityLabel: item.nome, action: 'create' });
  res.json({ item });
});

router.put('/comunicados/:id', requireAuth, requireProdutosEdit, (req, res) => {
  const existing = db.get('produtosComunicados').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Comunicado não encontrado.' });
  const b = req.body || {};
  if (b.nome !== undefined && !str(b.nome)) return res.status(400).json({ error: 'Preencha o nome do comunicado.' });
  const updates = { updatedAt: new Date().toISOString(), updatedBy: req.user.id, updatedByName: req.user.name };
  ['nome', 'data', 'descricao'].forEach((k) => { if (b[k] !== undefined) updates[k] = str(b[k]); });
  db.get('produtosComunicados').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'produtoComunicado', entityId: existing.id, entityLabel: updates.nome || existing.nome, action: 'update' });
  res.json({ item: db.get('produtosComunicados').find({ id: req.params.id }).value() });
});

router.delete('/comunicados/:id', requireAuth, requireProdutosEdit, (req, res) => {
  const target = db.get('produtosComunicados').find({ id: req.params.id }).value();
  db.get('produtosComunicados').remove({ id: req.params.id }).write();
  if (target) {
    const dir = path.join(__dirname, '..', 'data', 'uploads', 'produtos-comunicados', req.params.id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    logAudit({ user: req.user, entityType: 'produtoComunicado', entityId: target.id, entityLabel: target.nome, action: 'delete' });
  }
  res.json({ ok: true });
});

const comunicadosUploadsRoot = path.join(__dirname, '..', 'data', 'uploads', 'produtos-comunicados');
const comunicadosStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(comunicadosUploadsRoot, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, Date.now() + '-' + safe);
  }
});
const uploadComunicado = multer({ storage: comunicadosStorage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB

router.post('/comunicados/:id/file', requireAuth, requireProdutosEdit, uploadComunicado.single('file'), (req, res) => {
  const existing = db.get('produtosComunicados').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Comunicado não encontrado.' });
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
  // Upload novo substitui o anterior (mesmo padrão do Catálogo) -- apaga
  // o arquivo físico antigo, se existia, antes de gravar o novo.
  if (existing.arquivo && existing.arquivo.url) {
    const oldPath = path.join(comunicadosUploadsRoot, req.params.id, path.basename(existing.arquivo.url));
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  const arquivo = {
    name: req.file.originalname,
    url: `/uploads/produtos-comunicados/${req.params.id}/${req.file.filename}`,
    size: req.file.size,
    uploadedAt: new Date().toISOString(),
    uploadedBy: req.user.id,
    uploadedByName: req.user.name
  };
  db.get('produtosComunicados').find({ id: req.params.id }).assign({ arquivo, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'produtoComunicado', entityId: existing.id, entityLabel: existing.nome, action: 'file_upload', details: `Arquivo enviado: ${arquivo.name}` });
  res.json({ item: db.get('produtosComunicados').find({ id: req.params.id }).value() });
});

router.delete('/comunicados/:id/file', requireAuth, requireProdutosEdit, (req, res) => {
  const existing = db.get('produtosComunicados').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Comunicado não encontrado.' });
  if (existing.arquivo && existing.arquivo.url) {
    const oldPath = path.join(comunicadosUploadsRoot, req.params.id, path.basename(existing.arquivo.url));
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  db.get('produtosComunicados').find({ id: req.params.id }).assign({ arquivo: null, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'produtoComunicado', entityId: existing.id, entityLabel: existing.nome, action: 'file_delete' });
  res.json({ item: db.get('produtosComunicados').find({ id: req.params.id }).value() });
});

// ---------- Catálogo → Revisão Catálogo (96ª rodada) ----------
// Item 7 da fila de pedidos: "planilhas de revisão" com nome da pessoa +
// data + arquivo revisado anexado, com opção de adicionar VÁRIAS pessoas
// por planilha de revisão. Ver comentário extenso em db.js sobre a
// ambiguidade de qual catálogo (entrou dentro de Produtos → Catálogo,
// pendente de confirmação da Raquel).
function sanitizePessoas(pessoas) {
  if (!Array.isArray(pessoas)) return [];
  return pessoas.map((p) => str(p)).filter(Boolean);
}

router.get('/catalogo-revisoes', requireAuth, (req, res) => {
  const items = db.get('produtosCatalogoRevisoes').value().slice().sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  res.json({ items });
});

router.post('/catalogo-revisoes', requireAuth, requireProdutosEdit, (req, res) => {
  const b = req.body || {};
  const pessoas = sanitizePessoas(b.pessoas);
  if (pessoas.length === 0) return res.status(400).json({ error: 'Informe pelo menos 1 pessoa.' });
  const item = {
    id: nanoid(),
    pessoas,
    data: str(b.data),
    arquivo: null,
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    createdByName: req.user.name,
    updatedAt: new Date().toISOString()
  };
  db.get('produtosCatalogoRevisoes').push(item).write();
  logAudit({ user: req.user, entityType: 'catalogoRevisao', entityId: item.id, entityLabel: pessoas.join(', '), action: 'create' });
  res.json({ item });
});

router.put('/catalogo-revisoes/:id', requireAuth, requireProdutosEdit, (req, res) => {
  const existing = db.get('produtosCatalogoRevisoes').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Planilha de revisão não encontrada.' });
  const b = req.body || {};
  const updates = { updatedAt: new Date().toISOString(), updatedBy: req.user.id, updatedByName: req.user.name };
  if (b.pessoas !== undefined) {
    const pessoas = sanitizePessoas(b.pessoas);
    if (pessoas.length === 0) return res.status(400).json({ error: 'Informe pelo menos 1 pessoa.' });
    updates.pessoas = pessoas;
  }
  if (b.data !== undefined) updates.data = str(b.data);
  db.get('produtosCatalogoRevisoes').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'catalogoRevisao', entityId: existing.id, entityLabel: (updates.pessoas || existing.pessoas).join(', '), action: 'update' });
  res.json({ item: db.get('produtosCatalogoRevisoes').find({ id: req.params.id }).value() });
});

router.delete('/catalogo-revisoes/:id', requireAuth, requireProdutosEdit, (req, res) => {
  const target = db.get('produtosCatalogoRevisoes').find({ id: req.params.id }).value();
  db.get('produtosCatalogoRevisoes').remove({ id: req.params.id }).write();
  if (target) {
    const dir = path.join(__dirname, '..', 'data', 'uploads', 'produtos-catalogo-revisoes', req.params.id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    logAudit({ user: req.user, entityType: 'catalogoRevisao', entityId: target.id, entityLabel: (target.pessoas || []).join(', '), action: 'delete' });
  }
  res.json({ ok: true });
});

const catalogoRevisoesUploadsRoot = path.join(__dirname, '..', 'data', 'uploads', 'produtos-catalogo-revisoes');
const catalogoRevisoesStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(catalogoRevisoesUploadsRoot, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, Date.now() + '-' + safe);
  }
});
const uploadCatalogoRevisao = multer({ storage: catalogoRevisoesStorage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB

router.post('/catalogo-revisoes/:id/file', requireAuth, requireProdutosEdit, uploadCatalogoRevisao.single('file'), (req, res) => {
  const existing = db.get('produtosCatalogoRevisoes').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Planilha de revisão não encontrada.' });
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
  // Upload novo substitui o anterior (mesmo padrão do Catálogo/
  // Comunicados) -- apaga o arquivo físico antigo, se existia.
  if (existing.arquivo && existing.arquivo.url) {
    const oldPath = path.join(catalogoRevisoesUploadsRoot, req.params.id, path.basename(existing.arquivo.url));
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  const arquivo = {
    name: req.file.originalname,
    url: `/uploads/produtos-catalogo-revisoes/${req.params.id}/${req.file.filename}`,
    size: req.file.size,
    uploadedAt: new Date().toISOString(),
    uploadedBy: req.user.id,
    uploadedByName: req.user.name
  };
  db.get('produtosCatalogoRevisoes').find({ id: req.params.id }).assign({ arquivo, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'catalogoRevisao', entityId: existing.id, entityLabel: (existing.pessoas || []).join(', '), action: 'file_upload', details: `Arquivo enviado: ${arquivo.name}` });
  res.json({ item: db.get('produtosCatalogoRevisoes').find({ id: req.params.id }).value() });
});

router.delete('/catalogo-revisoes/:id/file', requireAuth, requireProdutosEdit, (req, res) => {
  const existing = db.get('produtosCatalogoRevisoes').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Planilha de revisão não encontrada.' });
  if (existing.arquivo && existing.arquivo.url) {
    const oldPath = path.join(catalogoRevisoesUploadsRoot, req.params.id, path.basename(existing.arquivo.url));
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  db.get('produtosCatalogoRevisoes').find({ id: req.params.id }).assign({ arquivo: null, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'catalogoRevisao', entityId: existing.id, entityLabel: (existing.pessoas || []).join(', '), action: 'file_delete' });
  res.json({ item: db.get('produtosCatalogoRevisoes').find({ id: req.params.id }).value() });
});

module.exports = router;
