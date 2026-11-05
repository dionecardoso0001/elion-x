/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA SPY — relé de notificação: avisa o responsável por WhatsApp
   (API oficial da Meta) e por e-mail (Resend ou Gmail API)

   Por que existe: a página no GitHub Pages é estática e pública — qualquer
   credencial colocada nela vaza. O relé guarda as credenciais e os
   DESTINATÁRIOS; o aparelho só manda o conteúdo do alerta, autenticado.

   Roda igual em dois lugares, só com APIs da web (fetch, Request/Response,
   Web Crypto):
     · servidor próprio (Node ≥ 20): rota /api/spy/alerta do server.mjs
     · Cloudflare Worker (rele/worker.mjs): grátis, 24 h, sem PC ligado

   Segurança:
     · destinatários FIXOS no relé (variáveis de ambiente) — o cliente não
       escolhe para quem vai: o relé não vira disparador de spam;
     · token por aparelho (≥ 16 caracteres), comparado em tempo constante;
     · limite de alertas por token a cada 10 min; corpo ≤ 8 KB;
     · CORS e checagem de Origin só para as origens configuradas;
     · campos do alerta em lista de permissão, sem caractere de controle,
       com tamanho máximo; o link do mapa é REFEITO aqui a partir de lat/lng;
     · a resposta mascara número e e-mail dos destinatários.

   Variáveis de ambiente (segredos via `wrangler secret put` ou .env):
     RELE_TOKENS          tokens dos aparelhos, vírgula: "carro1:abc…,carro2:def…"
     RELE_ORIGENS         origens do navegador permitidas (ex.: https://usuario.github.io)
     RELE_LIMITE_10MIN    alertas por token a cada 10 min (padrão 10)
     WHATSAPP_TOKEN       token de acesso da API do WhatsApp (Meta)
     WHATSAPP_PHONE_ID    ID do número remetente (painel da Meta)
     WHATSAPP_TEMPLATE    nome do modelo de mensagem APROVADO (5 variáveis: ver ALERTAS.md)
     WHATSAPP_IDIOMA      código do idioma do modelo (padrão pt_BR)
     WHATSAPP_GRAPH_VERSAO versão da Graph API (padrão v24.0)
     WHATSAPP_DESTINOS    números do(s) responsável(is), com DDI: 5511999998888
     EMAIL_DESTINOS       e-mail(s) do(s) responsável(is)
     EMAIL_REMETENTE      "Sentinela Spy <alertas@seudominio.com>"
     RESEND_API_KEY       (opção 1) chave do Resend — exige domínio verificado
     GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN   (opção 2) Gmail API, escopo gmail.send
     WEBHOOK_URL / WEBHOOK_SEGREDO  (opcional) POST JSON assinado com HMAC-SHA256
   ═══════════════════════════════════════════════════════════════════════ */

const LIMITES = { motorista: 80, veiculo: 40, situacao: 400, quando: 40 };
const TIPOS = ['alerta_saude', 'atualizacao', 'teste'];
const AVISO = 'Alerta automático de triagem por sinais observáveis — não é diagnóstico. Em emergência, SAMU 192.';
const TITULOS = {
  alerta_saude: '🚨 ALERTA DE SAÚDE — MOTORISTA',
  atualizacao: 'ℹ️ ATUALIZAÇÃO — MOTORISTA',
  teste: '✅ TESTE DO ALERTA — SENTINELA SPY',
};

const lista = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

/** Configuração a partir das variáveis de ambiente (o que não estiver completo fica desligado). */
export function lerConfiguracao(env = {}) {
  const tokens = lista(env.RELE_TOKENS)
    .map((t, i) => { const m = /^([A-Za-z0-9_.-]{1,40}):(.+)$/.exec(t); return m ? { nome: m[1], token: m[2] } : { nome: `aparelho-${i + 1}`, token: t }; })
    .filter(t => t.token.length >= 16);
  const wDest = lista(env.WHATSAPP_DESTINOS).map(n => n.replace(/\D/g, '')).filter(n => n.length >= 10);
  const eDest = lista(env.EMAIL_DESTINOS).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  let email = null;
  if (eDest.length && env.RESEND_API_KEY && env.EMAIL_REMETENTE) {
    email = { provedor: 'resend', chave: env.RESEND_API_KEY, remetente: env.EMAIL_REMETENTE, destinos: eDest };
  } else if (eDest.length && env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN) {
    email = { provedor: 'gmail', clientId: env.GMAIL_CLIENT_ID, clientSecret: env.GMAIL_CLIENT_SECRET,
      refreshToken: env.GMAIL_REFRESH_TOKEN, remetente: env.EMAIL_REMETENTE || '', destinos: eDest };
  }
  return {
    tokens,
    origens: lista(env.RELE_ORIGENS),
    porJanela: Math.max(1, Number(env.RELE_LIMITE_10MIN) || 10),
    whatsapp: env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID && env.WHATSAPP_TEMPLATE && wDest.length ? {
      token: env.WHATSAPP_TOKEN, phoneId: String(env.WHATSAPP_PHONE_ID), template: env.WHATSAPP_TEMPLATE,
      idioma: env.WHATSAPP_IDIOMA || 'pt_BR', versao: env.WHATSAPP_GRAPH_VERSAO || 'v24.0', destinos: wDest,
    } : null,
    email,
    webhook: /^https:\/\//.test(env.WEBHOOK_URL || '') ? { url: env.WEBHOOK_URL, segredo: env.WEBHOOK_SEGREDO || '' } : null,
  };
}

/** Alerta vindo do aparelho → alerta saneado (lista de permissão). Lança erro se inválido. */
export function validarAlerta(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('corpo inválido');
  if (!TIPOS.includes(c.tipo)) throw new Error('tipo de alerta inválido');
  const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const lat = Number(c.local?.lat), lng = Number(c.local?.lng);
  const temLocal = c.local != null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const prec = Number(c.local?.precisaoM);
  const vel = c.velocidadeKmh == null ? NaN : Number(c.velocidadeKmh);
  return {
    tipo: c.tipo,
    gravidade: ['critica', 'alta', 'info'].includes(c.gravidade) ? c.gravidade : (c.tipo === 'teste' ? 'info' : 'alta'),
    motorista: txt(c.motorista, LIMITES.motorista) || 'não informado',
    veiculo: txt(c.veiculo, LIMITES.veiculo) || 'não informado',
    situacao: txt(c.situacao, LIMITES.situacao) || '—',
    quando: txt(c.quando, LIMITES.quando) || new Date().toISOString(),
    // o link é refeito AQUI: o cliente não injeta URL nenhuma na mensagem
    local: temLocal ? { lat, lng, precisaoM: Number.isFinite(prec) ? Math.round(prec) : null, mapa: `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}` } : null,
    velocidadeKmh: Number.isFinite(vel) && vel >= 0 && vel < 400 ? Math.round(vel) : null,
    aviso: AVISO,
  };
}

export const assunto = a => `${TITULOS[a.tipo]}: ${a.motorista}${a.veiculo !== 'não informado' ? ` (${a.veiculo})` : ''}`;

export function textoAlerta(a) {
  return [
    TITULOS[a.tipo],
    `Motorista: ${a.motorista}`,
    `Veículo: ${a.veiculo}`,
    `Situação: ${a.situacao}`,
    `Local: ${a.local ? `${a.local.mapa}${a.local.precisaoM != null ? ` (±${a.local.precisaoM} m)` : ''}` : 'localização indisponível'}`,
    ...(a.velocidadeKmh != null ? [`Velocidade: ${a.velocidadeKmh} km/h`] : []),
    `Horário: ${a.quando}`,
    '',
    a.aviso,
  ].join('\n');
}

const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
export function htmlAlerta(a) {
  const cor = a.tipo === 'alerta_saude' ? '#c0102b' : a.tipo === 'teste' ? '#0b7a3b' : '#1f5fa8';
  const linha = (k, v) => `<tr><td style="padding:4px 12px 4px 0;color:#555">${esc(k)}</td><td style="padding:4px 0"><b>${v}</b></td></tr>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111">
<h2 style="color:${cor};margin:0 0 12px">${esc(TITULOS[a.tipo])}</h2>
<table role="presentation">${linha('Motorista', esc(a.motorista))}${linha('Veículo', esc(a.veiculo))}${linha('Situação', esc(a.situacao))}${
  linha('Local', a.local ? `<a href="${esc(a.local.mapa)}">abrir no mapa</a>${a.local.precisaoM != null ? ` (±${a.local.precisaoM} m)` : ''}` : 'indisponível')}${
  a.velocidadeKmh != null ? linha('Velocidade', `${a.velocidadeKmh} km/h`) : ''}${linha('Horário', esc(a.quando))}</table>
<p style="color:#555;font-size:13px;margin-top:16px">${esc(a.aviso)}</p></div>`;
}

/**
 * As 5 variáveis do modelo de WhatsApp: motorista, veículo, situação, local, horário.
 * A Meta recusa parâmetro com quebra de linha, tabulação ou mais de 4 espaços seguidos.
 */
export function parametrosWhatsApp(a) {
  const limpo = s => String(s).replace(/[\n\r\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 300) || '—';
  const prefixo = a.tipo === 'teste' ? 'TESTE — ' : a.tipo === 'atualizacao' ? 'ATUALIZAÇÃO — ' : '';
  return [a.motorista, a.veiculo, `${prefixo}${a.situacao}`, a.local ? a.local.mapa : 'localização indisponível', a.quando].map(limpo);
}

/* ── utilitários de codificação (Web APIs: iguais no Node e no Worker) ── */
function base64(texto) {
  const bytes = new TextEncoder().encode(texto);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const base64url = texto => base64(texto).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sha256(texto) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))); }
