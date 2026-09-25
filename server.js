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
// Conectar Agendamento de Redes Sociais à API de verdade da Meta (54ª
// rodada) — ver routes/socialAccounts.js.
app.use('/api/social-accounts', require('./routes/socialAccounts'));
app.use('/api/brindes', require('./routes/brindes'));
app.use('/api/retiradas-internas', require('./routes/retiradasInternas'));
app.use('/api/influencers', require('./routes/influencers'));
app.use('/api/produtos', require('./routes/produtos'));
app.use('/api/expositores', require('./routes/expositores'));
app.use('/api/feiras', require('./routes/feiras'));
app.use('/api/integrations', require('./routes/integrations'));
app.use('/api/chat', require('./routes/chat'));
// Campanha Cooperada (43ª rodada) — ver routes/campanhaCooperada.js.
app.use('/api/campanha-cooperada', require('./routes/campanhaCooperada'));
// Link externo genérico (66ª rodada) — só o resolvedor "de qual recurso é
// esse token" mora aqui; cada recurso mantém seu próprio GET /public/:token
// com os dados de verdade (ver routes/budget.js, feiras.js, brindes.js,
// campanhaCooperada.js).
app.use('/api/share-links', require('./routes/shareLinksPublic'));

// Importação automática (só roda uma vez) do orçamento 2026 real da
// GhelPlus e da De Bacco, vindo das planilhas oficiais — agora linha a
// linha (25ª rodada: fornecedor, título da compra e quantidade por
// lançamento), substituindo os agregados por categoria/mês das rodadas
// 23/24 — ver utils/seedBudget2026GhelplusGranular.js e
// utils/seedBudget2026DebaccoGranular.js (a migração segura de agregado
// pra granular está documentada em cada um desses arquivos).
require('./utils/seedBudget2026GhelplusGranular').seedBudget2026GhelplusGranular();
require('./utils/seedBudget2026DebaccoGranular').seedBudget2026DebaccoGranular();
// 41ª rodada: importação única do histórico de feiras (FEICON/GhelPlus
// 2025+2026 — ver utils/seedFeirasGhelplus2025_2026.js). ExpoRevestir/De
// Bacco entrou na 42ª rodada, quando a Raquel mandou o link certo — ver
// utils/seedFeirasExporevestirDebacco2025_2026.js.
require('./utils/seedFeirasGhelplus2025_2026').seedFeirasGhelplus2025_2026();
require('./utils/seedFeirasExporevestirDebacco2025_2026').seedFeirasExporevestirDebacco2025_2026();
// 34ª rodada: completa retroativamente demandas ligadas a agendamentos
// já publicados, ou a grupos onde alguém já tinha concluído manualmente
// antes desse recurso existir (ver utils/demandCascade.js).
require('./utils/migrateAutoCompleteDemandasFromPosts').migrateAutoCompleteDemandasFromPosts();
// 36ª rodada: dá lastCompletedAt retroativo pra demanda já concluída antes
// desse campo existir (ver utils/migrateLastCompletedAt.js).
require('./utils/migrateLastCompletedAt').migrateLastCompletedAt();
// 37ª rodada: dá `brand` retroativo pra demanda que já veio de um
// agendamento/ação de influencer antes desse campo existir (ver
// utils/migrateDemandaBrand.js).
require('./utils/migrateDemandaBrand').migrateDemandaBrand();
// 42ª rodada: dá `concorrentes[]` retroativo pra análise de concorrência
// criada antes da tela suportar várias marcas por análise (ver
// utils/migrateConcorrenciaMultiMarca.js), e importa (uma vez só) a
// planilha "PRODUTOS GHELPLUS" que a Raquel mandou (GhelPlus x
// Tramontina/Forminox/Fabrinox — ver
// utils/seedConcorrenciaGhelplusImport2026.js).
require('./utils/migrateConcorrenciaMultiMarca').migrateConcorrenciaMultiMarca();
require('./utils/seedConcorrenciaGhelplusImport2026').seedConcorrenciaGhelplusImport2026();
// 47ª rodada: importação única dos horários de ponto que a Raquel mandou
// por print, casando pelo nome já cadastrado (ver
// utils/migratePontoScheduleInicial.js).
require('./utils/migratePontoScheduleInicial').migratePontoScheduleInicial();

