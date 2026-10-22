const db = require('../db');
const { nanoid } = require('./id');
const { parseMoneyLabel } = require('./moneyParse');

// 100ª rodada -- importação única (idempotente, só roda se as coleções
// estiverem vazias, mesmo padrão de sempre usado nos outros seeds desta
// base, ex. utils/seedBudget2026GhelplusGranular.js) das planilhas que a
// Raquel colou DIRETO no chat: "CONTROLE DE PAGAMENTOS" (abas Cartão/
// Mensal/Extras) e "CONTROLE DE ASSINATURAS MKT". Pedido explícito dela:
// "use os dados já cadastrados na planilha" -- os valores abaixo são uma
// transcrição fiel do que ela mandou, célula por célula, sem inventar nem
// completar nada que estava em branco na planilha original (campo em
// branco na planilha = string vazia/null aqui, nunca um valor "chutado").
//
// MUITO IMPORTANTE (regra explícita da Raquel, repetida 2x no pedido): "o
// que ja esta na planilha, voce n deve colocar no budget, por que isso eu
// ja fiz manualmente, essa regra de comunicação [com o Budget] só deve
// valer a partir de hoje, das informações que eu adicionar a partir de
// hoje". Por isso TODO registro importado aqui nasce com
// `historicalImport: true` -- ver routes/pagamentos.js, a sincronização
// automática com o Budget (ao marcar "Pago") verifica esse campo
// primeiro e NUNCA lança no Budget um registro com `historicalImport:
// true`, não importa o que aconteça com ele depois (mesmo se alguém
// editar o "Pago" de novo). Só lançamentos criados DE VERDADE pela tela
// (nascem com `historicalImport: false`) entram na sincronização.
function moneyFields(raw) {
  const parsed = parseMoneyLabel(raw);
  return { valorRaw: raw || '', valor: parsed.valor, moeda: parsed.moeda };
}

function marcasFromRaw(raw) {
  if (!raw) return [];
  const RECONHECIDAS = { 'de bacco': 'debacco', debacco: 'debacco', ghelplus: 'ghelplus' };
  return raw.split(',').map((s) => s.trim()).filter(Boolean).map((s) => RECONHECIDAS[s.toLowerCase()] || null);
}

function pagamentoRow(aba, f) {
  const now = new Date().toISOString();
  const money = moneyFields(f.valor);
  return {
    id: nanoid(),
    aba, // 'cartao' | 'mensal' | 'extras'
    mes: f.mes || '',
    ano: 2026,
    fornecedor: f.fornecedor || '',
    codigoFornecedor: f.codigo || '',
    valorRaw: money.valorRaw,
    valor: money.valor,
    moeda: money.moeda,
    tipoPagamento: f.tipoPagamento || '',
    dataPagamento: f.dataPagamento || '',
    status: f.status || '',
    pago: !!f.pago,
    marcaRaw: f.marca || '',
    marcas: marcasFromRaw(f.marca),
    parcela: f.parcela || '',
    dividirFluxo: !!f.dividirFluxo,
    fluxoGerencial: f.fluxoGerencial || '',
    centroCusto: f.centroCusto || '',
    contaContabil: f.contaContabil || '',
    cartao: f.cartao || '',
    emailPara: f.emailPara || '',
    aprovada: !!f.aprovada,
    observacoes: f.observacoes || '',
    arquivos: [],
    historicalImport: true,
    budgetSynced: false,
    budgetEntryIds: [],
    createdAt: now,
    createdBy: null,
    createdByName: 'Importado da planilha (histórico)',
    updatedAt: now
  };
}

