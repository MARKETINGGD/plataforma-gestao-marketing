const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
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
// célula, resolvendo o mesclado de células da planilha original — 23
// itens de GhelPlus + 17 de De Bacco (40 no total).
// Algumas linhas da planilha original repetem o mesmo "código entrada"/
// "descrição entrada" com um "código saída" diferente (um mesmo
// componente vira mais de um produto final, ex.: 30.04.00569 alimenta
// tanto 10.08.03464 quanto 10.08.03465) — viraram registros separados
// aqui, 1 por combinação (entrada, saída) única.
//
// 70ª rodada, bug real reportado pela Raquel ("a planilha do papoi deve
// ser exatamente igual a essa que te enviei... o valor não deve ser
// somado a mais, deve ser considerado uma única vez"): células mescladas
// da planilha original fizeram uma mesma combinação (entrada, saída)
// entrar aqui DUPLICADA (2x ou 3x, com os mesmos valores), inflando a
// soma de Consumo mensal/R$ Total mês por marca — e, na 70ª rodada, o
// próprio lançamento automático no Budget. Corrigido removendo as cópias
// extras (nunca deduplicar por só "código entrada" — 30.04.00569 continua
// com 2 linhas de verdade, uma por código de saída; só as cópias 100%
// idênticas, mesmo código de entrada E de saída, eram bug). Bancos que já
// tinham rodado o seed antigo (com a duplicata) são corrigidos por uma
// migração em db.js, não só aqui (o seed só roda 1x, na coleção vazia).
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
    item('ghelplus', '30.04.00569', 'Tampo Exp. GP 03464/03465 Sem Furo - 1195x535mm-Preto', '10.08.03465', 'Expositor GP Gav. Cubas/Pias-Preto', 71, 98, 0, 31, 40, 58, 0, 0, 40, -9, 21, 40, 1, 20, 1, 80, 80),
    item('ghelplus', '30.04.00618', 'Exp. GP Gav. Cubas/Pias-Preto', '10.08.03465', 'Expositor GP Gav. Cubas/Pias-Preto', 1095, 10, 0, 0, 10, 0, 0, 0, 10, -10, 7, 15, 1, 20, 1, 20, 20),
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

// 144ª rodada, pedido da Raquel: "importante ter um link externo também
// para o total mensal" -- recurso PRÓPRIO (não reaproveita o de
// Controle de Expositores acima), porque a aba "Total Mensal" não é por
// marca, já soma as 2 juntas -- `scopeKey` fixo 'geral', mesmo espírito
// de outros recursos sem separação por marca.
function computeTotalMensalAgregado() {
  const groups = {};
  db.get('expositoresLancamentosMensais').value().forEach((l) => {
    const key = l.year + '-' + l.month;
    if (!groups[key]) groups[key] = { year: l.year, month: l.month, totalUnidades: 0, totalValor: 0 };
    groups[key].totalUnidades += Number(l.totalUnidades) || 0;
    groups[key].totalValor += Number(l.totalValor) || 0;
  });
  return Object.values(groups).sort((a, b) => (b.year - a.year) || (b.month - a.month));
}
router.get('/lancamentos-mensais/total-mensal/public-link', requireAuth, requireExpositoresEdit, (req, res) => {
  const link = shareLinks.getLink('expositoresTotalMensal', 'geral');
  res.json({ publicToken: link ? link.token : null });
});
router.post('/lancamentos-mensais/total-mensal/public-link/generate', requireAuth, requireExpositoresEdit, (req, res) => {
  const token = shareLinks.generateLink('expositoresTotalMensal', 'geral', req);
  logAudit({ user: req.user, entityType: 'shareLink', entityId: 'expositoresTotalMensal:geral', entityLabel: 'Expositores · Total Mensal', action: 'generate_public_link' });
  res.json({ publicToken: token });
});
router.delete('/lancamentos-mensais/total-mensal/public-link', requireAuth, requireExpositoresEdit, (req, res) => {
  shareLinks.revokeLink('expositoresTotalMensal', 'geral');
  logAudit({ user: req.user, entityType: 'shareLink', entityId: 'expositoresTotalMensal:geral', entityLabel: 'Expositores · Total Mensal', action: 'revoke_public_link' });
  res.json({ ok: true });
});
router.get('/lancamentos-mensais/total-mensal/public/:token', (req, res) => {
  const link = shareLinks.findByToken(req.params.token);
  if (!link || link.resource !== 'expositoresTotalMensal') return res.status(404).json({ error: 'Link inválido ou desativado.' });
  res.json({ items: computeTotalMensalAgregado() });
});

