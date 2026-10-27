// Cliente da API. Mutação sempre com cabeçalho anti-CSRF; cookie de sessão é HttpOnly.

async function call(method, url, body) {
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

/** SSE com reconexão nativa do EventSource. */
export function connectStream({ onSnapshot, onUpdate, onNotify, onState }) {
  const es = new EventSource('/api/stream');
  es.addEventListener('snapshot', (e) => onSnapshot(JSON.parse(e.data)));
  es.addEventListener('update', (e) => onUpdate(JSON.parse(e.data)));
  es.addEventListener('notify', (e) => onNotify(JSON.parse(e.data)));
  es.onopen = () => onState?.('aberto');
  es.onerror = () => onState?.('reconectando');
  return es;
}