function assinaturaRow(f) {
  const now = new Date().toISOString();
  const money = moneyFields(f.preco);
  return {
    id: nanoid(),
    nome: f.nome || '',
    precoRaw: money.valorRaw,
    preco: money.valor,
    moeda: money.moeda,
    tipo: f.tipo || '',
    fluxo: f.fluxo || '',
    pagamento: f.pagamento || '',
    status: f.status || '',
    dataRenovacao: f.dataRenovacao || '',
    observacoes: f.observacoes || '',
    arquivos: [],
    historicalImport: true,
    createdAt: now,
    createdBy: null,
    createdByName: 'Importado da planilha (histórico)',
    updatedAt: now
  };
}

// ---------- CARTÃO ----------
const CARTAO = [
  { mes: 'Abril', fornecedor: 'Freepik', valor: 'R$ 104,58', status: 'Mensal', marca: 'De Bacco, GhelPlus', dividirFluxo: true, fluxoGerencial: '2.5.3.3\n2.5.2.3', centroCusto: '22200 (Marketing)', cartao: 'Carla Visa', emailPara: 'Contábil (Guilherme, Leticia e Matheus), Financeiro (Carla , Vanessa e Tati)', pago: false },
  { mes: 'Abril', fornecedor: 'Hostgator', valor: 'R$ 17,06', status: 'Mensal', marca: 'De Bacco, GhelPlus', dividirFluxo: true, fluxoGerencial: '2.5.2.3 / 2.5.3.3', centroCusto: '22200 (Marketing)', cartao: 'Boleto', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla)', pago: false, observacoes: 'pagamento efetuado, enviar apenas NF' },
  { mes: 'Dezembro', fornecedor: 'Canva', status: 'Anual', marca: 'GhelPlus, De Bacco', dividirFluxo: true, centroCusto: '22200 (Marketing)', cartao: 'Carla Visa', emailPara: 'Contábil (Guilherme, Leticia e Matheus), Financeiro (Carla , Vanessa e Tati)', pago: false },
  { mes: 'Abril', fornecedor: 'Icloud- selo de verificação', valor: 'R$ 254,90', status: 'Mensal', marca: 'De Bacco', dividirFluxo: false, fluxoGerencial: '2.5.3.5', centroCusto: '22200 (Marketing)', cartao: 'Raquel', emailPara: 'Contábil (Guilherme, Leticia e Matheus), Financeiro (Carla , Vanessa e Tati)', pago: false },
  { mes: 'Fevereiro', fornecedor: 'Icloud- selo de verificação', valor: 'R$ 109,00', status: 'Cancelado', marca: 'GhelPlus', dividirFluxo: false, fluxoGerencial: '2.5.2.5', centroCusto: '22200 (Marketing)', cartao: 'Raquel', emailPara: 'Contábil (Guilherme, Leticia e Matheus), Financeiro (Carla , Vanessa e Tati)', pago: false, observacoes: 'Verificar e retornar a assinatura urgente' },
  { mes: 'Abril', fornecedor: 'Google One', status: 'Mensal', dividirFluxo: false, centroCusto: '22200 (Marketing)', cartao: 'Raquel', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla e Tati)', pago: false },
  { mes: 'Abril', fornecedor: 'Facebook', status: 'Mensal', dividirFluxo: false, centroCusto: '22200 (Marketing)', cartao: 'Carla Visa', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla e Tati)', pago: false },
  { mes: 'Abril', fornecedor: 'Shutterstock', valor: 'US$ 25,06', status: 'Mensal', marca: 'GhelPlus, De Bacco', dividirFluxo: true, fluxoGerencial: '2.5.2.3\n2.5.3.3', centroCusto: '22200 (Marketing)', contaContabil: '42.220.017', cartao: 'Raquel', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla e Tati)', pago: true },
  { mes: 'Abril', fornecedor: 'Atom Bio', status: 'Mensal', dividirFluxo: false, centroCusto: '22200 (Marketing)', cartao: 'Raquel', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla e Tati)', pago: true },
  { mes: 'Abril', fornecedor: 'Apple', status: 'Mensal', dividirFluxo: false, centroCusto: '22200 (Marketing)', cartao: 'Raquel', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla e Tati)', pago: false },
  { mes: 'Abril', fornecedor: 'Open ai (Chat)', valor: 'R$ 108,73', status: 'Mensal', marca: 'De Bacco', dividirFluxo: false, fluxoGerencial: '2.5.3.3', centroCusto: '22200 (Marketing)', cartao: 'Edson', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla e Tati)', pago: false },
  { mes: 'Abril', fornecedor: 'Qr code fácil', status: 'Anual', dividirFluxo: false, cartao: 'Edson', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla e Tati)', pago: true },
  { mes: 'Abril', fornecedor: 'Linkme. bio', status: 'Mensal', dividirFluxo: false, cartao: 'Edson', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla e Tati)', pago: false },
  { mes: 'Abril', fornecedor: 'CGMOOD', status: 'Mensal', dividirFluxo: false, cartao: 'Edson', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla e Tati)', pago: false },
  { mes: 'Janeiro', fornecedor: 'Motion Arr', status: 'Cancelado', dividirFluxo: false, pago: false },
  { mes: 'Janeiro', fornecedor: 'Poligoon', status: 'Anual', dividirFluxo: false, pago: false },
  { fornecedor: 'Sketchup', dividirFluxo: false, pago: false },
  { fornecedor: 'Meta Whatsapp', dividirFluxo: false, centroCusto: '22200 (Marketing)', cartao: 'Carla Visa', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla e Tati) Rogerio Pivatto (TI)', pago: false }
];

