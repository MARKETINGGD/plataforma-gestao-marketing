// Dados da feira ExpoRevestir (De Bacco), importados da planilha oficial
// '2026 - BUDGET DE BACCO.xlsx', aba 'EXPO REVESTIR 2026' (42ª rodada,
// pedido da Raquel — link enviado por ela depois de a 41ª rodada ter
// descoberto que os 2 links colados antes apontavam pro arquivo
// errado). Cada item é {nome, quantidade, fornecedor, observacoes,
// valores (12 posições, Jan..Dez), total}. Diferente da FEICON
// (GhelPlus, 41ª rodada), essa planilha não tem NENHUMA quebra mensal
// em nenhum dos 2 anos — só o valor total por item — então 'valores'
// fica com as 12 posições vazias (null) e 'total' guarda o valor
// exato da planilha (a mesma convenção já usada pra FEICON 2025, que
// também não tinha quebra mensal). A coluna A da planilha original
// tinha anotações soltas por linha (ex.: 'BI', '1 PARC BI', 'FALTA
// (fulano, ciclano...)') sem uma legenda explicando o que significam —
// preservadas ao pé da letra dentro de 'observacoes', prefixadas como
// 'Nota original da planilha', em vez de tentar adivinhar o sentido.

const ITENS_EXPOREVESTIR_2026 = [
  {
    "nome": "Locação",
    "quantidade": "150m²",
    "fornecedor": "Anfacer",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 212250.0
  },
  {
    "nome": "Produção",
    "quantidade": "150m²",
    "fornecedor": "ArqEventos",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 264000.0
  },
  {
    "nome": "Fotos e vídeos",
    "quantidade": "2 dias",
    "fornecedor": "Inout",
    "observacoes": "Nota original da planilha: \"1 PARC BI\"",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 7498.5
  },
  {
    "nome": "RRT taxa",
    "quantidade": "1",
    "fornecedor": "Anfacer",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 125.4
  },
  {
    "nome": "RRT UNT",
    "quantidade": "1",
    "fornecedor": "UNT",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 707.52
  },
  {
    "nome": "Taxa KVA básico",
    "quantidade": "15",
    "fornecedor": "Anfacer",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 15555.0
  },
  {
    "nome": "Ponto de  hidráulica",
    "quantidade": "1",
    "fornecedor": "Anfacer",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 1358.38
  },
  {
    "nome": "Ponto extra hidráulica",
    "quantidade": "1",
    "fornecedor": "Anfacer",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 1893.89
  },
  {
    "nome": "Taxa facilities",
    "quantidade": "1",
    "fornecedor": "Anfacer",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 10350.0
  },
  {
    "nome": "Seguro - prata",
    "quantidade": "1",
    "fornecedor": "Anfacer",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 1028.0
  },
  {
    "nome": "Extintor",
    "quantidade": "4",
    "fornecedor": "Anfacer",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 991.06
  },
  {
    "nome": "Taxa Municipal",
    "quantidade": "1",
    "fornecedor": "Anfacer",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 366.0
  },
  {
    "nome": "Taxa KVA Extra",
    "quantidade": "20",
    "fornecedor": "Anfacer",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 20740.0
  },
  {
    "nome": "Taxas extras na Feira",
    "quantidade": null,
    "fornecedor": "Nuernberg",
    "observacoes": "Nota original da planilha: \"BI\"",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 700.0
  },
  {
    "nome": "Buffet",
    "quantidade": null,
    "fornecedor": "Andreia",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 18000.0
  },
  {
    "nome": "Segurança",
    "quantidade": "7 dias",
    "fornecedor": "Andreia",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 2800.0
  },
  {
    "nome": "Limpeza",
    "quantidade": "8 dias",
    "fornecedor": "Andreia",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 1200.0
  },
  {
    "nome": "Café",
    "quantidade": null,
    "fornecedor": "Selo Real",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 16300.0
  },
  {
    "nome": "Letreiro Extra",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 2300.0
  },
  {
    "nome": "Placas de acrílico (produtos)",
    "quantidade": "174 UN",
    "fornecedor": "Garage",
    "observacoes": "Nota original da planilha: \"BI\"",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 825.0
  },
  {
    "nome": "Decoração e utensílios stand",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 1019.71
  },
  {
    "nome": "Pedras decorativas (misturadores)",
    "quantidade": "1 PCT",
    "fornecedor": "Camila Flores",
    "observacoes": "Nota original da planilha: \"BI\"",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 49.9
  },
  {
    "nome": "Adesivos Capacete",
    "quantidade": "60 UN",
    "fornecedor": "Garage",
    "observacoes": "Nota original da planilha: \"BI\"",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 90.0
  },
  {
    "nome": "Hotel",
    "quantidade": null,
    "fornecedor": "Transamerica",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 56269.5
  },
  {
    "nome": "Extra produção stand",
    "quantidade": null,
    "fornecedor": "ArqEventos",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 14044.07
  },
  {
    "nome": "Credencial segurança",
    "quantidade": "1",
    "fornecedor": "Nuernberg",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 647.56
  },
  {
    "nome": "Cordões",
    "quantidade": "100",
    "fornecedor": "Primeset",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 420.0
  },
  {
    "nome": "Folder",
    "quantidade": "3000",
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 4920.0
  },
  {
    "nome": "Influencer - Lu Dias",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "Permuta",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 0
  },
  {
    "nome": "Influencer - Melina",
    "quantidade": null,
    "fornecedor": "Hotel e hospedagem",
    "observacoes": "Contrato de um ano, com permuta (pagameos apenas a viagem e o hotel) | Nota original da planilha: \"BI\"",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 2061.75
  },
  {
    "nome": "Uniforme",
    "quantidade": null,
    "fornecedor": "Zassi",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 5429.0
  },
  {
    "nome": "Uniforme a mais (Maurício e comercial)",
    "quantidade": "7",
    "fornecedor": "Zassi",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 940.0
  },
  {
    "nome": "Coletor",
    "quantidade": "1",
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 2150.0
  },
  {
    "nome": "Uniforme Staff",
    "quantidade": "23",
    "fornecedor": "DLamb",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 759.0
  },
  {
    "nome": "Ações Casoca",
    "quantidade": null,
    "fornecedor": "Casoca",
    "observacoes": "Banner no site, e-mail mkt + 9 tours | Nota original da planilha: \"BI PARC 01\"",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 9470.0
  },
  {
    "nome": "Acerto de viagem - alimentação",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "Nota original da planilha: \"FALTA (Felipe, Elenildo, Pedro Cesar e Fábio)\"",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 15869.99
  },
  {
    "nome": "Acerto de viagem - Uber+taxi+gasolina+estacionamento",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 7709.29
  },
  {
    "nome": "Acerto de viagem- outros",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 866.64
  },
  {
    "nome": "Passagem",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 13279.84
  },
];