// 144ª rodada, pedido da Raquel: "opção de adicionar novos expositores no
// controle" -- até aqui só existiam os itens do seed original (1x, na
// 68ª/70ª rodada), sem nenhum jeito de cadastrar um item novo depois.
// Mesmo conjunto de campos aceitos do PUT logo abaixo (EDITABLE_FIELDS),
// os 4 calculados sempre saindo de computeDerived -- nunca aceitos direto
// do formulário, mesmo cuidado de sempre.
router.post('/estoque', requireAuth, requireExpositoresEdit, (req, res) => {
  const b = req.body || {};
  if (!BRANDS.includes(b.brand)) return res.status(400).json({ error: 'Escolha a marca.' });
  if (!str(b.codigoEntrada) && !str(b.descricaoEntrada)) return res.status(400).json({ error: 'Informe ao menos o código ou a descrição de entrada.' });
  const now = new Date().toISOString();
  const row = { id: nanoid(), brand: b.brand, updatedAt: now };
  // Mesma regra de conversão já usada no PUT logo abaixo -- campo vazio
  // ou ausente vira null (nunca 0 "falso"), só os que têm número de
  // verdade viram número.
  EDITABLE_FIELDS.forEach((k) => {
    row[k] = NUMERIC_FIELDS.has(k) ? (b[k] === '' || b[k] === undefined ? null : Number(b[k]) || 0) : str(b[k] || '');
  });
  Object.assign(row, computeDerived(row));
  db.get('expositoresEstoque').push(row).write();
  logAudit({ user: req.user, entityType: 'expositorEstoque', entityId: row.id, entityLabel: row.descricaoEntrada || row.codigoEntrada, action: 'create' });
  res.json({ item: row });
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

// 144ª rodada, pedido da Raquel: "na aba de lançamento mensal no budget,
// deve ter a opção de excluir o lançamento total mensal também" -- até
// aqui só dava pra lançar (criar/substituir), nunca pra tirar de vez.
// Exclui os 2 lugares de uma vez (mesmo espírito de sempre: nunca deixar
// lançamento "fantasma" no Budget) -- o registro de histórico aqui E o
// budgetEntry que ele tinha gerado, se ainda existir.
router.delete('/lancamentos-mensais/:id', requireAuth, requireExpositoresEdit, (req, res) => {
  const existing = db.get('expositoresLancamentosMensais').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });
  if (existing.budgetEntryId) db.get('budgetEntries').remove({ id: existing.budgetEntryId }).write();
  db.get('expositoresLancamentosMensais').remove({ id: req.params.id }).write();
  logAudit({ user: req.user, entityType: 'expositoresLancamentoMensal', entityId: existing.id, entityLabel: `${BRAND_LABEL_PT[existing.brand]} · ${existing.month}/${existing.year}`, action: 'delete' });
  res.json({ ok: true });
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

// ---------- Book Técnico (78ª rodada, pedido explícito da Raquel: "book
// tecnico será um arquivo, igual catalogo") -- a tela nasceu só como
// navegação em branco na 46ª rodada ("deixe em branco por enquanto, só
// crie ele no sub menu"); agora vira arquivo por marca de verdade, mesmo
// módulo genérico do Catálogo (coleção separada -- 3 "catálogos"
// diferentes agora: Produtos, Expositores e Book Técnico).
router.use('/book-tecnico', makeCatalogFileRouter({
  collectionName: 'expositoresBookTecnicoFiles',
  uploadsSubdir: 'expositores-book-tecnico',
  brands: BRANDS,
  brandLabelPt: BRAND_LABEL_PT,
  permissionKey: 'expositores',
  resourceLabel: 'Book Técnico de Expositores'
}));

// ---------- Orçamentos (78ª rodada) ----------
// Pedido detalhado da Raquel: "Orçamento deve ter: Nome do expositor, ano
// de lançamento, imagens, desenho técnico, a imagem dele deve aparecer ao
// lado do nome, para ficar mais visual, empresas orçadas (deve ser
// semelhante a uma planilha, para poder comparar qual o melhor orçamento
// para esse expositor (deve ter Fornecedor, valor, material, prazo de
// entrega, pedido minimo). Deve ter a opção de cadastrar quantos
// fornecedores forem necessários para esse expositor. Quando selecionar
// um, deve ter qual foi o fornecedor escolhido."
//
// Cada "expositor orçado" é um documento (`expositoresOrcamentos`) com:
// nome, ano de lançamento, uma lista de imagens e outra de arquivos de
// desenho técnico (qualquer quantidade, mesmo padrão de upload usado no
// resto da Plataforma -- soma, nunca substitui sozinho), e uma lista de
// "empresas orçadas" (`fornecedores`, sem limite de quantos) -- no máximo
// 1 marcada como escolhida por vez (marcar uma desmarca a anterior
// automaticamente, não dá pra ter 2 "escolhidas" ao mesmo tempo).
//
// Sem link externo por enquanto (a Raquel não pediu pra esse recurso
// específico, diferente de Catálogo/Book Técnico/Controle de Expositores)
// -- limite consciente de escopo, registrado no handoff.
const orcamentoUploadsRoot = path.join(__dirname, '..', 'data', 'uploads', 'expositores-orcamentos');
const orcamentoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(orcamentoUploadsRoot, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, Date.now() + '-' + safe);
  }
});
// 50MB por arquivo -- generoso pra imagem/desenho técnico em boa
// resolução, sem chegar no limite de 1GB usado pra vídeo em Demandas.
const uploadOrcamento = multer({ storage: orcamentoStorage, limits: { fileSize: 50 * 1024 * 1024 } });

