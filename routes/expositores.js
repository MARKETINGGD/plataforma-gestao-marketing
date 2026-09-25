const express = require('express');
const db = require('../db');
const { nanoid } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { resolveUserName } = require('../utils/names');
const shareLinks = require('../utils/shareLinks');
const { makeCatalogFileRouter } = require('../utils/catalogFileStore');
// 70ª rodada -- reaproveita os mesmos fluxos (nome + número) já usados no
// Budget, mesmo padrão de routes/feiras.js (`const { FLUXOS_BY_BRAND } =
// require('./budget')`), pra nunca duplicar/desalinhar a lista de fluxos.
const budgetRouter = require('./budget');

const router = express.Router();

// Expositores (68ª rodada, "Rodada I" da Pendência 51 -- primeira vez que
// Expositores ganha um arquivo de rota de verdade; até aqui, Book Técnico
// e Orçamentos eram só navegação, sem dado nenhum, ver Pendência 11 do
// handoff). Pedido literal da Raquel: "Você não adicionou a planilha de
// Estoque de Expositores como sub menu em Expositores. Faça isso agora,
// e suba exatamente a planilha que te mandei em arquivo." e "adicione no
// sub menu expositores- Catálogo... separe por marcas... a opção de
// colocar o arquivo do catálogo atualizado de cada marca".
const BRANDS = ['ghelplus', 'debacco'];
const BRAND_LABEL_PT = { ghelplus: 'GhelPlus', debacco: 'De Bacco' };

function canEdit(req) {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  const access = (user.permissions || {}).expositores || 'none';
  return access === 'editor' || access === 'admin';
}
function requireExpositoresEdit(req, res, next) {
  if (!canEdit(req)) return res.status(403).json({ error: 'Você não tem permissão para editar Expositores.' });
  next();
}

