const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { resolveUserName } = require('../utils/names');

const router = express.Router();

// Retiradas Internas (38ª rodada, pedido da Raquel: "em brindes, adicione
// um sub menu: Controle Geral / Retiradas Internas") — registro de retirada
// INTERNA de brinde ou vinho (alguém da equipe pegou um item pra uso
// próprio/interno). Diferente do "Registro de Saídas" que já existe em
// routes/brindes.js (`/log`), que é pra saída pra representante/cliente —
// aqui não tem representante nem cliente, é só data + produto + quem
// retirou + motivo, como pedido.
//
// 40ª rodada, pedido da Raquel: "Quem retirou não deve ser pre definido,
// devemos poder escrever o nome de quem foi; tbm precisamos por a
// quantidade retirada." — então "quem retirou" deixou de ser um select
// vinculado a uma conta de usuário (`withdrawnBy` como id) e virou texto
// livre (`withdrawnByName` direto, sem vínculo com conta nenhuma) — porque
// quem retirou um brinde nem sempre é alguém com login na Plataforma
// (pode ser qualquer pessoa da equipe/loja). Também entrou o campo
// `quantidade` (número, obrigatório, mínimo 1).
//
// 79ª rodada, pedido da Raquel: "a tabela deve deixar adicionar mais de
// um item por retirada, por que tem retiradas que são pegos várias
// itens" -- uma retirada passou a guardar uma LISTA de itens
// (`items: [{catalogItemId, item, quantidade}]`) em vez de um item só.
// Data, marca, quem retirou e motivo continuam únicos por retirada (são
// do "evento" de retirada como um todo, não de cada item individual).
//
// Compatibilidade com registros antigos: registros de antes dessa rodada
// guardam um item só, direto nos campos `item`/`catalogItemId`/
// `quantidade` do próprio registro (sem `items`). `withItemsArray()`
// abaixo converte esses registros antigos pra lista de 1 item só na
// leitura, sem precisar migrar nada no arquivo — o mesmo padrão já usado
// em outras migrações "on read" da Papoi (ver migratePostType em
// routes/socialPosts.js).
//
// Registros criados antes da 40ª rodada guardam `withdrawnBy` como o id
// de uma conta de usuário — pra esses, o nome continua sendo resolvido ao
// vivo (mesmo padrão de sempre, ver utils/names.js), então se o nome da
// conta for corrigido depois isso ainda reflete. Registros novos marcam
// `withdrawnByFreeText: true` e já guardam o nome final direto em
// `withdrawnByName`, sem tentar resolver contra nenhuma conta.
//
// Reaproveita o catálogo de Brindes (`brindesCatalog`) como a "lista
// pré-cadastrada" de produtos de cada marca — inclusive pra vinho, que
// vira só mais um item do catálogo com `group: 'Vinhos'` (o campo `group`
// já existe no catálogo desde sempre, só não tinha nenhum grupo assim
// cadastrado ainda). Igual ao Registro de Saídas, isso é só um
// log/histórico — NÃO desconta do estoque do catálogo (mesmo
// comportamento já usado lá, decisão consistente com o que já existe).
//
// Acesso: qualquer pessoa logada pode ver; só quem tem permissão "brindes"
// (editor/admin, ou é admin da plataforma) pode criar/editar/excluir —
// mesma permissão já usada em todo o resto do módulo de Brindes.
function canEdit(req) {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  const access = (user.permissions || {}).brindes || 'none';
  return access === 'editor' || access === 'admin';
}
function requireEdit(req, res, next) {
  if (!canEdit(req)) return res.status(403).json({ error: 'Você não tem permissão para editar Retiradas Internas.' });
  next();
}

const BRANDS = ['debacco', 'ghelplus'];
function validBrand(brand) {
  return BRANDS.includes(brand) ? brand : null;
}

function toQuantidade(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.round(n);
}

// Registro antigo (sem `items`) -> lista de 1 item só, pra leitura sempre
// poder contar com `items` como array, não importa a idade do registro.
function withItemsArray(r) {
  if (Array.isArray(r.items)) return r;
  return Object.assign({}, r, {
    items: [{ catalogItemId: r.catalogItemId || null, item: r.item || '', quantidade: r.quantidade || null }]
  });
}

// Cria (se precisar) as entradas novas no catálogo geral de Brindes pra
// itens que vieram "avulsos" (não escolhidos na lista pré-cadastrada) --
// mesma lógica de antes, agora rodando por item da lista em vez de uma
// vez só. Devolve a lista de itens já com `catalogItemId` resolvido.
function resolveItemsCatalog(items, brand) {
  return items.map((it) => {
    let catalogItemId = it.catalogItemId || null;
    if (catalogItemId) {
      const existing = db.get('brindesCatalog').find({ id: catalogItemId }).value();
      if (!existing) catalogItemId = null;
    }
    if (!catalogItemId) {
      const newItem = {
        id: nanoid(),
        brand,
        group: (it.group && it.group.trim()) || 'Outros',
        code: '',
        item: it.item.trim(),
        multiplo: '',
        valor: null,
        estoquePR: 0,
        estoqueSP: 0,
        estoquePE: 0,
        estoqueTotal: 0,
        status: '',
        obs: '',
        updatedAt: new Date().toISOString()
      };
      db.get('brindesCatalog').push(newItem).write();
      catalogItemId = newItem.id;
    }
    return { catalogItemId, item: it.item.trim(), quantidade: it.quantidade };
  });
}