function findOrcamentoOr404(req, res) {
  const orc = db.get('expositoresOrcamentos').find({ id: req.params.id }).value();
  if (!orc) {
    res.status(404).json({ error: 'Orçamento não encontrado.' });
    return null;
  }
  return orc;
}

// 144ª rodada -- cada expositor dentro do orçamento (ver comentário grande
// mais abaixo, antes do POST /orcamentos).
function findExpositorEnvolvidoOr404(orc, expositorId, res) {
  const exp = (orc.expositores || []).find((e) => e.id === expositorId);
  if (!exp) {
    res.status(404).json({ error: 'Expositor não encontrado neste orçamento.' });
    return null;
  }
  return exp;
}

function serializeExpositorEnvolvido(exp) {
  return Object.assign({}, exp, {
    imagens: exp.imagens || [],
    desenhoTecnico: exp.desenhoTecnico || [],
    fornecedores: exp.fornecedores || []
  });
}

function serializeOrcamento(orc) {
  return Object.assign({}, orc, {
    expositores: (orc.expositores || []).map(serializeExpositorEnvolvido),
    fluxo: orc.fluxo || null,
    formaPagamento: orc.formaPagamento || '',
    parcelas: orc.parcelas || [],
    arquivoOrcamento: orc.arquivoOrcamento || [],
    aprovado: !!orc.aprovado,
    dataPrimeiroPedido: orc.dataPrimeiroPedido || null
  });
}

router.get('/orcamentos', requireAuth, (req, res) => {
  const { brand } = req.query;
  let rows = db.get('expositoresOrcamentos').value();
  if (brand) rows = rows.filter((r) => r.brand === brand);
  res.json({ canEdit: canEdit(req), items: rows.map(serializeOrcamento) });
});

// 144ª rodada, pedido da Raquel: "em orçamentos, deve ter o fluxo,
// fornecedor (lista puxada do menu fornecedores), arquivo do orçamento, e
// opção de colocar mais de um tipo de expositor no mesmo orçamento...
// Ano de lançamento, forma de pagamento e datas. Deve ter a opção de
// marcar se o orçamento foi aprovado ou não, e aí aparece a opção de
// colocar data do primeiro pedido. Os pedidos de orçamentos fechados não
// devem entrar automaticamente no budget, só entram lá na fase de
// controle" -- reestruturação grande, confirmada com a Raquel antes de
// mexer (perguntas feitas nesta mesma rodada):
//   - a comparação de fornecedores é POR expositor (cada expositor dentro
//     do orçamento tem a própria lista, igual já era antes -- só que
//     agora um orçamento pode ter mais de um expositor).
//   - "datas" é parcelamento de verdade (lista de data+valor), só que só
//     informativo -- NUNCA lança automaticamente no Budget (ela confirmou
//     "os pedidos de orçamentos fechados, não devem entrar
//     automaticamente no budget. Eles só entram lá na fase de controle"
//     -- ou seja, continua sendo só o "Lançar no Budget" de Controle de
//     Expositores, inalterado, que de fato sincroniza).
// Todo orçamento continua nascendo com pelo meno 1 expositor (o nome
// pedido na criação) -- outros entram depois por
// POST /orcamentos/:id/expositores. Migração dos orçamentos já existentes
// (formato antigo, 1 expositor só, direto no documento) em db.js -- nunca
// perde orçamento real já cadastrado.
router.post('/orcamentos', requireAuth, requireExpositoresEdit, (req, res) => {
  const { brand, nome, anoLancamento, fluxo, formaPagamento } = req.body || {};
  if (!BRANDS.includes(brand)) return res.status(400).json({ error: 'Escolha a marca.' });
  if (!str(nome)) return res.status(400).json({ error: 'Informe o nome do expositor.' });
  const now = new Date().toISOString();
  const orc = {
    id: nanoid(),
    brand,
    anoLancamento: numOrNull(anoLancamento),
    fluxo: fluxo && (FLUXOS_BY_BRAND[brand] || []).includes(fluxo) ? fluxo : null,
    formaPagamento: str(formaPagamento),
    parcelas: [],
    arquivoOrcamento: [],
    aprovado: false,
    dataPrimeiroPedido: null,
    expositores: [{ id: nanoid(), nome: str(nome), imagens: [], desenhoTecnico: [], fornecedores: [] }],
    createdAt: now,
    createdBy: req.user.id,
    updatedAt: now
  };
  db.get('expositoresOrcamentos').push(orc).write();
  logAudit({ user: req.user, entityType: 'expositorOrcamento', entityId: orc.id, entityLabel: nome, action: 'create' });
  res.json({ item: serializeOrcamento(orc) });
});