function num(v) {
  return v === null || v === undefined || v === '' ? 0 : Number(v) || 0;
}
function numOrNull(v) {
  return v === null || v === undefined || v === '' ? null : Number(v) || 0;
}
function str(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

// Calcula os 4 campos que a própria planilha calculava por fórmula
// (conferido célula a célula contra o arquivo original: TOTAL = PR+SP+NE;
// PENDÊNCIA de cada praça = SALDO da praça − SEGURANÇA da praça; R$ TOTAL
// = CONSUMO MENSAL × R$ UNITÁRIO) -- a legenda da própria planilha
// ("Editáveis" x "Bloqueadas p/ edição", com TOTAL/R$ TOTAL destacados)
// confirma que esses são os campos que NUNCA vêm do formulário, sempre
// recalculados aqui.
function computeDerived(row) {
  const saldoTotal = num(row.saldoPR) + num(row.saldoSP) + num(row.saldoNE);
  const pendenciaPR = num(row.saldoPR) - num(row.segurancaPR);
  const pendenciaSP = num(row.saldoSP) - num(row.segurancaSP);
  const pendenciaNE = num(row.saldoNE) - num(row.segurancaNE);
  const valorTotalMensal = num(row.consumoMensal) * num(row.valorUnitario);
  return { saldoTotal, pendenciaPR, pendenciaSP, pendenciaNE, valorTotalMensal };
}

// campos aceitos do formulário (tudo que a planilha marcava como
// "Editáveis") -- nunca inclui os 4 calculados acima.
const EDITABLE_FIELDS = [
  'codigoEntrada', 'descricaoEntrada', 'codigoSaida', 'descricaoSaida', 'valorUnitario',
  'saldoPR', 'saldoSP', 'saldoNE', 'segurancaPR', 'segurancaSP', 'segurancaNE',
  'consumoMensal', 'loteEconomico', 'loteMultiplo',
  'ressuprimentoFornecedor', 'ressuprimentoCompras', 'estoqueSeguranca', 'nota'
];
const NUMERIC_FIELDS = new Set([
  'valorUnitario', 'saldoPR', 'saldoSP', 'saldoNE', 'segurancaPR', 'segurancaSP', 'segurancaNE',
  'consumoMensal', 'loteEconomico', 'loteMultiplo', 'ressuprimentoFornecedor', 'ressuprimentoCompras',
  'estoqueSeguranca', 'nota'
]);

function item(brand, codigoEntrada, descricaoEntrada, codigoSaida, descricaoSaida, valorUnitario,
  saldoPR, saldoSP, saldoNE, segurancaPR, pendenciaPR, segurancaSP, pendenciaSP, segurancaNE, pendenciaNE,
  consumoMensal, loteEconomico, loteMultiplo, ressuprimentoFornecedor, ressuprimentoCompras, estoqueSeguranca, nota) {
  const row = {
    id: nanoid(),
    brand,
    codigoEntrada: codigoEntrada || '',
    descricaoEntrada: descricaoEntrada || '',
    codigoSaida: codigoSaida || '',
    descricaoSaida: descricaoSaida || '',
    valorUnitario: numOrNull(valorUnitario),
    saldoPR: num(saldoPR),
    saldoSP: num(saldoSP),
    saldoNE: num(saldoNE),
    segurancaPR: num(segurancaPR),
    segurancaSP: num(segurancaSP),
    segurancaNE: num(segurancaNE),
    consumoMensal: num(consumoMensal),
    loteEconomico: numOrNull(loteEconomico),
    loteMultiplo: numOrNull(loteMultiplo),
    ressuprimentoFornecedor: numOrNull(ressuprimentoFornecedor),
    ressuprimentoCompras: numOrNull(ressuprimentoCompras),
    estoqueSeguranca: numOrNull(estoqueSeguranca),
    nota: nota === undefined ? null : nota,
    updatedAt: new Date().toISOString()
  };
  // pendenciaPR/SP/NE recebidos aqui só existem pra CONFERÊNCIA contra a
  // planilha original na hora de escrever o seed (ver comentário no
  // fundo do arquivo) -- não são gravados soltos, sempre saem de
  // computeDerived() a partir de saldo/segurança, pra nunca ficar
  // desalinhado se alguém editar um dos dois depois.
  Object.assign(row, computeDerived(row));
  return row;
}

// Semeado 1x a partir de "EXPOSITORES 2026.xlsx" (aba "2026"), célula a
// célula, resolvendo o mesclado de células da planilha original — 26
// itens de GhelPlus (linhas 4-29) + 18 de De Bacco (linhas 31-48).
// Algumas linhas da planilha original repetem o mesmo "código entrada"/
// "descrição entrada" com um "código saída" diferente (um mesmo
// componente vira mais de um produto final) — viraram registros
// separados aqui, fiéis a cada linha da planilha (não foram agrupados/
// deduplicados).
function seedIfEmpty() {
  if (db.get('expositoresEstoque').size().value() > 0) return;
  const rows = [
    // ---------- GhelPlus ----------
    item('ghelplus', '30.04.00598', 'Exp. GP Simples Pias 1200mm-Metal Preto', '10.08.03449', 'Expositor GP Simples Pias 1200mm-Metal Preto', 214, 44, 2, 1, 10, 34, 5, -3, 10, -9, 19, 25, 1, 20, 1, 25, 25),
    item('ghelplus', '30.04.00599', 'Exp. GP Duplo Pias-Metal Preto', '10.08.03450', 'Expositor GP Duplo Pias-Metal Preto', 386, 22, 5, -27, 10, 12, 5, 0, 15, -42, 25, 30, 1, 20, 1, 30, 30),
    item('ghelplus', '30.04.00600', 'Módulo Exp. GP Simples 1 Pia-Metal Preto', '10.08.03461', 'Módulo Exp. GP Simples 1 Pia-Metal Preto', 150, 30, 0, 0, 5, 25, 5, -5, 5, -5, 0, 15, 1, 20, 1, 15, 15),
    item('ghelplus', '30.04.00604', 'Módulo Exp. GP Duplo 2 Pias-Metal Preto', '10.08.03458', 'Módulo Exp. GP Duplo 2 Pias-Metal Preto', 295, 30, 0, 0, 5, 25, 5, -5, 5, -5, 0, 15, 1, 20, 1, 15, 15),
    item('ghelplus', '30.04.00585', 'Exp. GP Cubas N1/N2/N3-Preto-Grilazer', '10.08.03447', 'Expositor GP Cubas N1/N2/N3-Preto', 190, 4, 0, 2, 15, -11, 5, -5, 15, -13, 41, 50, 1, 30, 1, 35, 35),
    item('ghelplus', '30.04.00614', 'Módulo Exp. GP Cubas N1/N2 e Válvulas-Preto', '10.08.03459', 'Módulo Exp. GP Cubas N1/N2 e Válvulas-Preto', 405, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 20, 1, 0, 0),
    item('ghelplus', '30.04.00601', 'Módulo Exp. GP Cubas N1/N3 e Válvulas-Preto', '10.08.03462', 'Módulo Exp. GP Cubas N1/N3 e Válvulas-Preto', 405, 24, 2, 5, 5, 19, 5, -3, 5, 0, 3, 10, 1, 20, 1, 15, 15),
    item('ghelplus', '30.04.00597', 'Exp. GP Lixeiras-Preto', '10.08.03452', 'Expositor GP Lixeiras-Preto', 460, 18, 5, 3, 5, 13, 5, 0, 5, -2, 4, 10, 1, 20, 1, 15, 15),
    item('ghelplus', '30.04.00596', 'Exp. GP TQ Mini/500-Preto', '10.08.03451', 'Expositor GP TQ Mini/500-Preto', 480, 25, 4, 3, 5, 20, 5, -1, 5, -2, 4, 10, 1, 20, 1, 15, 15),
    item('ghelplus', '30.04.00572', 'Módulo Exp. GP TQ Mini/500/Duplo-Preto', '10.08.03460', 'Módulo Exp. GP TQ Mini/500/Duplo-Preto', 330, 28, 5, 5, 5, 23, 5, 0, 5, 0, 0, 10, 1, 20, 1, 15, 15),
    item('ghelplus', '30.04.00616', 'Exp. GP Gav. Cubas/Válvulas/Pias 1305x800x1140-Preto', '10.08.03464', 'Expositor GP Gav. Cubas/Válvulas/Pias 1305x800x1140-Preto', 1010, 20, 0, 0, 5, 15, 0, 0, 5, -5, 0, 10, 1, 20, 1, 10, 10),
    item('ghelplus', '30.04.00617', 'Tampo Exp. GP Gav. Superior 03464 - 1195x755x15-Preto', '10.08.03464', 'Expositor GP Gav. Cubas/Válvulas/Pias 1305x800x1140-Preto', 118, 18, 0, 0, 5, 13, 0, 0, 5, -5, 0, 10, 1, 20, 1, 10, 10),
    item('ghelplus', '30.04.00569', 'Tampo Exp. GP 03464/03465 Sem Furo - 1195x535mm-Preto', '10.08.03464', 'Expositor GP Gav. Cubas/Válvulas/Pias 1305x800x1140-Preto', 71, 98, 0, 31, 40, 58, 0, 0, 40, -9, 21, 40, 1, 20, 1, 80, 80),
    item('ghelplus', '30.04.00569', 'Tampo Exp. GP 03464/03465 Sem Furo - 1195x535mm-Preto', '10.08.03464', 'Expositor GP Gav. Cubas/Válvulas/Pias 1305x800x1140-Preto', 71, 98, 0, 31, 40, 58, 0, 0, 40, -9, 21, 40, 1, 20, 1, 80, 80),
    item('ghelplus', '30.04.00569', 'Tampo Exp. GP 03464/03465 Sem Furo - 1195x535mm-Preto', '10.08.03465', 'Expositor GP Gav. Cubas/Pias-Preto', 71, 98, 0, 31, 40, 58, 0, 0, 40, -9, 21, 40, 1, 20, 1, 80, 80),
    item('ghelplus', '30.04.00569', 'Tampo Exp. GP 03464/03465 Sem Furo - 1195x535mm-Preto', '10.08.03465', 'Expositor GP Gav. Cubas/Pias-Preto', 71, 98, 0, 31, 40, 58, 0, 0, 40, -9, 21, 40, 1, 20, 1, 80, 80),
    item('ghelplus', '30.04.00569', 'Tampo Exp. GP 03464/03465 Sem Furo - 1195x535mm-Preto', '10.08.03465', 'Expositor GP Gav. Cubas/Pias-Preto', 71, 98, 0, 31, 40, 58, 0, 0, 40, -9, 21, 40, 1, 20, 1, 80, 80),
    item('ghelplus', '30.04.00618', 'Exp. GP Gav. Cubas/Pias-Preto', '10.08.03465', 'Expositor GP Gav. Cubas/Pias-Preto', 1095, 32, 0, 0, 10, 0, 0, 0, 10, -10, 7, 15, 1, 20, 1, 20, 20),
    item('ghelplus', '30.04.00590', 'Exp. GP TQ Monobloco-Preto', '10.08.03453', 'Expositor GP TQ Monobloco-Preto', 625, 30, 0, 0, 10, 20, 0, 0, 5, -5, 1, 10, 1, 20, 1, 15, 15),
    item('ghelplus', '30.04.00619', 'Tampo Exp. GP TQ Monobloco Sem Furo - 790x530mm-Preto', '10.08.03453', 'Expositor GP TQ Monobloco-Preto', 72.5, 21, 0, 4, 10, 11, 0, 0, 5, -1, 0, 10, 1, 20, 1, 15, 15),
    item('ghelplus', '30.04.00620', 'Tampo Exp. GP TQ Monobloco Sem Furo - 790x585mm-Preto', '10.08.03453', 'Expositor GP TQ Monobloco-Preto', 78.8, 22, 0, 4, 10, 12, 0, 0, 5, -1, 0, 10, 1, 20, 1, 15, 15),
    item('ghelplus', '30.04.00591', 'Tampo Exp. GP TQ Monobloco 25L - 790x530mm-Preto', '10.08.20462', 'Tampo Exp. GP TQ Monobloco 25L - 790x530mm-Preto', 77, 1, -1, 0, 0, 1, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 0),
    item('ghelplus', '30.04.00592', 'Tampo Exp. GP TQ Monobloco 30L - 790x530mm-Preto', '10.08.20463', 'Tampo Exp. GP TQ Monobloco 30L - 790x530mm-Preto', 77, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    item('ghelplus', '30.04.00603', 'Tampo Exp. GP TQ Monobloco 55L - 790x585mm-Preto', '10.08.20464', 'Tampo Exp. GP TQ Monobloco 55L - 790x585mm-Preto', 83, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    item('ghelplus', '30.04.00593', 'Tampo Exp. GP TQ Monobloco 30L - 790x585mm-Preto', '10.08.20465', 'Tampo Exp. GP TQ Monobloco 30L - 790x585mm-Preto', 83, 1, -1, 0, 0, 1, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 0),
    item('ghelplus', '30.04.00615', 'Tampo Exp. GP TQ Monobloco 35L - 790x585mm-Preto', '10.08.20466', 'Tampo Exp. GP TQ Monobloco 35L - 790x585mm-Preto', 83, 4, 1, 0, 0, 4, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    // ---------- De Bacco ----------
    item('debacco', '30.04.00515', 'Exp. DB Grafito - Tampo Superior s/ Furo', '10.08.00224', 'Expositor DB Grafito Volume 01 - Corpo', 342, 12, 0, 0, 3, 9, 0, 0, 2, -2, 2, 12, 1, 20, 1, 5, 5),
    item('debacco', '30.04.00520', 'Exp. DB Grafito - Corpo', '10.08.00224', 'Expositor DB Grafito Volume 01 - Corpo', 987, 14, 0, 2, 3, 11, 0, 0, 2, 0, 2, 12, 1, 20, 1, 5, 5),
    item('debacco', '30.04.00518', 'Exp. DB Grafito - Tampo Gavetas', '10.08.00225', 'Expositor DB Grafito Volume 02 - Kit Gavetas', 125, 23, 0, 4, 6, 17, 0, 0, 4, 0, 4, 24, 1, 20, 1, 10, 10),
    item('debacco', '30.04.00518', 'Exp. DB Grafito - Tampo Gavetas', '10.08.00225', 'Expositor DB Grafito Volume 02 - Kit Gavetas', 125, 23, 0, 4, 6, 17, 0, 0, 4, 0, 4, 24, 1, 20, 1, 10, 10),
    item('debacco', '30.04.00519', 'Exp. DB Grafito - Kit 2 Gavetas', '10.08.00225', 'Expositor DB Grafito Volume 02 - Kit Gavetas', 435, 14, 0, 2, 3, 11, 0, 0, 2, 0, 2, 12, 1, 20, 1, 5, 5),
    item('debacco', '30.04.00606', 'Exp. DB Eletros - Base Inferior - V3', '10.08.00226', 'Expositor DB Eletros - Base Inferior - V3', 1445, 10, 0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 1, 20, 1, 0, 0),
    item('debacco', '30.04.00578', 'Exp. DB Eletros - Tampo p/ Fornos c/ Suporte - V3', '10.08.00226', 'Expositor DB Eletros - Base Inferior - V3', 143, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 20, 1, 0, 0),
    item('debacco', '30.04.00579', 'Exp. DB Eletros - Tampo p/ Lava Louças c/ Suporte - V3', '10.08.00226', 'Expositor DB Eletros - Base Inferior - V3', 143, 6, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 1, 20, 1, 0, 0),
    item('debacco', '30.04.00580', 'Exp. DB Eletros - Tampo p/ 2 Adegas ou Beer Pequena - V3', '10.08.00226', 'Expositor DB Eletros - Base Inferior - V3', 143, 3, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 1, 20, 1, 0, 0),
    item('debacco', '30.04.00581', 'Exp. DB Eletros - Tampo p/ 1 Adega ou Beer Grande - V3', '10.08.00226', 'Expositor DB Eletros - Base Inferior - V3', 143, 3, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 1, 20, 1, 0, 0),
    item('debacco', '30.04.00582', 'Exp. DB Eletros - Tampo p/ 1 Adega ou Beer Pequena - V3', '10.08.00226', 'Expositor DB Eletros - Base Inferior - V3', 143, 3, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 1, 20, 1, 0, 0),
    item('debacco', '30.04.00607', 'Exp. DB Eletros - Base Superior - V3', '10.08.00227', 'Expositor DB Eletros - Base Superior - V3', 978, 11, 0, 0, 0, 11, 0, 0, 0, 0, 0, 0, 1, 20, 1, 0, 0),
    item('debacco', '30.04.00608', 'Exp. DB Eletros - Tampo Cooktop - V3', '10.08.00228', 'Expositor DB Eletros - Tampo Cooktop (960x640 mm) - V3', 140, 8, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 1, 20, 1, 0, 0),
    item('debacco', '30.04.00609', 'Exp. DB Torre Aquecida - Base Superior - V2', '10.08.00234', 'Expositor DB Torre Aquecida - V2 Volume 01', 2277, 11, 0, 0, 0, 11, 0, 0, 0, 0, 0, 0, 1, 20, 1, 0, 0),
    item('debacco', '30.04.00610', 'Exp. DB Torre Aquecida - Base Inferior - V2', '10.08.00235', 'Expositor DB Torre Aquecida - V2 Volume 02', 670, 10, 0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 1, 20, 1, 0, 0),
    item('debacco', '30.04.00611', 'Exp. DB Torre Aquecida - Prateleira Dupla - V2', '10.08.00235', 'Expositor DB Torre Aquecida - V2 Volume 02', 177, 12, 0, 0, 0, 12, 0, 0, 0, 0, 0, 0, 1, 20, 1, 0, 0),
    item('debacco', '30.04.00612', 'Exp. DB Torre Aquecida - Frontal - V2', '10.08.00235', 'Expositor DB Torre Aquecida - V2 Volume 02', 817, 11, 0, 0, 0, 11, 0, 0, 0, 0, 0, 0, 1, 20, 1, 0, 0),
    item('debacco', '30.04.00613', 'Exp. DB Torre Aquecida - Prateleira Individual - V2', '10.08.00236', 'Exp. DB Torre Aquecida - Prateleira Individual - V2', 72, 10, 0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 1, 20, 1, 0, 0)
  ];
  db.get('expositoresEstoque').push(...rows).write();
}
seedIfEmpty();

// ---------- Controle de Expositores (estoque) ----------
router.get('/estoque', requireAuth, (req, res) => {
  const { brand } = req.query;
  let rows = db.get('expositoresEstoque').value();
  if (brand) rows = rows.filter((r) => r.brand === brand);
  res.json({ canEdit: canEdit(req), items: rows });
});

// ---------- link externo (68ª rodada, "Rodada I" da Pendência 51 --
// como a 66ª rodada já tinha adiantado, Expositores só ganharia link
// externo depois de existir dado de verdade -- agora existe. Só
// "leitura" por enquanto, mesmo padrão dos outros 4 recursos da 66ª
// rodada) -- precisa ficar ANTES de qualquer "/estoque/:id" (não existe
// ainda, mas é o mesmo cuidado de sempre).
router.get('/estoque/public-link', requireAuth, requireExpositoresEdit, (req, res) => {
  const { brand } = req.query;
  const link = shareLinks.getLink('expositoresEstoque', brand);
  res.json({ publicToken: link ? link.token : null });
});
router.post('/estoque/public-link/generate', requireAuth, requireExpositoresEdit, (req, res) => {
  const { brand } = req.body || {};
  if (!BRANDS.includes(brand)) return res.status(400).json({ error: 'Escolha a marca.' });
  const token = shareLinks.generateLink('expositoresEstoque', brand, req);
  logAudit({ user: req.user, entityType: 'shareLink', entityId: 'expositoresEstoque:' + brand, entityLabel: 'Controle de Expositores · ' + brand, action: 'generate_public_link' });
  res.json({ publicToken: token });
});
router.delete('/estoque/public-link', requireAuth, requireExpositoresEdit, (req, res) => {
  const { brand } = req.query;
  shareLinks.revokeLink('expositoresEstoque', brand);
  logAudit({ user: req.user, entityType: 'shareLink', entityId: 'expositoresEstoque:' + brand, entityLabel: 'Controle de Expositores · ' + brand, action: 'revoke_public_link' });
  res.json({ ok: true });
});
router.get('/estoque/public/:token', (req, res) => {
  const link = shareLinks.findByToken(req.params.token);
  if (!link || link.resource !== 'expositoresEstoque') return res.status(404).json({ error: 'Link inválido ou desativado.' });
  const items = db.get('expositoresEstoque').value().filter((r) => r.brand === link.scopeKey);
  res.json({ brand: link.scopeKey, items });
});

router.put('/estoque/:id', requireAuth, requireExpositoresEdit, (req, res) => {
  const existing = db.get('expositoresEstoque').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Item não encontrado.' });
  const b = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  EDITABLE_FIELDS.forEach((k) => {
    if (b[k] === undefined) return;
    updates[k] = NUMERIC_FIELDS.has(k) ? (b[k] === '' ? null : Number(b[k]) || 0) : str(b[k]);
  });
  const merged = Object.assign({}, existing, updates);
  Object.assign(updates, computeDerived(merged));
  db.get('expositoresEstoque').find({ id: req.params.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'expositorEstoque', entityId: existing.id, entityLabel: existing.descricaoEntrada || existing.codigoEntrada, action: 'update' });
  res.json({ item: db.get('expositoresEstoque').find({ id: req.params.id }).value() });
});

// ---------- Lançamento mensal no Budget (70ª rodada, pedido da Raquel:
// "os lançamentos mensais, o total de cada marca no mês, deve ser
// automaticamente adicionado ao budget. Se for De Bacco no fluxo:
// 2.5.3.14. Se for GhelPlus, no fluxo: 2.5.2.14. Sempre no mês em que foi
// gasto e na marca em que foi gasto") -- "lançar" um mês pega o total
// ATUAL de Consumo mensal/R$ Total mês da marca (soma de `consumoMensal`/
// `valorTotalMensal` de todos os itens dela -- os mesmos números da linha
// de total da tabela) e grava em 2 lugares: um registro de histórico
// aqui (`expositoresLancamentosMensais`, usado pela aba "Total Mensal",
// que soma as 2 marcas por mês) e um lançamento automático em
// `budgetEntries`, sempre no fluxo "Expositores Padrão" da marca certa
// (2.5.2.14 GhelPlus / 2.5.3.14 De Bacco, buscados na própria lista do
// Budget pelo número do fluxo, nunca copiados soltos, pra nunca
// desalinhar se a lista mudar). Relançar o MESMO mês/ano/marca sempre
// SUBSTITUI o lançamento anterior no Budget (nunca duplica) -- mesmo
// espírito de createBudgetEntriesForItem/syncItemToBudget em
// routes/feiras.js.
const { FLUXOS_BY_BRAND } = budgetRouter;
const EXPOSITORES_FLUXO_CODE_BY_BRAND = { ghelplus: '2.5.2.14', debacco: '2.5.3.14' };
function fluxoExpositoresPadraoFor(brand) {
  const lista = FLUXOS_BY_BRAND[brand] || [];
  const code = EXPOSITORES_FLUXO_CODE_BY_BRAND[brand];
  return lista.find((f) => f.endsWith(' - ' + code)) || null;
}
function computeBrandMonthlyTotals(brand) {
  const rows = db.get('expositoresEstoque').value().filter((r) => r.brand === brand);
  const totalUnidades = rows.reduce((s, r) => s + num(r.consumoMensal), 0);
  const totalValor = rows.reduce((s, r) => s + num(r.valorTotalMensal), 0);
  return { totalUnidades, totalValor };
}

router.get('/lancamentos-mensais', requireAuth, (req, res) => {
  // Sem checagem de permissão de edição (só requireAuth) -- mesmo espírito
  // do GET /estoque acima: "Brindes, Produtos e Expositores: todo mundo
  // pode ver". Sem `brand`, devolve as 2 marcas juntas (usado pela aba
  // "Total Mensal", que soma os lançamentos das 2).
  const { brand } = req.query;
  let items = db.get('expositoresLancamentosMensais').value();
  if (brand) items = items.filter((l) => l.brand === brand);
  items = items.map((l) => Object.assign({}, l, { updatedBy: resolveUserName(l.updatedById, l.updatedBy) }));
  res.json({ items });
});

router.post('/lancamentos-mensais/lancar', requireAuth, requireExpositoresEdit, (req, res) => {
  const { brand, year, month } = req.body || {};
  if (!BRANDS.includes(brand)) return res.status(400).json({ error: 'Escolha a marca.' });
  const y = Number(year);
  const m = Number(month);
  if (!y || !m || m < 1 || m > 12) return res.status(400).json({ error: 'Escolha o mês e o ano.' });
  const fluxo = fluxoExpositoresPadraoFor(brand);
  if (!fluxo) return res.status(500).json({ error: 'Não encontrei o fluxo "Expositores Padrão" do Budget dessa marca.' });
  const { totalUnidades, totalValor } = computeBrandMonthlyTotals(brand);
  const now = new Date().toISOString();
  const existing = db.get('expositoresLancamentosMensais').find({ brand, year: y, month: m }).value();
  // Relançar sempre substitui o lançamento anterior no Budget (nunca
  // duplica, mesma lógica de removeBudgetEntriesForItem em feiras.js).
  if (existing && existing.budgetEntryId) {
    db.get('budgetEntries').remove({ id: existing.budgetEntryId }).write();
  }
  const launchId = existing ? existing.id : nanoid();
  const budgetEntry = {
    id: nanoid(),
    brand,
    category: fluxo,
    year: y,
    month: m,
    planejado: null,
    realizado: totalValor,
    notes: 'Lançado automaticamente pelo Controle de Expositores (total mensal de consumo).',
    fornecedor: '',
    tituloCompra: 'Total mensal de Expositores',
    quantidade: totalUnidades,
    sourceExpositoresLancamentoId: launchId,
    createdAt: now,
    updatedAt: now,
    updatedBy: req.user.name,
    updatedById: req.user.id
  };
  db.get('budgetEntries').push(budgetEntry).write();
  const launchData = {
    id: launchId,
    brand,
    year: y,
    month: m,
    totalUnidades,
    totalValor,
    budgetEntryId: budgetEntry.id,
    updatedAt: now,
    updatedBy: req.user.name,
    updatedById: req.user.id
  };
  if (existing) {
    db.get('expositoresLancamentosMensais').find({ id: launchId }).assign(launchData).write();
  } else {
    launchData.createdAt = now;
    db.get('expositoresLancamentosMensais').push(launchData).write();
  }
  logAudit({ user: req.user, entityType: 'expositoresLancamentoMensal', entityId: launchId, entityLabel: `${BRAND_LABEL_PT[brand]} · ${m}/${y}`, action: existing ? 'update' : 'create' });
  res.json({
    launch: Object.assign({}, db.get('expositoresLancamentosMensais').find({ id: launchId }).value(), { updatedBy: req.user.name }),
    budgetEntry,
    fluxo
  });
});

// ---------- Catálogo (68ª rodada, pedido da Raquel: "adicione no sub
// menu expositores- Catálogo... separe por marcas... a opção de colocar
// o arquivo do catálogo atualizado de cada marca") -- mesmo módulo
// genérico do Catálogo de Produtos, coleção separada (2 catálogos
// diferentes, ver comentário em routes/produtos.js).
router.use('/catalogo', makeCatalogFileRouter({
  collectionName: 'expositoresCatalogoFiles',
  uploadsSubdir: 'expositores-catalogo',
  brands: BRANDS,
  brandLabelPt: BRAND_LABEL_PT,
  permissionKey: 'expositores',
  resourceLabel: 'Catálogo de Expositores'
}));

module.exports = router;
