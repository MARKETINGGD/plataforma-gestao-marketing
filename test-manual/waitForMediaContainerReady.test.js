// Teste unitário direto de utils/metaGraphClient.js::waitForMediaContainerReady
// (7ª correção, 23/09/2026) -- a função que resolveu o "Media ID is not
// available" achado ao vivo pela Raquel só na De Bacco. Mocka o `fetch`
// global (não o módulo inteiro, já que esta é a própria função sob teste)
// pra simular as respostas da Graph API sem rede real, incluindo o caso
// de precisar de mais de 1 tentativa (status IN_PROGRESS -> FINISHED).
process.env.META_APP_ID = 'x';
process.env.META_APP_SECRET = 'y';

const assert = require('assert');
const metaGraph = require('../utils/metaGraphClient');

const realFetch = global.fetch;
let responses = [];
global.fetch = async (url) => {
  const next = responses.shift();
  if (!next) throw new Error('Teste chamou fetch mais vezes do que o esperado -- responses esgotadas.');
  return { ok: next.status_code !== '__http_error__', status: 200, json: async () => next };
};

// Acelera o teste -- não precisamos esperar 2s de verdade entre tentativas.
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn) => { fn(); return 0; };

async function run() {
  let failures = 0;
  function check(label, cond) {
    console.log((cond ? 'OK   - ' : 'FAIL - ') + label);
    if (!cond) failures++;
  }

  // 1) FINISHED de primeira -- não deve nem tentar de novo.
  responses = [{ status_code: 'FINISHED' }];
  await metaGraph.waitForMediaContainerReady({ containerId: 'c1', pageAccessToken: 'tok' });
  check('FINISHED de primeira resolve sem erro', responses.length === 0);

  // 2) IN_PROGRESS uma vez, depois FINISHED -- confirma que poll de verdade.
  responses = [{ status_code: 'IN_PROGRESS' }, { status_code: 'IN_PROGRESS' }, { status_code: 'FINISHED' }];
  await metaGraph.waitForMediaContainerReady({ containerId: 'c2', pageAccessToken: 'tok' });
  check('IN_PROGRESS algumas vezes até FINISHED também resolve', responses.length === 0);

  // 3) ERROR -- rejeita com mensagem clara (não o "Media ID is not available" genérico).
  responses = [{ status_code: 'ERROR', status: 'Formato de imagem inválido' }];
  let errorMsg = null;
  try {
    await metaGraph.waitForMediaContainerReady({ containerId: 'c3', pageAccessToken: 'tok' });
  } catch (e) {
    errorMsg = e.message;
  }
  check('status ERROR rejeita com mensagem própria (não a genérica da Meta)', errorMsg && errorMsg.includes('não conseguiu processar o arquivo') && errorMsg.includes('Formato de imagem inválido'));

  // 4) EXPIRED -- rejeita com mensagem própria também.
  responses = [{ status_code: 'EXPIRED' }];
  errorMsg = null;
  try {
    await metaGraph.waitForMediaContainerReady({ containerId: 'c4', pageAccessToken: 'tok' });
  } catch (e) {
    errorMsg = e.message;
  }
  check('status EXPIRED rejeita com mensagem própria', errorMsg && errorMsg.includes('expirou'));

  // 5) timeoutMs customizado (usado pelo Reels/vídeo, que precisa de bem
  // mais tempo que 1 imagem só) é respeitado -- passa um timeoutMs já
  // vencido (0) pra forçar o estouro no primeiro check, sem precisar
  // esperar de verdade, e confere que a mensagem reflete esse valor
  // customizado (não o padrão de 60s usado pra imagem).
  responses = [{ status_code: 'IN_PROGRESS' }];
  errorMsg = null;
  try {
    await metaGraph.waitForMediaContainerReady({ containerId: 'c5', pageAccessToken: 'tok', timeoutMs: 0 });
  } catch (e) {
    errorMsg = e.message;
  }
  check('timeoutMs customizado é respeitado (não usa o padrão de 60s da imagem)', errorMsg && !errorMsg.includes('60s'));
  check('metaGraphClient exporta as constantes de tempo do vídeo (bem maiores que as de imagem, usadas pelo Reels)',
    typeof metaGraph.VIDEO_CONTAINER_POLL_INTERVAL_MS === 'number' && typeof metaGraph.VIDEO_CONTAINER_POLL_TIMEOUT_MS === 'number' && metaGraph.VIDEO_CONTAINER_POLL_TIMEOUT_MS > 60000);

  // 6) createInstagramReelsContainer -- confere a montagem REAL da query
  // string (11ª melhoria, capa customizada do Reels: `cover_url`,
  // parâmetro confirmado na referência oficial da Graph API pra Reels).
  // Diferente do teste de utils/metaPublisher.js (que troca essa função
  // inteira por um mock), aqui é a implementação de verdade sendo testada
  // contra um `fetch` fake.
  let lastFetchedUrl = null;
  global.fetch = async (url) => { lastFetchedUrl = url; return { ok: true, status: 200, json: async () => ({ id: 'container-fake' }) }; };
  await metaGraph.createInstagramReelsContainer({ igUserId: 'ig1', pageAccessToken: 'tok', videoUrl: 'http://x/v.mp4', caption: 'oi', coverUrl: 'http://x/capa.jpg' });
  check('createInstagramReelsContainer com coverUrl: manda cover_url na query string pra Meta', lastFetchedUrl && new URL(lastFetchedUrl).searchParams.get('cover_url') === 'http://x/capa.jpg');
  await metaGraph.createInstagramReelsContainer({ igUserId: 'ig1', pageAccessToken: 'tok', videoUrl: 'http://x/v.mp4', caption: 'oi' });
  check('createInstagramReelsContainer sem coverUrl: NÃO manda cover_url nenhum (Meta usa o frame 0 padrão)', lastFetchedUrl && !new URL(lastFetchedUrl).searchParams.has('cover_url'));

  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
  global.fetch = realFetch;
  global.setTimeout = realSetTimeout;
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  global.fetch = realFetch;
  global.setTimeout = realSetTimeout;
  process.exit(1);
});