// Valida a lista de itens mandada pelo formulário -- pelo menos 1, cada um
// com nome e quantidade válida (mínimo 1). Devolve `{ error }` ou
// `{ items }` já normalizados.
function validateItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: 'Adicione pelo menos um item retirado.' };
  }
  const items = [];
  for (const raw of rawItems) {
    const item = (raw && raw.item || '').trim();
    if (!item) return { error: 'Escolha ou cadastre o produto de cada item retirado.' };
    const quantidade = toQuantidade(raw && raw.quantidade);
    if (!quantidade) return { error: `Informe a quantidade retirada de "${item}" (mínimo 1).` };
    items.push({ catalogItemId: (raw && raw.catalogItemId) || null, item, group: raw && raw.group, quantidade });
  }
  return { items };
}

router.get('/', requireAuth, (req, res) => {
  const { brand } = req.query;
  let rows = db.get('retiradasInternas').value();
  if (brand) rows = rows.filter((r) => r.brand === brand);
  rows = rows.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  // Nome de quem retirou: registros novos (texto livre) mostram o nome
  // gravado direto; registros antigos (vinculados a uma conta) continuam
  // resolvendo o nome ao vivo, mesmo padrão já usado em todo o resto da
  // Plataforma — ver utils/names.js.
  rows = rows.map((r) => {
    const withItems = withItemsArray(r);
    if (r.withdrawnByFreeText) return withItems;
    return Object.assign({}, withItems, { withdrawnByName: resolveUserName(r.withdrawnBy, r.withdrawnByName) });
  });
  res.json({ items: rows });
});

router.post('/', requireAuth, requireEdit, (req, res) => {
  const { brand, date, items, withdrawnByName, motivo } = req.body || {};
  const finalBrand = validBrand(brand);
  if (!finalBrand) return res.status(400).json({ error: 'Escolha a marca.' });
  const finalWithdrawnByName = (withdrawnByName || '').trim();
  if (!finalWithdrawnByName) return res.status(400).json({ error: 'Escreva o nome de quem retirou.' });
  const validated = validateItems(items);
  if (validated.error) return res.status(400).json({ error: validated.error });
  const finalItems = resolveItemsCatalog(validated.items, finalBrand);

  // Rótulo do registro de auditoria/histórico junta os nomes dos itens
  // (até 3, "+N" se tiver mais), pra continuar identificável numa lista de
  // ações sem precisar abrir o registro.
  const itemsLabel = finalItems.length > 2
    ? `${finalItems.slice(0, 2).map((it) => it.item).join(', ')} +${finalItems.length - 2}`
    : finalItems.map((it) => it.item).join(', ');

  const row = {
    id: nanoid(),
    brand: finalBrand,
    date: date || new Date().toISOString().slice(0, 10),
    items: finalItems,
    withdrawnBy: null,
    withdrawnByName: finalWithdrawnByName,
    withdrawnByFreeText: true,
    motivo: motivo || '',
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    createdByName: req.user.name
  };
  db.get('retiradasInternas').push(row).write();
  logAudit({ user: req.user, entityType: 'retiradaInterna', entityId: row.id, entityLabel: `${itemsLabel} · ${row.withdrawnByName}`, action: 'create' });
  res.json({ item: row });
});

router.put('/:id', requireAuth, requireEdit, (req, res) => {
  const existing = db.get('retiradasInternas').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Registro não encontrado.' });
  const b = req.body || {};
  const updates = {};
  if (b.date !== undefined) updates.date = b.date || existing.date;
  if (b.items !== undefined) {
    const validated = validateItems(b.items);
    if (validated.error) return res.status(400).json({ error: validated.error });
    updates.items = resolveItemsCatalog(validated.items, existing.brand);
  }
  if (b.motivo !== undefined) updates.motivo = b.motivo;
  if (b.withdrawnByName !== undefined) {
    const name = (b.withdrawnByName || '').trim();
    if (!name) return res.status(400).json({ error: 'Escreva o nome de quem retirou.' });
    updates.withdrawnByName = name;
    updates.withdrawnBy = null;
    updates.withdrawnByFreeText = true;
  }
  db.get('retiradasInternas').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'retiradaInterna', entityId: existing.id, entityLabel: existing.withdrawnByName, action: 'update' });
  res.json({ item: withItemsArray(db.get('retiradasInternas').find({ id: req.params.id }).value()) });
});

router.delete('/:id', requireAuth, requireEdit, (req, res) => {
  const existing = db.get('retiradasInternas').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Registro não encontrado.' });
  db.get('retiradasInternas').remove({ id: req.params.id }).write();
  logAudit({ user: req.user, entityType: 'retiradaInterna', entityId: existing.id, entityLabel: existing.withdrawnByName, action: 'delete' });
  res.json({ ok: true });
});

module.exports = router;
