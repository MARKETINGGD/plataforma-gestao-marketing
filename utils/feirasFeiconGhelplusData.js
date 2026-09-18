// Dados da feira FEICON (GhelPlus), importados da planilha oficial
// '2026- BUDGET GHELPLUS.xlsx', aba 'FEICON 2026' (41ª rodada, pedido
// da Raquel). Cada item é {nome, quantidade, fornecedor, observacoes,
// valores (12 posições, Jan..Dez), total}. FEICON 2026 tem Janeiro e
// Fevereiro detalhados mês a mês (é o que a planilha tinha preenchido);
// os demais meses ficam em branco mesmo o TOTAL sendo maior — a
// diferença é o mesmo problema de fórmula desatualizada já registrado
// no Pendente nº4 do handoff. FEICON 2025 não tem quebra mensal na
// planilha original, só o total por item. Algumas linhas da planilha
// original vieram com colunas desalinhadas (ex.: 'Folders' com um
// número no lugar do nome do fornecedor) — importado fielmente como
// está na planilha, sem tentar adivinhar/corrigir.
const ITENS_FEICON_2026 = [
  {
    "nome": "Espaço",
    "quantidade": 10.0,
    "fornecedor": "Reed Alcantara",
    "observacoes": "",
    "valores": [
      9998.79,
      9998.79,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 91000.0
  },
  {
    "nome": "Estande",
    "quantidade": 2.0,
    "fornecedor": "Arqeventos",
    "observacoes": "",
    "valores": [
      20231.25,
      20231.25,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 123708.0
  },
  {
    "nome": "Extras Estande",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      591.0,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": null
  },
  {
    "nome": "Extintores",
    "quantidade": 2.0,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 200.0
  },
  {
    "nome": "Segurança",
    "quantidade": 5.0,
    "fornecedor": "",
    "observacoes": "Código forn.: 63650",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": null
  },
  {
    "nome": "Decoração (chuteira, canetas, cabide..)",
    "quantidade": 1.0,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 186.57
  },
  {
    "nome": "Buffet",
    "quantidade": null,
    "fornecedor": "Andrea Marques",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 11350.0
  },
  {
    "nome": "Folders",
    "quantidade": 3000.0,
    "fornecedor": "4000",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": null
  },
  {
    "nome": "Brindes",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": null
  },
  {
    "nome": "Seguro + KVA",
    "quantidade": 1.0,
    "fornecedor": "RX Global",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 2338.66
  },
  {
    "nome": "Hidráulica",
    "quantidade": null,
    "fornecedor": "RX Global",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 543.49
  },
  {
    "nome": "Camisa Staff (sIG 1663)",
    "quantidade": 7.0,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 231.0
  },
  {
    "nome": "Feicon Hotel",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 36571.5
  },
  {
    "nome": "Feicon - Placas de identificação",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 400.0
  },
  {
    "nome": "Feicon Cordão (Sig 1620)",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "Quantidade (planilha): 100 UN",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 360.0
  },
  {
    "nome": "Trocas de adesivos (sig 2008)",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 315.0
  },
  {
    "nome": "Album de figurinhas (Sig 1999)",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 252.0
  },
  {
    "nome": "Microfone + cx de som",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 1000.0
  },
  {
    "nome": "Adesivo Pia (Sig 1966)",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 315.0
  },
  {
    "nome": "Adesivos Pia (Sig 1940)",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 45.0
  },
  {
    "nome": "Adesivos Placa de acrílico (Sig 1932)",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 795.0
  },
  {
    "nome": "Tampo Superior (Sig 1928)",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 98.0
  },
  {
    "nome": "Suporte de bolas  (Sig 1922)",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 579.0
  },
  {
    "nome": "Camisa TimAÇO (Sig 1893)",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "Quantidade (planilha): 70 UN",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 3850.0
  },
  {
    "nome": "Bolas TimAÇO (Sig 1696)",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "Quantidade (planilha): 30 UN",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 2010.0
  },
  {
    "nome": "Feicon - margem p/ emergências",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 15000.0
  },
  {
    "nome": "Fotos e vídeos",
    "quantidade": null,
    "fornecedor": "INOUT",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 7498.5
  },
  {
    "nome": "Influencer Milene",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 25000.0
  },
  {
    "nome": "Transporte (Uber)",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": null
  },
  {
    "nome": "Alimentação",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": null
  },
  {
    "nome": "Passagens",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": null
  },
  {
    "nome": "Assessoria",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 195.75
  }
];

const ITENS_FEICON_2025 = [
  {
    "nome": "Espaço",
    "quantidade": 10.0,
    "fornecedor": "Reed Alcantara",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 89990.0
  },
  {
    "nome": "Estande",
    "quantidade": 2.0,
    "fornecedor": "JW",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 107900.0
  },
  {
    "nome": "Adicional estande",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 6355.3
  },
  {
    "nome": "Feicon - Energia adicional 1KVA",
    "quantidade": 1.0,
    "fornecedor": "",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 591.0
  },
  {
    "nome": "Extintores",
    "quantidade": 2.0,
    "fornecedor": "Entherm Soluções",
    "observacoes": "Código forn.: 116722",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 140.0
  },
  {
    "nome": "Credenciais adicionais",
    "quantidade": 5.0,
    "fornecedor": "Reed Exhibit",
    "observacoes": "Código forn.: 63650",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 374.0
  },
  {
    "nome": "Paisagismo",
    "quantidade": null,
    "fornecedor": "Harmony Paisagismo",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 4900.0
  },
  {
    "nome": "Buffet",
    "quantidade": null,
    "fornecedor": "Andréa Marques",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 13314.0
  },
  {
    "nome": "Folders",
    "quantidade": 3000.0,
    "fornecedor": "Gráfica Imperial",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 4870.8
  },
  {
    "nome": "Ponto hidráulica",
    "quantidade": 1.0,
    "fornecedor": "Reed Alcantara",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 974.0
  },
  {
    "nome": "Camisa Polo Branca",
    "quantidade": null,
    "fornecedor": "DLamb",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 5850.0
  },
  {
    "nome": "Camisa Staff",
    "quantidade": null,
    "fornecedor": "DLamb",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 504.0
  },
  {
    "nome": "Feicon Hotel",
    "quantidade": null,
    "fornecedor": "Hotel Transamerica",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 37642.5
  },
  {
    "nome": "Expositores",
    "quantidade": null,
    "fornecedor": "Project",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 5160.0
  },
  {
    "nome": "Feicon Biscoitos Brinde",
    "quantidade": null,
    "fornecedor": "Emeline Téo",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 1008.75
  },
  {
    "nome": "Recorte de tampos",
    "quantidade": null,
    "fornecedor": "Planejados São bento",
    "observacoes": "Código forn.: 110356",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 1500.0
  },
  {
    "nome": "Feicon Tag Biscoitos",
    "quantidade": null,
    "fornecedor": "Gráfica Ampére",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 250.0
  },
  {
    "nome": "Feicon vídeos- seta",
    "quantidade": null,
    "fornecedor": "Seta",
    "observacoes": "",
    "valores": [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    "total": 7000.0
  }
];

module.exports = { ITENS_FEICON_2026, ITENS_FEICON_2025 };
