/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA SPY — envio do alerta ao responsável (navegador)

   O aparelho não tem credencial de WhatsApp nem de e-mail: manda o alerta
   para o RELÉ (servidor próprio em /api/spy/alerta, ou Cloudflare Worker),
   que guarda as credenciais e os destinatários.

   Celular na estrada perde sinal: falha de rede e 5xx são repetidos com
   espera crescente; sem rede, o alerta fica na fila e sai quando a conexão
   voltar (evento "online"). 4xx (token errado, alerta inválido) NÃO é
   repetido — repetir não conserta e gastaria o limite do relé.
   ═══════════════════════════════════════════════════════════════════════ */

const ESPERAS_MS = [0, 2000, 6000];

/** Origem permitida para o relé nesta publicação (CSP) — null se a URL não estiver liberada. */
export function releLiberado(url, origensPermitidas = []) {
  try {
    const u = new URL(url, globalThis.location?.href);
    if (globalThis.location && u.origin === globalThis.location.origin) return true;   // servidor próprio
    return u.protocol === 'https:' && origensPermitidas.includes(u.origin);
  } catch { return false; }
}

/**
 * Envia um alerta. Devolve { ok, status, canais, erro, tentativas }.
 * @param {{url: string, token: string, alerta: object, fetchFn?: Function, esperar?: Function}} op
 */
export async function enviarAlerta({ url, token, alerta, fetchFn = (...a) => fetch(...a), esperar = ms => new Promise(r => setTimeout(r, ms)), timeoutMs = 15000 }) {
  let ultimo = null;
  for (let i = 0; i < ESPERAS_MS.length; i++) {
    if (ESPERAS_MS[i]) await esperar(ESPERAS_MS[i]);
    try {
      const r = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(alerta),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok || r.status === 502) return { ok: !!j.ok, status: r.status, canais: j.canais || {}, erro: j.erro || null, tentativas: i + 1 };
      ultimo = { ok: false, status: r.status, canais: j.canais || {}, erro: j.erro || `HTTP ${r.status}`, tentativas: i + 1 };
      if (r.status < 500 && r.status !== 429) return ultimo;   // erro do pedido: repetir não adianta
    } catch (e) {
      ultimo = { ok: false, status: 0, canais: {}, erro: e?.name === 'TimeoutError' ? 'o relé não respondeu em 15 s' : 'sem conexão com o relé', tentativas: i + 1, rede: true };
    }
  }
  return ultimo;
}

/** Resumo legível do resultado por canal (para a tela e o registro). */
export function resumoEnvio(r) {
  if (!r) return 'não enviado';
  const partes = [];
  const w = r.canais?.whatsapp;
  if (Array.isArray(w)) partes.push(`WhatsApp ${w.map(x => `${x.destino} ${x.ok ? '✓' : `✗ (${x.erro})`}`).join(', ')}`);
  const e = r.canais?.email;
  if (e) partes.push(`e-mail${e.provedor ? ` (${e.provedor})` : ''} ${e.ok ? `✓ ${(e.destinos || []).join(', ')}` : `✗ (${e.erro})`}`);
  const h = r.canais?.webhook;
  if (h) partes.push(`webhook ${h.ok ? '✓' : `✗ (${h.erro})`}`);
  if (!partes.length) return r.erro || (r.ok ? 'enviado' : 'falhou');
  return partes.join(' · ');
}

/**
 * Fila para quando não há rede: guarda e reenvia ao voltar a conexão.
 * Em memória de propósito — alerta de saúde de horas atrás não deve sair
 * depois de um recarregamento sem que ninguém veja.
 */
export function criarFila({ enviar, aoResultado = () => {}, alvo = globalThis }) {
  const pendentes = [];
  let ocupado = false;
  async function drenar() {
    if (ocupado) return;
    ocupado = true;
    try {
      while (pendentes.length) {
        const item = pendentes[0];
        const r = await enviar(item);
        if (r?.rede) break;   // ainda sem rede: espera o próximo "online"
        pendentes.shift();
        aoResultado(item, r);
      }
    } finally { ocupado = false; }
  }
  alvo.addEventListener?.('online', drenar);
  return {
    get tamanho() { return pendentes.length; },
    adicionar(item) { pendentes.push(item); return drenar(); },
    drenar,
  };
}
