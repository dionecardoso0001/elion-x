// Cliente da API. Modo servidor: fetch + SSE (mutação com cabeçalho anti-CSRF; cookie HttpOnly).
// Modo autônomo: o mesmo contrato atendido pelo backend local no navegador.

const local = () => globalThis.__SENTINEL_LOCAL__;

async function call(method, url, body) {
  if (local()) {
    const r = await local().request(method, url, body);
    if (r.status >= 400) throw Object.assign(new Error(r.body?.error || `HTTP ${r.status}`), { status: r.status });
    return r.text ?? r.body;
  }
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-Sentinel-Csrf': '1' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

export const api = {
  get: (u) => call('GET', u),
  post: (u, b = {}) => call('POST', u, b),
  put: (u, b = {}) => call('PUT', u, b),
};

/** Baixa um arquivo gerado pela API (relatórios) nos dois modos. */
export async function download(url, fallbackName = 'sentinel.md') {
  let blob, name = fallbackName;
  if (local()) {
    const r = await local().request('GET', url);
    if (r.status >= 400) throw new Error(r.body?.error || `HTTP ${r.status}`);
    blob = new Blob([r.text ?? JSON.stringify(r.body, null, 2)], { type: r.contentType || 'text/plain' });
    name = r.filename || name;
  } else {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
    name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || name;
  }
  // Hospedado no visualizador de artefatos: downloads diretos são bloqueados; usa a capacidade "downloads"
  if (typeof globalThis.claude?.use === 'function') {
    const host = await globalThis.claude.use('downloads');
    if (!host) throw new Error('Este visualizador não permite salvar arquivos. Use a versão standalone/sentinel-3d.html ou o servidor.');
    try { await host.save({ filename: name, data: blob }); } catch (e) {
      if (e?.code === 'declined') return; // o operador recusou: não é erro
      throw new Error(e?.message || 'Não foi possível salvar o arquivo.');
    }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Tempo real: SSE (servidor) ou assinatura direta (autônomo). */
export function connectStream(handlers) {
  if (local()) return local().stream(handlers);
  const { onSnapshot, onUpdate, onNotify, onState } = handlers;
  const es = new EventSource('/api/stream');
  es.addEventListener('snapshot', (e) => onSnapshot(JSON.parse(e.data)));
  es.addEventListener('update', (e) => onUpdate(JSON.parse(e.data)));
  es.addEventListener('notify', (e) => onNotify(JSON.parse(e.data)));
  es.onopen = () => onState?.('aberto');
  es.onerror = () => onState?.('reconectando');
  return es;
}