// ---------- MENSAL ----------
const MENSAL = [
  { mes: 'Julho', fornecedor: 'UNT', codigo: '13727', valor: 'R$ 7.500,00', tipoPagamento: 'BOLETO', dataPagamento: '27/03', status: 'Mensal', pago: true, marca: 'De Bacco, GhelPlus', dividirFluxo: true, fluxoGerencial: '2.5.3.3 \\ 2.5.2.3', centroCusto: '22200 (Marketing)', contaContabil: '42.220.016', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla)' },
  { mes: 'Julho', fornecedor: 'PAULA LEME', codigo: '123970', valor: 'R$ 7.500,00', tipoPagamento: 'PIX', dataPagamento: '05/03 (pagar após NF)', status: 'Mensal', pago: true, marca: 'De Bacco', dividirFluxo: false, fluxoGerencial: '2.5.3.22', centroCusto: '22200 (Marketing)', contaContabil: '42410045', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla)' },
  { mes: 'Julho', fornecedor: 'LUCIANE (ARQTETANDO)', codigo: '120675', valor: 'R$ 6.000,00', tipoPagamento: 'PIX', dataPagamento: '09/03 (pagar após NF)', status: 'Mensal', pago: true, marca: 'De Bacco', dividirFluxo: false, fluxoGerencial: '2.5.3.22', centroCusto: '22200 (Marketing)', contaContabil: '42410017', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla)' },
  { mes: 'Julho', fornecedor: 'INOUT SITE', codigo: '120001', valor: 'R$ 897,00', tipoPagamento: 'BOLETO', dataPagamento: '10/06', status: 'Mensal', pago: true, marca: 'De Bacco', dividirFluxo: false, fluxoGerencial: '2.5.3.3', centroCusto: '22200 (Marketing)', contaContabil: '42.220.016', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla)' },
  { mes: 'Julho', fornecedor: 'INOUT SITE', codigo: '120001', tipoPagamento: 'BOLETO', dataPagamento: '10/06', status: 'Mensal', pago: true, marca: 'GhelPlus', dividirFluxo: false, fluxoGerencial: '2.5.2.3', centroCusto: '22200 (Marketing)', contaContabil: '42.220.016', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla)' },
  { mes: 'Julho', fornecedor: 'CONTOUR', codigo: '120544', valor: 'R$ 1.850,00', tipoPagamento: 'BOLETO', dataPagamento: '30/03', status: 'Mensal', pago: true, marca: 'De Bacco', parcela: 'Parcela 01', dividirFluxo: false, fluxoGerencial: '2.5.3.22', centroCusto: '22200 (Marketing)', contaContabil: '42220003', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla)' },
  { mes: 'Julho', fornecedor: 'CASOCA', codigo: '108184', valor: 'R$ 970,00', tipoPagamento: 'BOLETO', dataPagamento: '26/06', status: 'Mensal', pago: true, marca: 'De Bacco', dividirFluxo: false, fluxoGerencial: '2.5.3.22', centroCusto: '22200 (Marketing)', contaContabil: '42220008', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla)' },
  { mes: 'Julho', fornecedor: 'RAMPER', codigo: '104114', valor: 'R$ 1.309,85', tipoPagamento: 'BOLETO', dataPagamento: '10/06', status: 'Mensal', pago: true, marca: 'De Bacco, GhelPlus, Duranox', dividirFluxo: true, fluxoGerencial: '2.5.1.3/ 2.5.2.21/ 2.5.3.22', centroCusto: '22200 (Marketing)', contaContabil: '42.410.017', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla)' },
  { mes: 'Julho', fornecedor: 'PROMOB- BIBLIOTECA MAREL\\SIMONETTO', valor: 'R$ 7.466,04', tipoPagamento: 'BOLETO', dataPagamento: '05/03', status: 'Mensal', pago: true, marca: 'De Bacco', parcela: 'Parcela 01', fluxoGerencial: '2.5.3.3', centroCusto: '22200 (Marketing)', contaContabil: '42220008', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla)' },
  { mes: 'Junho', fornecedor: 'ASSESSORIA', codigo: '119146', valor: 'R$ 8.373,22', tipoPagamento: 'BOLETO', dataPagamento: '30/03', status: 'Mensal', pago: true, marca: 'De Bacco, GhelPlus', dividirFluxo: true, fluxoGerencial: '2.5.3.3/2.5.2.3', centroCusto: '22200 (Marketing)', contaContabil: '42220006', observacoes: 'Caso seja necessário pagar via pix: Banco: 341 ITAÚ\nAgência: 0061\nConta: 98372-2\nPIX: 07080566000110\nTitular: Denise Delalamo Comunicação\nCNPJ: 07.080.566/0001-10' },
  { mes: 'Julho', fornecedor: 'ALEX- ESPECIFICADORES', codigo: '127048', valor: 'R$ 5.000,00', tipoPagamento: 'PIX', dataPagamento: 'pagar 5 dias após a emissão da NF', status: 'Mensal', pago: true, marca: 'De Bacco', dividirFluxo: false, fluxoGerencial: '2.5.3.22', centroCusto: '22200 (Marketing)', contaContabil: '42410017', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla)' }
];

