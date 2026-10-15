// Backup completo da Plataforma (rodada de segurança, 15/10/2026) — pedido
// direto da Raquel: "o que falta para deixar 100% segura a plataforma
// papoi? e se der algum problema, tem chance de perdermos o conteúdo?".
//
// Hoje o "banco de dados" da Papoi é só 1 arquivo (`data/db.json`) +
// 1 pasta de arquivos anexados (`data/uploads` — brindes, mídia kit de
// influencer, fotos de perfil, anexos de Demandas, etc.), guardados no
// volume persistente do Railway. Não existe nenhuma rotina automática de
// backup desse conteúdo pra fora do Railway — se o volume falhar, for
// apagado sem querer, ou o projeto for excluído, sem uma cópia feita antes
// esse conteúdo pode ser perdido de vez.
//
// Este endpoint resolve a parte "como eu, Raquel, tiro uma cópia de
// segurança sem mexer em terminal nem no Railway": monta, na hora, um .zip
// com o banco inteiro + todos os arquivos anexados, e manda direto pro
// navegador baixar — só o admin da plataforma (super_admin) consegue
// acessar. Nada fica salvo no servidor durante o processo (o zip é
// construído em stream, direto pra resposta HTTP).
const express = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'db.json');
const uploadsDir = path.join(dataDir, 'uploads');

router.get('/export', requireAuth, requireSuperAdmin, (req, res) => {
  const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const nomeArquivo = `papoi-backup-${carimbo}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  let falhou = false;
  archive.on('warning', (err) => console.warn('[backup] aviso ao gerar o zip:', err.message));
  archive.on('error', (err) => {
    falhou = true;
    console.error('[backup] erro ao gerar o zip:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Não foi possível gerar o backup.' });
  });
  archive.pipe(res);

  if (fs.existsSync(dbPath)) {
    archive.file(dbPath, { name: 'db.json' });
  }
  if (fs.existsSync(uploadsDir)) {
    archive.directory(uploadsDir, 'uploads');
  }

  if (!falhou) {
    logAudit({
      user: req.user,
      entityType: 'sistema',
      entityId: 'backup',
      entityLabel: 'Backup completo (banco + arquivos)',
      action: 'export',
      details: `Backup completo baixado por ${req.user.name || req.user.username}`
    });
  }

  archive.finalize();
});

module.exports = router;