function iguais(a, b) { let d = a.length ^ b.length; for (let i = 0; i < Math.min(a.length, b.length); i++) d |= a[i] ^ b[i]; return d === 0; }
async function hmacHex(segredo, texto) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(texto)));
  return Array.from(s, b => b.toString(16).padStart(2, '0')).join('');
}
export const mascararTelefone = t => { const d = String(t).replace(/\D/g, ''); return d.length > 4 ? `+${d.slice(0, 2)} •••• ${d.slice(-4)}` : '••••'; };
export const mascararEmail = e => { const [u, dom] = String(e).split('@'); return dom ? `${u.slice(0, 2)}•••@${dom}` : '•••'; };

/** Mensagem MIME (RFC 2822) multipart texto + HTML, em UTF-8 — o que a Gmail API espera em `raw`. */
export function mensagemMime(email, a, fronteira = 'spy-' + Math.random().toString(36).slice(2)) {
  const quebrar = s => s.replace(/.{1,76}/g, '$&\r\n').trimEnd();
  return [
    ...(email.remetente ? [`From: ${email.remetente}`] : []),
    `To: ${email.destinos.join(', ')}`,
    `Subject: =?UTF-8?B?${base64(assunto(a))}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${fronteira}"`,
    '',
    `--${fronteira}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', quebrar(base64(textoAlerta(a))),
    `--${fronteira}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', quebrar(base64(htmlAlerta(a))),
    `--${fronteira}--`, '',
  ].join('\r\n');
}

