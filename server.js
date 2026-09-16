require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(express.json());

// Pasta onde ficam os anexos das Demandas — no mesmo volume de dados usado
// pelo db.json, então sobrevive aos deploys.
const uploadsDir = path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboards', require('./routes/dashboards'));
app.use('/api/budget', require('./routes/budget'));
app.use('/api/demandas', require('./routes/demandas'));
app.use('/api/labels', require('./routes/labels'));
app.use('/api/recados', require('./routes/recados'));
app.use('/api/social-posts', require('./routes/socialPosts'));
app.use('/api/brindes', require('./routes/brindes'));
app.use('/api/influencers', require('./routes/influencers'));

// Evita o navegador servir um index.html/app.js antigo depois de um deploy
// (mesmo ajuste já usado no dashboard de Ações Sazonais).
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-cache');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handler de erro — garante que erro de upload (arquivo grande demais, etc.)
// volta como JSON pro frontend em vez de uma página de erro quebrada.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Esse arquivo é maior que o limite atual (1GB por arquivo). Tente um arquivo menor ou comprimido.' });
    }
    return res.status(400).json({ error: 'Não foi possível enviar o arquivo: ' + err.message });
  }
  if (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro inesperado no servidor.' });
  }
  next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Plataforma de Gestão de Marketing rodando na porta ${PORT}`);
});