// Campos do ORÇAMENTO em si (não de um expositor específico dentro dele).
router.put('/orcamentos/:id', requireAuth, requireExpositoresEdit, (req, res) => {
  const orc = findOrcamentoOr404(req, res);
  if (!orc) return;
  const { anoLancamento, fluxo, formaPagamento, aprovado, dataPrimeiroPedido } = req.body || {};
  const updates = { updatedAt: new Date().toISOString() };
  if (anoLancamento !== undefined) updates.anoLancamento = numOrNull(anoLancamento);
  if (fluxo !== undefined) updates.fluxo = fluxo && (FLUXOS_BY_BRAND[orc.brand] || []).includes(fluxo) ? fluxo : null;
  if (formaPagamento !== undefined) updates.formaPagamento = str(formaPagamento);
  if (aprovado !== undefined) updates.aprovado = !!aprovado;
  // "data do primeiro pedido" só faz sentido com o orçamento aprovado --
  // aceita o valor de qualquer forma (nunca trava a edição por ordem de
  // cliques), só o FRONT que só mostra o campo quando aprovado=true.
  if (dataPrimeiroPedido !== undefined) updates.dataPrimeiroPedido = str(dataPrimeiroPedido) || null;
  db.get('expositoresOrcamentos').find({ id: orc.id }).assign(updates).write();
  logAudit({ user: req.user, entityType: 'expositorOrcamento', entityId: orc.id, entityLabel: (orc.expositores || []).map((e) => e.nome).join(', '), action: 'update' });
  res.json({ item: serializeOrcamento(db.get('expositoresOrcamentos').find({ id: orc.id }).value()) });
});