/* ── canais ── */
const comPrazo = (f, url, init, ms = 10000) => f(url, { ...init, signal: AbortSignal.timeout(ms) });
const erroDe = (e, rotulo) => ({ ok: false, erro: `${rotulo}: ${e?.name === 'TimeoutError' ? 'sem resposta em 10 s' : (e?.message || e)}` });

async function enviarWhatsApp(w, a, f) {
  const url = `https://graph.facebook.com/${w.versao}/${encodeURIComponent(w.phoneId)}/messages`;
  const parameters = parametrosWhatsApp(a).map(text => ({ type: 'text', text }));
  return Promise.all(w.destinos.map(async to => {
    try {
      const r = await comPrazo(f, url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${w.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template',
          template: { name: w.template, language: { code: w.idioma }, components: [{ type: 'body', parameters }] } }),
      });
      const j = await r.json().catch(() => ({}));
      return r.ok ? { destino: mascararTelefone(to), ok: true, id: j?.messages?.[0]?.id ?? null }
        : { destino: mascararTelefone(to), ok: false, erro: `${j?.error?.message || `HTTP ${r.status}`}${j?.error?.code ? ` (código ${j.error.code})` : ''}` };
    } catch (e) { return { destino: mascararTelefone(to), ...erroDe(e, 'WhatsApp') }; }
  }));
}

