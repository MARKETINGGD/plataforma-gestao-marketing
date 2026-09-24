// Módulo genérico pra "1 arquivo atual por marca" (68ª rodada, pedidos
// separados da Raquel: catálogo em Produtos e catálogo em Expositores --
// mesma mecânica exata nos dois, só a coleção/pasta/permissão mudam).
// Upload substitui o arquivo anterior daquela marca (que é apagado do
// disco) -- nunca guarda histórico de versões, é sempre "o catálogo
// atualizado", como a Raquel pediu.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { nanoid } = require('./id');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('./audit');
const { resolveUserName } = require('./names');

// `opts`: { collectionName, uploadsSubdir, brands, brandLabelPt,
// permissionKey, resourceLabel }
function makeCatalogFileRouter(opts) {
  const { collectionName, uploadsSubdir, brands, brandLabelPt, permissionKey, resourceLabel } = opts;
  const router = express.Router();
  const uploadsRoot = path.join(__dirname, '..', 'data', 'uploads', uploadsSubdir);

  function canEdit(req) {
    const user = db.get('users').find({ id: req.user.id }).value();
    if (!user) return false;
    if (user.isSuperAdmin) return true;
    const access = (user.permissions || {})[permissionKey] || 'none';
    return access === 'editor' || access === 'admin';
  }
  function requireEdit(req, res, next) {
    if (!canEdit(req)) return res.status(403).json({ error: `Você não tem permissão para editar ${resourceLabel}.` });
    next();
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(uploadsRoot, req.params.brand);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
      cb(null, Date.now() + '-' + safe);
    }
  });
  const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } }); // 200MB — arquivo de catálogo (PDF/imagens), não vídeo

  function serialize(row) {
    if (!row) return null;
    return Object.assign({}, row, { uploadedByName: resolveUserName(row.uploadedBy, row.uploadedByName) });
  }

  router.get('/', requireAuth, (req, res) => {
    const items = brands.map((brand) => ({
      brand,
      brandLabel: brandLabelPt[brand] || brand,
      file: serialize(db.get(collectionName).find({ brand }).value())
    }));
    res.json({ canEdit: canEdit(req), items });
  });

  router.post('/:brand', requireAuth, requireEdit, (req, res, next) => {
    if (!brands.includes(req.params.brand)) return res.status(400).json({ error: 'Marca inválida.' });
    next();
  }, upload.single('file'), (req, res) => {
    const { brand } = req.params;
    if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
    const existing = db.get(collectionName).find({ brand }).value();
    if (existing && existing.fileUrl) {
      const oldPath = path.join(uploadsRoot, brand, path.basename(existing.fileUrl));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    const fileData = {
      brand,
      fileName: req.file.originalname,
      fileUrl: `/uploads/${uploadsSubdir}/${brand}/${req.file.filename}`,
      fileSize: req.file.size,
      uploadedAt: new Date().toISOString(),
      uploadedBy: req.user.id,
      uploadedByName: req.user.name
    };
    if (existing) {
      db.get(collectionName).find({ brand }).assign(fileData).write();
    } else {
      db.get(collectionName).push(Object.assign({ id: nanoid() }, fileData)).write();
    }
    logAudit({ user: req.user, entityType: 'catalogoArquivo', entityId: `${collectionName}:${brand}`, entityLabel: `${resourceLabel} · ${brandLabelPt[brand] || brand}`, action: existing ? 'update' : 'create', details: `Catálogo atualizado: ${fileData.fileName}` });
    res.json({ file: serialize(db.get(collectionName).find({ brand }).value()) });
  });

  router.delete('/:brand', requireAuth, requireEdit, (req, res) => {
    const { brand } = req.params;
    const existing = db.get(collectionName).find({ brand }).value();
    if (!existing) return res.status(404).json({ error: 'Nenhum arquivo cadastrado pra essa marca.' });
    if (existing.fileUrl) {
      const filePath = path.join(uploadsRoot, brand, path.basename(existing.fileUrl));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    db.get(collectionName).remove({ brand }).write();
    logAudit({ user: req.user, entityType: 'catalogoArquivo', entityId: `${collectionName}:${brand}`, entityLabel: `${resourceLabel} · ${brandLabelPt[brand] || brand}`, action: 'delete' });
    res.json({ ok: true });
  });

  return router;
}

module.exports = { makeCatalogFileRouter };
