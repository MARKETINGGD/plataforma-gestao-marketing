// Sincronização de saída (Plataforma -> Ações Sazonais), 41ª rodada.
// Reaproveita a mesma URL já usada pro SSO/iframe (ACOES_SAZONAIS_URL) e
// autentica com INTERNAL_SYNC_TOKEN (ver middleware/internalAuth.js — o
// mesmo valor precisa estar configurado nos dois serviços no Railway).
//
// Best-effort: se a integração não estiver configurada, ou o outro serviço
// estiver fora do ar, isso NUNCA derruba a operação principal (criar/editar
// uma feira ou um lançamento de Budget) — só fica registrado no log do
// servidor. Ver também routes/feiras.js e routes/budget.js (quem chama).
async function notifyAcoesSazonais(path, body) {
  const base = process.env.ACOES_SAZONAIS_URL;
  const token = process.env.INTERNAL_SYNC_TOKEN;
  if (!base || !token) return { skipped: true };
  try {
    const url = base.replace(/\/$/, '') + '/api/integrations/plataforma/' + path;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': token },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      console.error(`[acoesSazonaisSync] ${path} respondeu ${res.status}`);
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (e) {
    console.error(`[acoesSazonaisSync] Falha ao chamar ${path}:`, e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { notifyAcoesSazonais };
