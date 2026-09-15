require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboards', require('./routes/dashboards'));
app.use('/api/budget', require('./routes/budget'));

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
