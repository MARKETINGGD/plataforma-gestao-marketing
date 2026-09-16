require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

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
app.use('/api/brindes', require('./routes/brindes'));

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Plataforma de Gestão de Marketing rodando na porta ${PORT}`);
});