async function enviarResend(e, a, f) {
  try {
    const r = await comPrazo(f, 'https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${e.chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: e.remetente, to: e.destinos, subject: assunto(a), text: textoAlerta(a), html: htmlAlerta(a) }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, provedor: 'resend', id: j?.id ?? null, destinos: e.destinos.map(mascararEmail) }
      : { ok: false, provedor: 'resend', erro: j?.message || `HTTP ${r.status}` };
  } catch (x) { return { provedor: 'resend', ...erroDe(x, 'Resend') }; }
}

async function enviarGmail(e, a, f) {
  try {
    const t = await comPrazo(f, 'https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: e.clientId, client_secret: e.clientSecret, refresh_token: e.refreshToken, grant_type: 'refresh_token' }).toString(),
    });
    const tj = await t.json().catch(() => ({}));
    if (!t.ok || !tj.access_token) {
      // refresh token de projeto em modo "Testing" expira em 7 dias; troca de senha do Google também o revoga
      return { ok: false, provedor: 'gmail', erro: `autorização do Gmail recusada (${tj.error_description || tj.error || `HTTP ${t.status}`}) — gere o GMAIL_REFRESH_TOKEN de novo` };
    }
    const r = await comPrazo(f, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: { Authorization: `Bearer ${tj.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: base64url(mensagemMime(e, a)) }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, provedor: 'gmail', id: j?.id ?? null, destinos: e.destinos.map(mascararEmail) }
      : { ok: false, provedor: 'gmail', erro: j?.error?.message || `HTTP ${r.status}` };
  } catch (x) { return { provedor: 'gmail', ...erroDe(x, 'Gmail') }; }
}

async function enviarWebhook(w, a, f) {
  try {
    const corpo = JSON.stringify({ origem: 'sentinela-spy', alerta: a });
    const headers = { 'Content-Type': 'application/json' };
    if (w.segredo) headers['X-Sentinela-Assinatura'] = `sha256=${await hmacHex(w.segredo, corpo)}`;
    const r = await comPrazo(f, w.url, { method: 'POST', headers, body: corpo });
    return r.ok ? { ok: true } : { ok: false, erro: `HTTP ${r.status}` };
  } catch (x) { return erroDe(x, 'webhook'); }
}

/** Envia por todos os canais configurados, em paralelo. ok = pelo menos um canal entregou. */
export async function despachar(cfg, alerta, f = fetch) {
  const tarefas = {};
  if (cfg.whatsapp) tarefas.whatsapp = enviarWhatsApp(cfg.whatsapp, alerta, f);
  if (cfg.email) tarefas.email = cfg.email.provedor === 'resend' ? enviarResend(cfg.email, alerta, f) : enviarGmail(cfg.email, alerta, f);
  if (cfg.webhook) tarefas.webhook = enviarWebhook(cfg.webhook, alerta, f);
  const nomes = Object.keys(tarefas);
  if (!nomes.length) return { ok: false, canais: {}, erro: 'nenhum canal configurado no relé (WhatsApp, e-mail ou webhook)' };
  const res = await Promise.all(nomes.map(n => tarefas[n]));
  const canais = Object.fromEntries(nomes.map((n, i) => [n, res[i]]));
  const entregue = r => (Array.isArray(r) ? r.some(x => x.ok) : !!r?.ok);
  return { ok: nomes.some(n => entregue(canais[n])), canais };
}

/**
 * Manipulador HTTP no padrão Fetch (Request → Response): é o próprio Worker, e o
 * server.mjs adapta a requisição do Node para ele.
 *   POST …/alerta  → envia (corpo: alerta montado pelo aparelho)
 *   GET  …/estado  → canais configurados (sem segredo), exige token
 */
export function criarRele({ env = {}, fetchFn = (...a) => fetch(...a), agora = () => Date.now() } = {}) {
  const cfg = lerConfiguracao(env);
  const usos = new Map();   // token → instantes dos últimos alertas (por instância: no Worker, por isolate)
  const hashes = Promise.all(cfg.tokens.map(async t => ({ nome: t.nome, h: await sha256(t.token) })));

  const cors = origem => (origem && cfg.origens.includes(origem)
    ? { 'Access-Control-Allow-Origin': origem, 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Max-Age': '600', Vary: 'Origin' }
    : {});
  const responder = (status, obj, origem, extra = {}) => new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...cors(origem), ...extra },
  });

  async function autenticar(cabecalho) {
    const m = /^Bearer\s+(.+)$/.exec(cabecalho || '');
    if (!m) return null;
    const h = await sha256(m[1]);
    let achado = null;
    for (const t of await hashes) if (iguais(h, t.h)) achado = t.nome;   // percorre todos: sem atalho de tempo
    return achado;
  }

  const estado = () => ({
    whatsapp: cfg.whatsapp ? { destinos: cfg.whatsapp.destinos.map(mascararTelefone), modelo: cfg.whatsapp.template } : null,
    email: cfg.email ? { provedor: cfg.email.provedor, destinos: cfg.email.destinos.map(mascararEmail) } : null,
    webhook: !!cfg.webhook,
  });

  return {
    configuracao: cfg,
    get configurado() { return cfg.tokens.length > 0 && !!(cfg.whatsapp || cfg.email || cfg.webhook); },
    estado,
    async tratar(req) {
      const origem = req.headers.get('origin');
      if (origem && cfg.origens.length && !cfg.origens.includes(origem)) return responder(403, { erro: 'origem não autorizada neste relé' }, null);
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origem) });
      if (!cfg.tokens.length) return responder(503, { erro: 'relé sem RELE_TOKENS configurado — recusando operar aberto' }, origem);
      const aparelho = await autenticar(req.headers.get('authorization'));
      if (!aparelho) return responder(401, { erro: 'token do aparelho inválido ou ausente' }, origem);
      const caminho = new URL(req.url).pathname;
      if (req.method === 'GET' && caminho.endsWith('/estado')) return responder(200, { ok: true, aparelho, canais: estado() }, origem);
      if (req.method !== 'POST') return responder(405, { erro: 'use POST' }, origem, { Allow: 'POST, GET, OPTIONS' });

      const janela = (usos.get(aparelho) || []).filter(x => agora() - x < 600000);
      if (janela.length >= cfg.porJanela) return responder(429, { erro: `limite de ${cfg.porJanela} alertas em 10 min para este aparelho`, tentar_em_s: 60 }, origem, { 'Retry-After': '60' });
      let texto;
      try { texto = await req.text(); } catch { return responder(400, { erro: 'corpo ilegível' }, origem); }
      if (texto.length > 8192) return responder(413, { erro: 'alerta grande demais' }, origem);
      let corpo, alerta;
      try { corpo = JSON.parse(texto); } catch { return responder(400, { erro: 'JSON inválido' }, origem); }
      try { alerta = validarAlerta(corpo); } catch (e) { return responder(400, { erro: e.message }, origem); }
      janela.push(agora()); usos.set(aparelho, janela);
      const r = await despachar(cfg, alerta, fetchFn);
      return responder(r.ok ? 200 : 502, { ...r, aparelho, tipo: alerta.tipo }, origem);
    },
  };
}