// ---------- EXTRAS ----------
const EXTRAS = [
  { mes: 'Março', fornecedor: 'RECEPÇÃO- COMERCIAL', tipoPagamento: 'BOLETO', status: 'Mensal', pago: true, marca: 'De Bacco', centroCusto: '22200 (Marketing)', emailPara: 'Contábil (Guilherme, Leticia e Ricardo), Financeiro (Carla)', observacoes: 'SIG' },
  { mes: 'Março', fornecedor: 'MELINA (EXPOREVESTIR)', codigo: '117829', valor: 'R$ 2.061,75', tipoPagamento: 'PIX', dataPagamento: '19/03', status: 'Parc. única', pago: true, marca: 'De Bacco', fluxoGerencial: '2.5.3.1', centroCusto: '22200 (Marketing)', contaContabil: '42220006', observacoes: 'Pagamento hotel + passagens, no pix melinaknopp@melinaknopp.com' },
  { mes: 'Março', fornecedor: 'INOUT FEICON', codigo: '120001', valor: 'R$ 7.498,50', tipoPagamento: 'PIX', dataPagamento: '20/04', status: 'Mensal', pago: false, marca: 'GhelPlus', parcela: 'Parc 02', fluxoGerencial: '2.5.2.22', centroCusto: '22200 (Marketing)', contaContabil: '42230001', observacoes: 'Pagamento somente após aporvação de material, pix CNPJ: 31.690.499/0001-30' },
  { mes: 'Março', fornecedor: 'INOUT EXPOREVESTIR', codigo: '120001', valor: 'R$ 7.498,50', tipoPagamento: 'BOLETO', dataPagamento: '20/03', status: 'Anual', pago: false, marca: 'De Bacco', parcela: 'Parc 02', fluxoGerencial: '2.5.3.1', centroCusto: '22200 (Marketing)', contaContabil: '42230006', observacoes: 'Pagamento somente após aporvação de material, pix CNPJ: 31.690.499/0001-30' },
  { mes: 'Março', fornecedor: 'IMMERSSIONE', tipoPagamento: 'BOLETO', status: 'Mensal', pago: false, marca: 'De Bacco', centroCusto: '22200 (Marketing)' },
  { mes: 'Março', fornecedor: 'CASOCA- TOUR GUIADO', codigo: '108184', valor: 'R$ 3.157,00', tipoPagamento: 'BOLETO', dataPagamento: '25/03', status: 'Mensal', pago: true, marca: 'De Bacco', parcela: 'Parc 02', fluxoGerencial: '2.5.3.1', centroCusto: '22200 (Marketing)', contaContabil: '42230006' },
  { mes: 'Março', fornecedor: 'CAFÉ SELO VERDE', codigo: '123837', valor: 'R$ 4.075,00', tipoPagamento: 'BOLETO', dataPagamento: '09/03', status: 'Mensal', pago: true, marca: 'De Bacco', parcela: 'Parc 02', fluxoGerencial: '2.5.3.1', centroCusto: '22200 (Marketing)', contaContabil: '42230006' },
  { mes: 'Março', fornecedor: 'CAFÉ SELO VERDE', codigo: '123837', valor: 'R$ 4.075,00', tipoPagamento: 'BOLETO', dataPagamento: '20/03', status: 'Mensal', pago: true, marca: 'De Bacco', parcela: 'Parc 03', fluxoGerencial: '2.5.3.1', centroCusto: '22200 (Marketing)', contaContabil: '42230006' },
  { mes: 'Março', fornecedor: 'BUFFET FEICON', tipoPagamento: 'PIX', status: 'Parc. única', pago: false, marca: 'GhelPlus', parcela: 'Parc 02', centroCusto: '22200 (Marketing)' },
  { mes: 'Março', fornecedor: 'BUFFET EXPOREVESTIR', tipoPagamento: 'PIX', status: 'Parc. única', pago: false, marca: 'De Bacco', parcela: 'Parc 02', centroCusto: '22200 (Marketing)' },
  { mes: 'Junho', fornecedor: 'AMANDA FERBER', codigo: '120543', valor: 'R$ 9.000,00', tipoPagamento: 'PIX', status: 'Mensal', pago: true, marca: 'De Bacco', parcela: 'Parc 06', fluxoGerencial: '2.5.3.5', centroCusto: '22200 (Marketing)', contaContabil: '42220013', observacoes: 'Banco Itaú\nAg 0445\nCc 93823-6\nPix CNPJ 34757801000118' },
  { mes: 'Março', fornecedor: 'ACERTO- VIAGEM  PAULA LEME', codigo: '123970', valor: 'R$ 396,83', tipoPagamento: 'PIX', status: 'Parc. única', pago: true, marca: 'De Bacco', fluxoGerencial: '2.5.3.2', centroCusto: '22200 (Marketing)', contaContabil: '42410045', observacoes: 'Efetuar o reembolso via Chave pix:\nd3376112-ab4a-49b5-ac8c-5433d51c0efb reembolso do Restante da MGerais e da Imerssione de março.\nMetalFlama' },
  { mes: 'Março', fornecedor: 'ASSESSORIA (despesas ExpoRevestir)', codigo: '119146', valor: 'R$ 650,92', tipoPagamento: 'BOLETO', dataPagamento: '23/03', status: 'Parc. única', pago: true, marca: 'De Bacco', fluxoGerencial: '2.5.3.1', centroCusto: '22200 (Marketing)', contaContabil: '42220006' },
  { mes: 'Abril', fornecedor: 'MILENE DOMINGUES', codigo: '124062', valor: 'R$ 10.000,00', tipoPagamento: 'PIX', dataPagamento: '07/04', status: 'Parc. única', pago: false, marca: 'GhelPlus', parcela: 'Parc 02', observacoes: 'Banco Bradesco\nAgência 0293\nC/C 0259797-7\nMilene Domingues\nCPF 215.155.978-57' },
  { mes: 'Abril', fornecedor: 'CAMISETA FEICON (EXTRAS)', status: 'Parc. única', pago: false, marca: 'GhelPlus' },
  { mes: 'Abril', fornecedor: 'ASS. MILENE DOMINGUES', valor: 'R$ 2.500,00', tipoPagamento: 'PIX', dataPagamento: '07/04', status: 'Parc. única', pago: false },
  { fornecedor: 'MAIARA', pago: false }
];