const ITENS_EXPOREVESTIR_2025 = [
  {
    "nome": "Revestir - Espaço",
    "quantidade": "100m²",
    "fornecedor": "Anfacer",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 138000.0
  },
  {
    "nome": "Revestir - Estande",
    "quantidade": "100m²",
    "fornecedor": "ArqEventos",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 229684.4
  },
  {
    "nome": "Folder Debacco ExpoRevestir",
    "quantidade": "4000",
    "fornecedor": "Gráfica Imperial",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 25000.0
  },
  {
    "nome": "ExpoRevestir Camisa",
    "quantidade": "39",
    "fornecedor": "Docthos",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 5098.8
  },
  {
    "nome": "ExpoRevestir Camisa Staff",
    "quantidade": null,
    "fornecedor": "DLamb",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 504.0
  },
  {
    "nome": "ExpoRevestir Móveis",
    "quantidade": null,
    "fornecedor": "Movelmar",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 99770.0
  },
  {
    "nome": "ExpoRevestir Energia",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 9980.0
  },
  {
    "nome": "ExpoRevestir Energia adicional",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 17745.0
  },
  {
    "nome": "ExpoRevestir Ponto hidráulico",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 1925.0
  },
  {
    "nome": "ExpoRevestir Buffet",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 32687.82
  },
  {
    "nome": "ExpoRevestir Painel Led",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 16201.0
  },
  {
    "nome": "ExpoRevestir Seguro",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 952.0
  },
  {
    "nome": "ExpoRevestir Decoração",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 3598.84
  },
  {
    "nome": "ExpoRevestir Credenciais",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 2424.0
  },
  {
    "nome": "ExpoRevestir Taxa facilities",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 365.25
  },
  {
    "nome": "ExpoRevestir RRT",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 119.61
  },
  {
    "nome": "ExpoRevestir facilities",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 6600.0
  },
  {
    "nome": "ExpoRevestir Cartão QR Code - impressão",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 1536.0
  },
  {
    "nome": "ExpoRevestir Cupcake",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 2257.0
  },
  {
    "nome": "ExpoRevestir Infuencers",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 13125.0
  },
  {
    "nome": "ExpoRevestir Tour virtual",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 3860.0
  },
  {
    "nome": "ExpoRevestir Hotel",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 45028.85
  },
  {
    "nome": "ExpoRevestir Qr Code Fácil",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 29.9
  },
  {
    "nome": "ExpoRevestir extintores",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 488.0
  },
  {
    "nome": "ExpoRevestir cordões",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 420.0
  },
  {
    "nome": "Seta- Wesley",
    "quantidade": null,
    "fornecedor": "",
    "observacoes": "",
    "valores": [null, null, null, null, null, null, null, null, null, null, null, null],
    "total": 7000.0
  },
];

module.exports = { ITENS_EXPOREVESTIR_2026, ITENS_EXPOREVESTIR_2025 };
