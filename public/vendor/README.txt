Bibliotecas de terceiros usadas pela Papoi, guardadas aqui (em vez de
carregadas de um CDN) pra funcionar mesmo se a rede da Raquel/equipe
bloquear domínios externos, e pra nunca depender de um CDN de fora do ar.

- xlsx.full.min.js — SheetJS Community Edition, versão 0.18.5, licença
  Apache-2.0 (biblioteca de código aberto, gratuita pra este uso).
  Baixada via `npm pack xlsx@0.18.5` e copiada de
  `package/dist/xlsx.full.min.js` (64ª... 65ª rodada, "Rodada G" da
  Pendência 51, pedido da Raquel: exportar relatórios/tabelas em Excel).
  Usada só no NAVEGADOR (carregada em public/index.html), nunca no
  servidor — por isso não é uma dependência do package.json, é só um
  arquivo estático como os de public/sounds/.
