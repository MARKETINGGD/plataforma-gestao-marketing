// 42ª rodada — dados extraídos da planilha "PRODUTOS GHELPLUS" (Google Sheets,
// pedido da Raquel: "em analise de concorrencia, coloque os dados dessa analise
// de concorrencia [...], deve ter tbm a opção de colocar varias marcas na analise,
// e não apenas 1 versus a outra"). Cada item compara um produto GhelPlus com o
// equivalente (quando existe) da Tramontina, Forminox e Fabrinox. Quando a
// planilha não tinha produto equivalente pra uma marca, ela mesma dizia isso
// explicitamente ("(Não tem produto igual/semelhante)") -- vira `produto: null`
// aqui, sem tentar inventar nada. Preço "-" ou vazio também vira `preco: null`;
// quando o texto da célula de preço não era um valor em R$ (ex.: "Vendas
// somente para lojista"), esse texto foi preservado em `observacoes` em vez
// de descartado.
// A coluna "Valor GhelPlus" veio vazia pra todas as linhas na planilha
// original, então `nossoPreco` é `null` em todos os itens (não é erro de
// extração).
const ITENS_CONCORRENCIA_GHELPLUS_2026 = [
  {
    nossoProduto: "Cuba Super Grafite 30536",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Cuba Tramontina Design Collection Quadrum em Aço Inox com Revestimento PVD Black 70x40 cm", preco: 2499.0, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Cuba Super 30530/30531/30532",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Cuba Tramontina Design Collection Quadrum 50 em Aço Inox com Acabamento Acetinado", preco: 1575.1, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Cuba Dupla Super 30533/30521",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Cuba Tramontina Design Collection Quadrum 2C 40 em Aço Inox com Acabamento Acetinado + Acessórios", preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Cuba Super 30539",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Cuba Tramontina Morgana Compact 48 FX Undermount em Aço Inox", preco: 426.55, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Cuba Super 30520",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Cuba Super 30538/30503",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Cuba Tramontina Morgana 60 FX Undermount em Aço Inox com Acabamento Escovado com Válvula 69x49 cm", preco: 616.55, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Cuba de aço inox para cozinha modelo N6545", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Cuba GhelPlus N1 – Brilho Premium",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Cuba de embutir Tramontina Lavínia 48 BL em aço inox alto brilho 48x34 cm", preco: 331.55, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Cuba de aço inox AISI304 para cozinha modelo N01F14LUXO (Brilhante)", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Cuba GhelPlus N2 – Brilho Premium",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Cuba de embutir Tramontina Lavínia 48 BL em Aço Inox Alto Brilho 48x34 cm", preco: 312.55, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Cuba de aço inox AISI304 para cozinha modelo N02F14LUXO(Brilhante)", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Cuba GhelPlus N3 – Brilho Premium",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Cuba de embutir Tramontina Lavínia 40 BL em aço inox alto brilho 40x34 cm com válvula de 4 1/2\" com escape", preco: 265.05, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Cuba de aço inox AISI304 para cozinha modelo N36F14LUXO(Brilhate)", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Cuba e Meia N3 Mesa 575×400 Brilho Premium",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Cuba Tramontina Isis 2C 34 28 BS em Aço Inox com Acabamento Polido com 2 Válvulas, Cesto Coador, Tábua e Escorredor de Pratos", preco: 1177.05, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "\\-", preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Cuba Tripla N3 Mesa 950×400 Brilho Premium",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Cuba GhelPlus N1 – Brilho Plus",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Cuba de Embutir Tramontina Lavínia 47 BL em Aço Inox Polido 47x30 cm", preco: 297.35, observacoes: null },
      { marca: "Forminox", produto: "Cuba Nº 02 – 560 x 335 x 170mm 0,5  Polida Furação 3 1/2", preco: null, observacoes: "Vendas somente para lojista" },
      { marca: "Fabrinox", produto: "Cuba de aço inox AISI304 para cozinha modelo N01F14LUX(Polida)", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Cuba GhelPlus N2 – Brilho Plus",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Cuba de embutir Tramontina Lavínia 56 BL em Aço Inox Polido 56x34 cm", preco: 387.6, observacoes: null },
      { marca: "Forminox", produto: "Cuba Nº 01 – 460 x 300 x 170mm 0,5  Polida Furação 3 1/2", preco: null, observacoes: "Vendas somente para lojista" },
      { marca: "Fabrinox", produto: "Cuba de aço inox AISI304 para cozinha modelo N02F14LUXO(Polida)", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Cuba GhelPlus N3 – Brilho Plus",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Cuba de Embutir Tramontina Lavínia 40 BL em Aço Inox Polido 40x34 cm", preco: 287.85, observacoes: null },
      { marca: "Forminox", produto: "Cuba Nº 34 – 400 x 340 x 170mm 0,5 Polida Furação 3 1/2", preco: null, observacoes: "Vendas somente para lojista" },
      { marca: "Fabrinox", produto: "Cuba de aço inox AISI304 para cozinha modelo N03F14LUXO(Polida)", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Cuba GhelPlus N4 – Brilho Plus",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Cuba GhelPlus N5 – Brilho Plus",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Cuba GhelPlus RD – Brilho Plus",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Cuba de embutir Tramontina Basic 38 BL em Aço Inox natural Ø38 cm", preco: 197.6, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Cuba de aço inox AISI304 para cozinha modelo N32LUXO", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Cuba Dupla N3 Mesa 720×400 Brilho Plus",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Cuba dupla de aço inox AISI304 para cozinha modelo N340F14LUXO", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Cuba Dupla N5 – Brilho Plus",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Cuba de embutir Tramontina Isis 2C 34 BL em Aço Inox Polido 72x34 cm", preco: 706.8, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Cuba dupla de aço inox AISI304 para cozinha modelo N336F14LUXO(Polida)", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Cuba GhelPlus N1 - Brilho Ideal",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Cuba Tramontina com válvula 430 N1 47x30x14cm - standard", preco: 141.55, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Cuba de aço inox para cozinha modelo N01R", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Cuba GhelPlus N2 - Brilho Ideal",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Cuba Tramontina Standard 56×34×14 Aço Inox Prateado – Retangular para Cozinha", preco: 149.9, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Cuba de aço inox para cozinha modelo N02R", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Cuba GhelPlus N3 - Brilho Ideal",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Cuba Número 3 De Cozinha Inox Tramontina Pia 40x34 Fosca", preco: 145.9, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Cuba de aço inox para cozinha modelo N03R", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Cuba GhelPlus N4 - Brilho Ideal",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Cuba GhelPlus N5 - Brilho Ideal",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Cuba Tramontina 47x30 Inox Pia Estreita Kit Válvula Sifão", preco: 139.9, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Cuba de aço inox para cozinha modelo N36F14STD", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Cuba GhelPlus RD - Brilho Ideal",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Cuba redonda de aço inox para cozinha modelo N32FSTD", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Pia Dubai 1.20",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Pia de Apoio Tramontina Filo 1CC em Aço Inox 120x50 cm", preco: 576.65, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Pia de aço inox para cozinha modelo PS1200, 120x52cm", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Pia Dubai 1.50",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Pia de aço inox para cozinha modelo PS1500, 150x52cm", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Pia Dubai 1.60",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Pia de Apoio Tramontina Filo 56 em Aço Inox 160x55 cm", preco: 1123.85, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Pia de aço inox para cozinha modelo PS1600, 160x52cm", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Pia Plus 30 – 1,00 m",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Pia de Apoio Tramontina New Raggi 40 em Aço Inox 105x52 cm", preco: 329.65, observacoes: null },
      { marca: "Forminox", produto: "Pia Aço Inox Monobloco 1,00m", preco: null, observacoes: "Vendas somente para lojista" },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Pia Plus 30 – 1,20 m",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Pia de Apoio Tramontina New Raggi 40 em Aço Inox 120x52 cm", preco: 271.65, observacoes: null },
      { marca: "Forminox", produto: "Pia Aço Inox Monobloco 1,20m", preco: null, observacoes: "Vendas somente para lojista" },
      { marca: "Fabrinox", produto: "Pia de aço inox luxo AISI304 para cozinha modelo PSL1200, 120x55cm", preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Pia Plus 30 – 1,40 m",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: "Pia Aço Inox Monobloco 1,40m", preco: null, observacoes: "Vendas somente para lojista" },
      { marca: "Fabrinox", produto: "Pia de aço inox luxo AISI304 para cozinha modelo PSL1400, 140x55cm", preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Pia Plus 30 – 1,50 m",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Pia de Apoio Tramontina New Raggi 40 em Aço Inox 150x52 cm", preco: 442.22, observacoes: null },
      { marca: "Forminox", produto: "Pia Aço Inox Monobloco 1,50m", preco: null, observacoes: "Vendas somente para lojista" },
      { marca: "Fabrinox", produto: "Pia de aço inox luxo AISI304 para cozinha modelo PSL1500, 150x55cm", preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Pia Plus 30 – 1,60 m",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Pia de Apoio Tramontina Filo 56 em Aço Inox 160x55 cm", preco: 576.65, observacoes: null },
      { marca: "Forminox", produto: "Pia Aço Inox Monobloco 1,60m", preco: null, observacoes: "Vendas somente para lojista" },
      { marca: "Fabrinox", produto: "Pia de aço inox luxo AISI304 para cozinha modelo PSL1600, 160x55cm", preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Pia Plus 30 Dupla – 1,60 m",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Pia Plus 30 – 1,80 m",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Pia de Apoio Tramontina Filo 56 Plus em Aço Inox 180x55 cm", preco: 1312.9, observacoes: null },
      { marca: "Forminox", produto: "Pia Aço Inox Monobloco 1,80m", preco: null, observacoes: "Vendas somente para lojista" },
      { marca: "Fabrinox", produto: "Pia de aço inox luxo AISI304 para cozinha modelo PSL1800, 180x55cm", preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Pia Plus 30 Dupla – 1,80 m",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Pia Plus 30 – 2,00 m",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Pia de Apoio Tramontina Filo 56 Plus em Aço Inox 200x55 cm", preco: 1456.35, observacoes: null },
      { marca: "Forminox", produto: "Pia Aço Inox Monobloco 2,00m", preco: null, observacoes: "Vendas somente para lojista" },
      { marca: "Fabrinox", produto: "Pia de aço inox luxo AISI304 para cozinha modelo PSL2000, 200x55cm", preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Pia Plus 30 Dupla – 2,00 m",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Pia Deslocada Direita",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Pia de Apoio Tramontina Filo 40 FX EX em Aço Inox 100x50 cm", preco: 480.7, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Pia Deslocada Esquerda",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Pia de Apoio Tramontina Filo 40 FX DX em Aço Inox 100x50 cm", preco: 480.7, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Tanque 500 – 48 Litros Parede",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Tanque 500 de Embutir – 48 Litros",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Tanque 500 de Embutir – 68 litros",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Tanque Duplo – 114 Litros Parede",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Tanque Mini – 32 Litros Parede",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Tanque de Parede Tramontina Hera Wall 34 L em Aço Inox Escovado 50x40 cm", preco: 721.05, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Tanque de aço inox AISI430 para lavanderia modelo TQ630 parede", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Tanque Monobloco Para Embutir 25 Litros Acetinado",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Tanque de Encaixe Tramontina Hera Compact 25L em Aço Inox Escovado 40x40 cm", preco: 350.55, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Tanque de aço inox AISI304 para lavanderia modelo S-40 Acetinado", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Tanque Monobloco Para Embutir 25 Litros Polido",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Tanque de Encaixe Tramontina Hera Compact 25 L em Aço Inox Polido 40x40 cm", preco: 550.05, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Tanque de aço inox AISI304 para lavanderia modelo S-400 Polido", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Tanque Monobloco Para Embutir 30 Litros Acetinado",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Tanque de Encaixe Tramontina Hera 34 L em Aço Inox Escovado 50x40 cm", preco: 350.55, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Tanque Monobloco Para Embutir 30 Litros Polido",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: "Tanque de Encaixe Tramontina Hera 34 L em Aço Inox Polido 50x40 cm", preco: 569.05, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Tanque Monobloco Para Embutir 35 Litros Acetinado",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: "Tanque de aço inox AISI304 para lavanderia modelo S-500 Acetinado", preco: null, observacoes: "Vendas somente para lojista" },
    ]
  },
  {
    nossoProduto: "Tanque Super 500 – 68 Litros Parede",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
  {
    nossoProduto: "Tanque Super Mini – 46 Litros Parede",
    nossoPreco: null,
    concorrentes: [
      { marca: "Tramontina", produto: null, preco: null, observacoes: null },
      { marca: "Forminox", produto: null, preco: null, observacoes: null },
      { marca: "Fabrinox", produto: null, preco: null, observacoes: null },
    ]
  },
];

module.exports = { ITENS_CONCORRENCIA_GHELPLUS_2026 };