router.delete('/orcamentos/:id', requireAuth, requireExpositoresEdit, (req, res) => {
  const orc = findOrcamentoOr404(req, res);
  if (!orc) return;
  db.get('expositoresOrcamentos').remove({ id: orc.id }).write();
  const dir = path.join(orcamentoUploadsRoot, orc.id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  logAudit({ user: req.user, entityType: 'expositorOrcamento', entityId: orc.id, entityLabel: (orc.expositores || []).map((e) => e.nome).join(', '), action: 'delete' });
  res.json({ ok: true });
});

// ---- lista de "tipos de expositor" dentro do mesmo orçamento (144ª
// rodada) -- cada um com seu nome/imagens/desenho técnico/fornecedores
// próprios. Nunca deixa ficar sem nenhum (um orçamento sempre representa
// pelo menos 1 expositor). ----
router.post('/orcamentos/:id/expositores', requireAuth, requireExpositoresEdit, (req, res) => {
  const orc = findOrcamentoOr404(req, res);
  if (!orc) return;
  const { nome } = req.body || {};
  if (!str(nome)) return res.status(400).json({ error: 'Informe o nome do expositor.' });
  const novoExpositor = { id: nanoid(), nome: str(nome), imagens: [], desenhoTecnico: [], fornecedores: [] };
  const expositores = (orc.expositores || []).concat([novoExpositor]);
  db.get('expositoresOrcamentos').find({ id: orc.id }).assign({ expositores, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'expositorOrcamento', entityId: orc.id, entityLabel: nome, action: 'update', details: `Expositor "${nome}" adicionado ao orçamento` });
  res.json({ item: serializeOrcamento(db.get('expositoresOrcamentos').find({ id: orc.id }).value()) });
});

router.put('/orcamentos/:id/expositores/:expositorId', requireAuth, requireExpositoresEdit, (req, res) => {
  const orc = findOrcamentoOr404(req, res);
  if (!orc) return;
  if (!findExpositorEnvolvidoOr404(orc, req.params.expositorId, res)) return;
  const { nome } = req.body || {};
  if (!str(nome)) return res.status(400).json({ error: 'Informe o nome do expositor.' });
  const expositores = (orc.expositores || []).map((e) => (e.id === req.params.expositorId ? Object.assign({}, e, { nome: str(nome) }) : e));
  db.get('expositoresOrcamentos').find({ id: orc.id }).assign({ expositores, updatedAt: new Date().toISOString() }).write();
  res.json({ item: serializeOrcamento(db.get('expositoresOrcamentos').find({ id: orc.id }).value()) });
});

router.delete('/orcamentos/:id/expositores/:expositorId', requireAuth, requireExpositoresEdit, (req, res) => {
  const orc = findOrcamentoOr404(req, res);
  if (!orc) return;
  const alvo = findExpositorEnvolvidoOr404(orc, req.params.expositorId, res);
  if (!alvo) return;
  if ((orc.expositores || []).length <= 1) {
    return res.status(400).json({ error: 'Um orçamento precisa ter pelo menos 1 expositor -- exclua o orçamento inteiro em vez disso.' });
  }
  const expositores = (orc.expositores || []).filter((e) => e.id !== req.params.expositorId);
  db.get('expositoresOrcamentos').find({ id: orc.id }).assign({ expositores, updatedAt: new Date().toISOString() }).write();
  // imagens/desenho técnico desse expositor ficam órfãs em disco (mesma
  // pasta do orçamento inteiro, sem separação por expositor até aqui) --
  // removidas 1 por 1, nunca apaga a pasta toda (os outros expositores
  // continuam com arquivos lá).
  (alvo.imagens || []).concat(alvo.desenhoTecnico || []).forEach((f) => {
    const diskPath = path.join(__dirname, '..', 'data', f.url.replace(/^\//, ''));
    if (fs.existsSync(diskPath)) { try { fs.rmSync(diskPath, { force: true }); } catch (e) { /* ignora */ } }
  });
  logAudit({ user: req.user, entityType: 'expositorOrcamento', entityId: orc.id, entityLabel: alvo.nome, action: 'update', details: `Expositor "${alvo.nome}" removido do orçamento` });
  res.json({ item: serializeOrcamento(db.get('expositoresOrcamentos').find({ id: orc.id }).value()) });
});

// ---- imagens (por expositor dentro do orçamento, várias, cada upload
// soma -- nunca substitui sozinho) ----
router.post('/orcamentos/:id/expositores/:expositorId/imagens', requireAuth, requireExpositoresEdit, uploadOrcamento.array('files', 20), (req, res) => {
  const orc = findOrcamentoOr404(req, res);
  if (!orc) return;
  const exp = findExpositorEnvolvidoOr404(orc, req.params.expositorId, res);
  if (!exp) return;
  const files = (req.files || []).map((f) => ({
    id: nanoid(), name: f.originalname, url: `/uploads/expositores-orcamentos/${orc.id}/${f.filename}`
  }));
  if (files.length === 0) return res.status(400).json({ error: 'Selecione ao menos uma imagem.' });
  const imagens = (exp.imagens || []).concat(files);
  const expositores = (orc.expositores || []).map((e) => (e.id === exp.id ? Object.assign({}, e, { imagens }) : e));
  db.get('expositoresOrcamentos').find({ id: orc.id }).assign({ expositores, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'expositorOrcamento', entityId: orc.id, entityLabel: exp.nome, action: 'update', details: `${files.length} imagem(ns) adicionada(s)` });
  res.json({ item: serializeOrcamento(db.get('expositoresOrcamentos').find({ id: orc.id }).value()) });
});

router.delete('/orcamentos/:id/expositores/:expositorId/imagens/:fileId', requireAuth, requireExpositoresEdit, (req, res) => {
  const orc = findOrcamentoOr404(req, res);
  if (!orc) return;
  const exp = findExpositorEnvolvidoOr404(orc, req.params.expositorId, res);
  if (!exp) return;
  const target = (exp.imagens || []).find((f) => f.id === req.params.fileId);
  if (!target) return res.status(404).json({ error: 'Imagem não encontrada.' });
  const imagens = (exp.imagens || []).filter((f) => f.id !== req.params.fileId);
  const expositores = (orc.expositores || []).map((e) => (e.id === exp.id ? Object.assign({}, e, { imagens }) : e));
  db.get('expositoresOrcamentos').find({ id: orc.id }).assign({ expositores, updatedAt: new Date().toISOString() }).write();
  const diskPath = path.join(__dirname, '..', 'data', target.url.replace(/^\//, ''));
  if (fs.existsSync(diskPath)) fs.rmSync(diskPath, { force: true });
  res.json({ item: serializeOrcamento(db.get('expositoresOrcamentos').find({ id: orc.id }).value()) });
});

// ---- desenho técnico (por expositor, mesmo padrão das imagens) ----
router.post('/orcamentos/:id/expositores/:expositorId/desenho-tecnico', requireAuth, requireExpositoresEdit, uploadOrcamento.array('files', 20), (req, res) => {
  const orc = findOrcamentoOr404(req, res);
  if (!orc) return;
  const exp = findExpositorEnvolvidoOr404(orc, req.params.expositorId, res);
  if (!exp) return;
  const files = (req.files || []).map((f) => ({
    id: nanoid(), name: f.originalname, url: `/uploads/expositores-orcamentos/${orc.id}/${f.filename}`
  }));
  if (files.length === 0) return res.status(400).json({ error: 'Selecione ao menos um arquivo.' });
  const desenhoTecnico = (exp.desenhoTecnico || []).concat(files);
  const expositores = (orc.expositores || []).map((e) => (e.id === exp.id ? Object.assign({}, e, { desenhoTecnico }) : e));
  db.get('expositoresOrcamentos').find({ id: orc.id }).assign({ expositores, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'expositorOrcamento', entityId: orc.id, entityLabel: exp.nome, action: 'update', details: `${files.length} arquivo(s) de desenho técnico adicionado(s)` });
  res.json({ item: serializeOrcamento(db.get('expositoresOrcamentos').find({ id: orc.id }).value()) });
});

router.delete('/orcamentos/:id/expositores/:expositorId/desenho-tecnico/:fileId', requireAuth, requireExpositoresEdit, (req, res) => {
  const orc = findOrcamentoOr404(req, res);
  if (!orc) return;
  const exp = findExpositorEnvolvidoOr404(orc, req.params.expositorId, res);
  if (!exp) return;
  const target = (exp.desenhoTecnico || []).find((f) => f.id === req.params.fileId);
  if (!target) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  const desenhoTecnico = (exp.desenhoTecnico || []).filter((f) => f.id !== req.params.fileId);
  const expositores = (orc.expositores || []).map((e) => (e.id === exp.id ? Object.assign({}, e, { desenhoTecnico }) : e));
  db.get('expositoresOrcamentos').find({ id: orc.id }).assign({ expositores, updatedAt: new Date().toISOString() }).write();
  const diskPath = path.join(__dirname, '..', 'data', target.url.replace(/^\//, ''));
  if (fs.existsSync(diskPath)) fs.rmSync(diskPath, { force: true });
  res.json({ item: serializeOrcamento(db.get('expositoresOrcamentos').find({ id: orc.id }).value()) });
});

// ---- arquivo do orçamento em si (144ª rodada, pedido da Raquel: "arquivo
// do orçamento") -- NO NÍVEL DO ORÇAMENTO, não por expositor (é o
// documento/PDF da cotação inteira, não uma imagem de um expositor
// específico). Mesmo padrão de sempre: soma, nunca substitui sozinho. ----
router.post('/orcamentos/:id/arquivo', requireAuth, requireExpositoresEdit, uploadOrcamento.array('files', 20), (req, res) => {
  const orc = findOrcamentoOr404(req, res);
  if (!orc) return;
  const files = (req.files || []).map((f) => ({
    id: nanoid(), name: f.originalname, url: `/uploads/expositores-orcamentos/${orc.id}/${f.filename}`
  }));
  if (files.length === 0) return res.status(400).json({ error: 'Selecione ao menos um arquivo.' });
  const arquivoOrcamento = (orc.arquivoOrcamento || []).concat(files);
  db.get('expositoresOrcamentos').find({ id: orc.id }).assign({ arquivoOrcamento, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'expositorOrcamento', entityId: orc.id, entityLabel: (orc.expositores || []).map((e) => e.nome).join(', '), action: 'update', details: `${files.length} arquivo(s) do orçamento adicionado(s)` });
  res.json({ item: serializeOrcamento(db.get('expositoresOrcamentos').find({ id: orc.id }).value()) });
});

router.delete('/orcamentos/:id/arquivo/:fileId', requireAuth, requireExpositoresEdit, (req, res) => {
  const orc = findOrcamentoOr404(req, res);
  if (!orc) return;
  const target = (orc.arquivoOrcamento || []).find((f) => f.id === req.params.fileId);
  if (!target) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  const arquivoOrcamento = (orc.arquivoOrcamento || []).filter((f) => f.id !== req.params.fileId);
  db.get('expositoresOrcamentos').find({ id: orc.id }).assign({ arquivoOrcamento, updatedAt: new Date().toISOString() }).write();
  const diskPath = path.join(__dirname, '..', 'data', target.url.replace(/^\//, ''));
  if (fs.existsSync(diskPath)) fs.rmSync(diskPath, { force: true });
  res.json({ item: serializeOrcamento(db.get('expositoresOrcamentos').find({ id: orc.id }).value()) });
});

// ---- parcelamento (144ª rodada, pedido da Raquel: "forma de pagamento e
// datas" -- confirmado com ela que é parcelamento de verdade, data+valor
// por parcela, mas SÓ INFORMATIVO: "os pedidos de orçamentos fechados,
// não devem entrar automaticamente no budget. Eles só entram lá na fase
// de controle" -- diferente de Brindes Compras/Influencers (155ª rodada),
// aqui NUNCA cria lançamento em budgetEntries. Quem sincroniza com o
// Budget continua sendo só "Lançar no Budget" de Controle de Expositores,
// que ela confirmou que já está OK do jeito que é. ----
router.post('/orcamentos/:id/parcelas', requireAuth, requireExpositoresEdit, (req, res) => {
  const orc = findOrcamentoOr404(req, res);
  if (!orc) return;
  const { valor, dataPagamento } = req.body || {};
  const valorNum = numOrNull(valor);
  if (valorNum === null) return res.status(400).json({ error: 'Informe o valor da parcela.' });
  const now = new Date().toISOString();
  const parcela = { id: nanoid(), valor: valorNum, dataPagamento: str(dataPagamento) || null, pago: false, createdAt: now, updatedAt: now };
  const parcelas = (orc.parcelas || []).concat([parcela]);
  db.get('expositoresOrcamentos').find({ id: orc.id }).assign({ parcelas, updatedAt: now }).write();
  res.json({ item: serializeOrcamento(db.get('expositoresOrcamentos').find({ id: orc.id }).value()) });
});

router.put('/orcamentos/:id/parcelas/:parcelaId', requireAuth, requireExpositoresEdit, (req, res) => {
  const orc = findOrcamentoOr404(req, res);
  if (!orc) return;
  const before = (orc.parcelas || []).find((p) => p.id === req.params.parcelaId);
  if (!before) return res.status(404).json({ error: 'Parcela não encontrada.' });
  const { valor, dataPagamento, pago } = req.body || {};
  const now = new Date().toISOString();
  const patch = { updatedAt: now };
  if (valor !== undefined) patch.valor = numOrNull(valor);
  if (dataPagamento !== undefined) patch.dataPagamento = str(dataPagamento) || null;
  if (pago !== undefined) patch.pago = !!pago;
  const parcelas = (orc.parcelas || []).map((p) => (p.id === req.params.parcelaId ? Object.assign({}, p, patch) : p));
  db.get('expositoresOrcamentos').find({ id: orc.id }).assign({ parcelas, updatedAt: now }).write();
  res.json({ item: serializeOrcamento(db.get('expositoresOrcamentos').find({ id: orc.id }).value()) });
});

router.delete('/orcamentos/:id/parcelas/:parcelaId', requireAuth, requireExpositoresEdit, (req, res) => {
  const orc = findOrcamentoOr404(req, res);
  if (!orc) return;
  const parcelas = (orc.parcelas || []).filter((p) => p.id !== req.params.parcelaId);
  db.get('expositoresOrcamentos').find({ id: orc.id }).assign({ parcelas, updatedAt: new Date().toISOString() }).write();
  res.json({ item: serializeOrcamento(db.get('expositoresOrcamentos').find({ id: orc.id }).value()) });
});

// ---- empresas orçadas ("fornecedores"), por expositor -- planilha
// comparativa, quantas forem necessárias, no máximo 1 marcada como
// escolhida. Confirmado com a Raquel que fica POR expositor (não 1 lista
// só pro orçamento inteiro). O campo `fornecedor` continua texto livre
// (nunca referência rígida a um cadastro) -- o FRONT sugere os já
// cadastrados em Fornecedores (datalist, GET /api/fornecedores), mesmo
// padrão já usado em Brindes Compras (155ª rodada), mas sempre aceita
// digitar um nome novo também. ----
router.post('/orcamentos/:id/expositores/:expositorId/fornecedores', requireAuth, requireExpositoresEdit, (req, res) => {
  const orc = findOrcamentoOr404(req, res);
  if (!orc) return;
  const exp = findExpositorEnvolvidoOr404(orc, req.params.expositorId, res);
  if (!exp) return;
  const { fornecedor, valor, material, prazoEntrega, pedidoMinimo, data } = req.body || {};
  if (!str(fornecedor)) return res.status(400).json({ error: 'Informe o nome do fornecedor.' });
  const linha = {
    id: nanoid(),
    fornecedor: str(fornecedor),
    data: str(data) || null,
    valor: numOrNull(valor),
    material: str(material),
    prazoEntrega: str(prazoEntrega),
    pedidoMinimo: str(pedidoMinimo),
    escolhido: false,
    createdAt: new Date().toISOString()
  };
  const fornecedores = (exp.fornecedores || []).concat([linha]);
  const expositores = (orc.expositores || []).map((e) => (e.id === exp.id ? Object.assign({}, e, { fornecedores }) : e));
  db.get('expositoresOrcamentos').find({ id: orc.id }).assign({ expositores, updatedAt: new Date().toISOString() }).write();
  logAudit({ user: req.user, entityType: 'expositorOrcamento', entityId: orc.id, entityLabel: exp.nome, action: 'update', details: `Fornecedor adicionado: ${linha.fornecedor}` });
  res.json({ item: serializeOrcamento(db.get('expositoresOrcamentos').find({ id: orc.id }).value()) });
});

router.put('/orcamentos/:id/expositores/:expositorId/fornecedores/:fornecedorId', requireAuth, requireExpositoresEdit, (req, res) => {
  const orc = findOrcamentoOr404(req, res);
  if (!orc) return;
  const exp = findExpositorEnvolvidoOr404(orc, req.params.expositorId, res);
  if (!exp) return;
  const fornecedores = exp.fornecedores || [];
  const alvo = fornecedores.find((f) => f.id === req.params.fornecedorId);
  if (!alvo) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
  const { fornecedor, valor, material, prazoEntrega, pedidoMinimo, escolhido, data } = req.body || {};
  const novaLista = fornecedores.map((f) => {
    if (f.id !== req.params.fornecedorId) {
      return escolhido === true ? Object.assign({}, f, { escolhido: false }) : f;
    }
    const atualizado = Object.assign({}, f);
    if (fornecedor !== undefined) atualizado.fornecedor = str(fornecedor) || f.fornecedor;
    if (valor !== undefined) atualizado.valor = numOrNull(valor);
    if (material !== undefined) atualizado.material = str(material);
    if (prazoEntrega !== undefined) atualizado.prazoEntrega = str(prazoEntrega);
    if (pedidoMinimo !== undefined) atualizado.pedidoMinimo = str(pedidoMinimo);
    if (data !== undefined) atualizado.data = str(data) || null;
    if (escolhido !== undefined) atualizado.escolhido = !!escolhido;
    return atualizado;
  });
  const expositores = (orc.expositores || []).map((e) => (e.id === exp.id ? Object.assign({}, e, { fornecedores: novaLista }) : e));
  db.get('expositoresOrcamentos').find({ id: orc.id }).assign({ expositores, updatedAt: new Date().toISOString() }).write();
  res.json({ item: serializeOrcamento(db.get('expositoresOrcamentos').find({ id: orc.id }).value()) });
});

router.delete('/orcamentos/:id/expositores/:expositorId/fornecedores/:fornecedorId', requireAuth, requireExpositoresEdit, (req, res) => {
  const orc = findOrcamentoOr404(req, res);
  if (!orc) return;
  const exp = findExpositorEnvolvidoOr404(orc, req.params.expositorId, res);
  if (!exp) return;
  const fornecedores = (exp.fornecedores || []).filter((f) => f.id !== req.params.fornecedorId);
  const expositores = (orc.expositores || []).map((e) => (e.id === exp.id ? Object.assign({}, e, { fornecedores }) : e));
  db.get('expositoresOrcamentos').find({ id: orc.id }).assign({ expositores, updatedAt: new Date().toISOString() }).write();
  res.json({ item: serializeOrcamento(db.get('expositoresOrcamentos').find({ id: orc.id }).value()) });
});

module.exports = router;