// 47ª rodada: lembretes automáticos de bater o ponto (5 min antes/depois
// de cada horário cadastrado por pessoa, só dias úteis) — primeiro recurso
// da Plataforma que precisa de um temporizador de verdade rodando sozinho
// no servidor (ver utils/pontoReminders.js).
require('./utils/pontoReminders').startPontoReminderScheduler();

// 54ª rodada: publicador automático da Meta -- checa a cada 2 minutos se
// tem post de Instagram/Facebook (estático) com a data/hora batendo e conta
// conectada, e publica sozinho (ver utils/metaPublisher.js).
require('./utils/metaPublisher').startMetaPublisherScheduler();

// 67ª rodada: mesma ideia, agora pra LinkedIn -- checa a cada 2 minutos se
// tem post de LinkedIn com a data/hora batendo e conta conectada (ver
// utils/linkedinPublisher.js). Ainda sem nenhum teste real -- depende da
// Raquel terminar a aprovação do App na LinkedIn primeiro (ver
// PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md, seção 7).
require('./utils/linkedinPublisher').startLinkedInPublisherScheduler();

// 69ª rodada: mesma ideia, agora pro YouTube -- checa a cada 2 minutos se
// tem "Vídeo YouTube" com a data/hora batendo e conta conectada (ver
// utils/youtubePublisher.js). Publica direto como público (Opção A,
// decidida com a Raquel em 25/09/2026 -- ver
// PLANO-INTEGRACAO-REDES-SOCIAIS-E-EMAIL.md, seção 8.2).
require('./utils/youtubePublisher').startYouTubePublisherScheduler();

// 75ª rodada: mesma ideia, agora pro Pinterest ("vamos começar com
// pinterest, é apenas de bacco") -- checa a cada 2 minutos se tem "Pin" com
// a data/hora batendo e conta conectada (ver utils/pinterestPublisher.js).
// Só a De Bacco usa Pinterest por enquanto.
require('./utils/pinterestPublisher').startPinterestPublisherScheduler();

// Evita o navegador servir um index.html/app.js antigo depois de um deploy
// (mesmo ajuste já usado no dashboard de Ações Sazonais).
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-cache');
  next();
});

// 32ª rodada, pedido da Raquel: "a plataforma deve ser atualizada tbm por
// f5, hoje não consigo atualizar dessa forma" — o Cache-Control acima já
// pedia pro navegador revalidar antes de reusar o cache, mas isso depende
// do navegador/rede realmente respeitar a revalidação; pra não depender
// disso, o index.html passa a ser servido com um "carimbo de versão"
// (`?v=<hora que este processo subiu>`) colado nas tags de <script> e
// <link> dele. Como essa URL muda sozinha a cada deploy (processo novo =
// timestamp novo), o navegador é obrigado a buscar o app.js/style.css
// novos — um F5 comum passa a bastar, sem precisar de Ctrl+F5/limpar
// cache.
const BUILD_VERSION = String(Date.now());
const indexHtmlRaw = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const indexHtmlVersioned = indexHtmlRaw
  .replace('href="/style.css"', `href="/style.css?v=${BUILD_VERSION}"`)
  .replace('src="/app.js"', `src="/app.js?v=${BUILD_VERSION}"`);
function sendVersionedIndex(req, res) {
  // no-store (mais forte que o no-cache genérico acima) só pro HTML em si
  // — ele é pequeno e é o que decide qual versão de app.js/style.css vai
  // ser buscada, então precisa vir sempre fresco do servidor.
  res.set('Cache-Control', 'no-store');
  res.type('html').send(indexHtmlVersioned);
}

// index:false pra o express não responder "/" com o index.html cru (sem o
// carimbo de versão) antes de chegar nas rotas abaixo.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('*', sendVersionedIndex);

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