// ---------- CONTROLE DE ASSINATURAS MKT ----------
const ASSINATURAS = [
  { nome: 'Freepik', preco: 'EUR 16,00', tipo: 'Mensal', fluxo: '2.5.3.3, 2.5.2.3', pagamento: 'Cartão Carla Visa' },
  { nome: 'Hostgator', preco: 'R$ 204,00', tipo: 'Anual', fluxo: '2.5.3.3, 2.5.2.3', pagamento: 'Boleto', status: 'Renovar' },
  { nome: 'Canva', preco: 'R$ 698,00', tipo: 'Anual', fluxo: '2.5.3.3, 2.5.2.3', pagamento: 'Cartão Raquel', status: 'Renovar', dataRenovacao: '16.12.2026' },
  { nome: 'Icloud- selo verificado Meta', preco: 'R$ 254,90', tipo: 'Mensal', fluxo: '2.5.3.3', pagamento: 'Cartão Raquel' },
  { nome: 'Icloud- selo verificado Meta', preco: 'R$ 109,00', tipo: 'Mensal', fluxo: '2.5.2.3', pagamento: 'Cartão Raquel' },
  { nome: 'Google One', preco: 'R$ 96,99', tipo: 'Mensal', fluxo: '2.5.3.3', pagamento: 'Cartão Raquel' },
  { nome: 'Google One', preco: 'R$ 96,99', tipo: 'Mensal', fluxo: '2.5.2.3', pagamento: 'Cartão Raquel' },
  { nome: 'Shutterstock', preco: 'US$ 26,61', tipo: 'Mensal', fluxo: '2.5.3.3', pagamento: 'Cartão Raquel' },
  { nome: 'Atom Bio', preco: 'R$ 21,76', tipo: 'Mensal', fluxo: '2.5.3.5', pagamento: 'Cartão Raquel' },
  { nome: 'Apple (ESPAÇO ICLOUD)', preco: 'R$ 14,90', tipo: 'Mensal', fluxo: '2.5.2.3, 2.5.3.3', pagamento: 'Cartão Carla Visa' },
  { nome: 'Open Ai', preco: 'US$ 20,00', tipo: 'Mensal', fluxo: '2.5.3.3', pagamento: 'Cartao Edson' },
  { nome: 'Qr Code Fácil', preco: 'R$ 29,90', tipo: 'Mensal', fluxo: '2.5.3.5, 2.5.2.5', pagamento: 'Cartão Raquel' },
  { nome: 'Link.me bio', preco: 'R$ 13,90', tipo: 'Mensal', fluxo: '2.5.2.5, 2.5.3.5', pagamento: 'Cartao Edson' },
  { nome: 'CG MOOD', preco: 'EUR 6,00', tipo: 'Mensal', fluxo: '2.5.3.5', pagamento: 'Cartao Edson' },
  { nome: 'Motion Arr', preco: 'US$ 39,99', tipo: 'Mensal', fluxo: '2.5.3.3', pagamento: 'Cartao Edson', status: 'Cancelado' },
  { nome: 'Poligon', preco: 'R$ 2.112,00', tipo: 'Anual', fluxo: '2.5.3.5, 2.5.2.5', pagamento: 'Cartao Edson', status: 'Renovar', dataRenovacao: '16.05.2026' },
  { nome: 'Sketchup', preco: 'R$ 2.200,00', tipo: 'Anual', fluxo: '2.5.3.5, 2.5.2.5', status: 'Renovar', dataRenovacao: '27.06.2026' },
  { nome: 'Casoca', preco: 'R$ 970,00', tipo: 'Mensal', fluxo: '2.5.3.3', pagamento: 'Boleto', observacoes: 'Espaço dos nossos blocos 3D' },
  { nome: 'Promob', preco: 'R$ 9.219,90', tipo: 'Mensal', fluxo: '2.5.3.3', pagamento: 'Boleto', observacoes: 'Contratação pontual, para biblioteca 3D' },
  { nome: 'Offs', preco: 'R$ 200,00', tipo: 'Créditos', fluxo: '2.5.3.5, 2.5.2.5', pagamento: 'Cartão Raquel', observacoes: 'Contratação de 50 créditos, para narração de vídeos' },
  { nome: 'Trello', preco: 'R$ 25,00', tipo: 'Mensal', fluxo: '2.5.3.5, 2.5.2.5', pagamento: 'Cartão Raquel' },
  { nome: 'Reportei', preco: 'R$ 74,09', tipo: 'Mensal', fluxo: '2.5.3.5, 2.5.2.5', pagamento: 'Cartão Raquel', status: 'Cancelado' },
  { nome: 'Claude', preco: 'R$ 1.100,00', tipo: 'Anual', fluxo: '2.5.1.1', pagamento: 'Cartão Raquel', status: 'Renovar', dataRenovacao: 'Renovação dia 27/07/2027', observacoes: 'Assinamos dia 21/07/2026' },
  { nome: 'Manus', preco: 'R$ 217,43', tipo: 'Mensal', fluxo: '2.5.1.1', pagamento: 'Cartão Raquel', status: 'Cancelado' },
  { nome: 'Ramper', tipo: 'Mensal', fluxo: '2.5.3.21, 2.5.3.22, 2.5.1.3', pagamento: 'Boleto' },
  { nome: 'ADOBE', preco: 'R$ 47,00', tipo: 'Mensal', fluxo: '2.5.3.5', pagamento: 'Cartão Raquel' }
];

function seedPagamentosImport2026() {
  if (db.get('pagamentos').size().value() === 0) {
    const rows = []
      .concat(CARTAO.map((f) => pagamentoRow('cartao', f)))
      .concat(MENSAL.map((f) => pagamentoRow('mensal', f)))
      .concat(EXTRAS.map((f) => pagamentoRow('extras', f)));
    db.get('pagamentos').push(...rows).write();
    console.log(`[seedPagamentosImport2026] ${rows.length} lançamento(s) importado(s) de CONTROLE DE PAGAMENTOS (histórico, sem sincronizar com o Budget).`);
  }
  if (db.get('assinaturas').size().value() === 0) {
    const rows = ASSINATURAS.map(assinaturaRow);
    db.get('assinaturas').push(...rows).write();
    console.log(`[seedPagamentosImport2026] ${rows.length} assinatura(s) importada(s) de CONTROLE DE ASSINATURAS MKT (histórico).`);
  }
}

module.exports = { seedPagamentosImport2026 };
