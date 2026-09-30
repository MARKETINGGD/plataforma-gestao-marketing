// Teste unitário (Node puro, sem rede de verdade) da 78ª rodada -- confere
// que utils/linkedinClient.js monta o PAYLOAD de verdade certo pro
// carrossel (`content.multiImage.images`, documentado pela LinkedIn Posts
// API), sem depender do mock de alto nível usado em
// linkedinPublisher.test.js (lá o createPost inteiro é substituído por um
// mock -- aqui é a implementação REAL de createPost, só com
// `global.fetch` trocado por um fake que devolve 201 com o header
// x-restli-id, exatamente como a LinkedIn documenta).
process.env.PAPOI_BASE_URL = 'http://localhost:4123';

const linkedinClient = require('../utils/linkedinClient');

async function run() {
  let failures = 0;
  function check(label, cond) {
    console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
    if (!cond) failures++;
  }

  let capturedBody = null;
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 201,
      headers: { get: (name) => (name === 'x-restli-id' ? 'urn:li:share:fake-multiimage-post' : null) },
      json: async () => ({})
    };
  };

  // ---------- carrossel: 3 imagens ----------
  const result = await linkedinClient.createPost({
    accessToken: 'fake-token',
    authorUrn: 'urn:li:organization:123',
    commentary: 'Legenda do carrossel',
    mediaUrns: ['urn:li:image:a', 'urn:li:image:b', 'urn:li:image:c']
  });
  check('createPost devolveu o id do post criado', result.id === 'urn:li:share:fake-multiimage-post');
  check('payload usa content.multiImage.images (não content.media)', !!(capturedBody.content && capturedBody.content.multiImage));
  check('multiImage.images tem as 3 imagens, na ordem certa', JSON.stringify((capturedBody.content.multiImage.images || []).map((i) => i.id)) === JSON.stringify(['urn:li:image:a', 'urn:li:image:b', 'urn:li:image:c']));
  check('não sobrou nenhum content.media de post de 1 imagem só', !capturedBody.content.media);

  // ---------- 1 imagem só continua usando content.media (não multiImage) ----------
  capturedBody = null;
  await linkedinClient.createPost({
    accessToken: 'fake-token',
    authorUrn: 'urn:li:organization:123',
    commentary: 'Legenda de 1 imagem',
    mediaUrn: 'urn:li:image:sozinha'
  });
  check('post de 1 imagem continua usando content.media.id (compatibilidade)', capturedBody.content && capturedBody.content.media && capturedBody.content.media.id === 'urn:li:image:sozinha');
  check('post de 1 imagem NÃO usa multiImage', !capturedBody.content.multiImage);

  // ---------- mediaUrns com só 1 item não deveria virar multiImage (não é carrossel de verdade) ----------
  capturedBody = null;
  await linkedinClient.createPost({
    accessToken: 'fake-token',
    authorUrn: 'urn:li:organization:123',
    commentary: 'mediaUrns com 1 item só',
    mediaUrns: ['urn:li:image:unica']
  });
  check('mediaUrns com 1 item só não vira multiImage (sem media nenhum, já que mediaUrn não foi passado)', !capturedBody.content);

  global.fetch = realFetch;

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
