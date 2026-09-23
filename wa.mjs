/**
 * ELION-X · Módulo WhatsApp (whatsapp-web.js)
 * Resposta automática com lista de permissão + PROTEÇÕES anti-banimento:
 *   · só responde contatos explicitamente liberados (allowlist)
 *   · ignora grupos e status
 *   · "digitando…" + atraso aleatório humano (4–14s)
 *   · limite de frequência: 1/contato a cada 30s, máx 20/hora global
 *   · interruptor geral de auto-resposta (começa DESLIGADO)
 *   · usa o Chrome do sistema (sem baixar navegador)
 *
 * ⚠️ Automatizar WhatsApp pessoal viola os Termos do WhatsApp e pode levar a
 *    banimento do número. Use preferencialmente um número secundário.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR    = path.join(__dirname, 'data');
const ALLOW_FILE  = path.join(DATA_DIR, 'wa-allow.json');
const LOG_FILE    = path.join(DATA_DIR, 'wa-log.json');
const SESSION_DIR = path.join(DATA_DIR, 'wa-session');

let Client, LocalAuth;
let client = null;
let onReplyGen = null; // injetado pelo server (gera resposta via Claude)
const state = { status: 'off', qr: '', me: '', autoReply: false, startedAt: 0, error: '' };
let watchdog = null;      // mata conexões travadas em starting/loading
let reconnects = 0;       // tentativas de reconexão automática
let lastChromePath = '';  // para a reconexão usar o mesmo Chrome
const CACHE_DIR = path.join(__dirname, '.wwebjs_cache');

const recentReplyAt = new Map(); // contato → timestamp (limite por contato)
let hourWindow = [];             // timestamps das auto-respostas na última hora

// ── allowlist + log ──────────────────────────────────────────────────────────
function allowRead()  { try { return JSON.parse(fs.readFileSync(ALLOW_FILE, 'utf8')); } catch { return []; } }
function allowWrite(l){ fs.writeFileSync(ALLOW_FILE, JSON.stringify(l, null, 2)); }
function logAppend(e) { let l = []; try { l = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch {} l.push(e); fs.writeFileSync(LOG_FILE, JSON.stringify(l.slice(-200), null, 2)); }
const norm = q => (q || '').replace(/\D/g, '');
const isAllowed = id => allowRead().some(x => x.id === id);

// ── busca FUZZY de contatos ──────────────────────────────────────────────────
// O operador fala o nome de qualquer jeito ("Carlos DaEmpresa", "AnaLima",
// "carlos da empresa") — normalizamos acentos/espaços/caixa e pontuamos por
// aproximação para achar o contato certo mesmo com o nome "errado".
const simplify = s => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')  // remove acentos
  .replace(/[^a-z0-9]/g, '');                        // remove espaços/pontuação

function scoreName(queryS, queryTokens, nameRaw) {
  const nameS = simplify(nameRaw);
  if (!nameS || !queryS) return 0;
  if (nameS === queryS) return 100;                          // igual (ignorando acento/espaço)
  if (nameS.startsWith(queryS) || queryS.startsWith(nameS)) return 92;
  if (nameS.includes(queryS)) return 85;                     // "joaosouza" acha "PedroCosta"
  if (queryS.includes(nameS) && nameS.length >= 4) return 75;
  const hits = queryTokens.filter(t => t.length >= 2 && nameS.includes(t));
  if (queryTokens.length && hits.length === queryTokens.length) return 70 + Math.min(10, queryTokens.length * 2);
  if (hits.length) return Math.round(30 + 40 * hits.length / queryTokens.length); // parte dos tokens
  // prefixo comum: nome salvo mais curto que o falado ("AnaLima" acha "FilhaJoaoSouza" via "joaosouza")
  for (const t of queryTokens.length ? queryTokens : [queryS]) {
    for (let L = Math.min(t.length, 8); L >= 4; L--) {
      if (nameS.includes(t.slice(0, L))) return 45 + L * 3; // 57-69
    }
  }
  return 0;
}

/** procura contatos/conversas por nome aproximado ou número → candidatos rankeados.
 *  Estratégia leve: 1º só nas CONVERSAS (rápido); a agenda completa (getContacts,
 *  pesada — pode ter milhares) só entra se as conversas não deram um candidato forte,
 *  com timeout e cache para não derrubar a página do WhatsApp Web. */
let contactsCache = { at: 0, list: [] };
const withTimeout = (p, ms, tag) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(tag + ' demorou demais')), ms))]);

export async function searchContacts(query, limit = 6) {
  if (state.status !== 'ready') throw new Error('WhatsApp não conectado');
  const queryS = simplify(query);
  const queryTokens = String(query || '').split(/\s+/).map(simplify).filter(Boolean);
  const digits = norm(query);
  const byId = new Map();
  const push = (id, name, number, extra) => {
    let score = scoreName(queryS, queryTokens, name);
    if (digits.length >= 8 && (number || '').includes(digits)) score = Math.max(score, 88); // busca por número
    if (score <= 0) return;
    const cur = byId.get(id);
    if (!cur || score > cur.score) byId.set(id, { id, name: name || number || id, number: number || '', score, ...extra });
  };
  const chats = await withTimeout(client.getChats(), 30000, 'getChats');
  for (const c of chats) push(c.id._serialized, c.name || c.id.user, c.id.user, { isGroup: !!c.isGroup, hasChat: true, unread: c.unreadCount || 0 });
  const forte = [...byId.values()].some(c => c.score >= 55); // já há candidato razoável nas conversas
  if (!forte) { // agenda completa só como último recurso (getContacts é pesado e pode travar)
    try {
      const list = (Date.now() - contactsCache.at < 300000)
        ? contactsCache.list
        : await withTimeout(fetchContactsBook(), 12000, 'getContacts'); // curto: se travar, segue com as conversas
      for (const c of list) push(c.id, c.name, c.number, { isGroup: false, hasChat: byId.has(c.id) });
    } catch (e) {
      // timeout: usa o cache antigo se houver; a carga em andamento termina em 2º plano e abastece a próxima busca
      for (const c of contactsCache.list) push(c.id, c.name, c.number, { isGroup: false, hasChat: byId.has(c.id) });
      console.warn('[wa] agenda completa lenta/indisponível agora:', e.message);
    }
  }
  return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

// carga única da agenda completa (single-flight): nunca dispara duas getContacts
// em paralelo (era isso que derrubava a página) e abastece o cache ao terminar
let contactsFetching = null;
function fetchContactsBook() {
  if (!contactsFetching) {
    contactsFetching = client.getContacts()
      .then(cs => {
        contactsCache = {
          at: Date.now(),
          list: cs.filter(c => c.isMyContact || c.name || c.pushname)
                  .map(c => ({ id: c.id._serialized, name: c.name || c.pushname || c.number, number: c.number || c.id.user })),
        };
        console.log(`[wa] agenda completa carregada: ${contactsCache.list.length} contatos em cache`);
        return contactsCache.list;
      })
      .finally(() => { contactsFetching = null; });
  }
  return contactsFetching;
}

export function getState()  { return { ...state, allow: allowRead(), connected: state.status === 'ready' }; }
export function getQR()     { return state.qr; }
export function setAutoReply(v) { state.autoReply = !!v; return state.autoReply; }
export function setReplyGenerator(fn) { onReplyGen = fn; }
export function allowListGet() { return allowRead(); }
export function allowAdd(id, name, profile) {
  const l = allowRead();
  const cur = l.find(x => x.id === id);
  if (cur) { if (name) cur.name = name; if (profile) cur.profile = profile; }
  else l.push({ id, name: name || id, ...(profile ? { profile } : {}) });
  allowWrite(l);
  return allowRead();
}
export function allowSetProfile(id, profile) { const l = allowRead(); const c = l.find(x => x.id === id); if (c) { c.profile = profile; allowWrite(l); } return !!c; }
export function allowGetEntry(id) { return allowRead().find(x => x.id === id) || null; }
export function allowRemove(id) { allowWrite(allowRead().filter(x => x.id !== id)); return allowRead(); }
export function logRead() { try { return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch { return []; } }

// ── conexão ──────────────────────────────────────────────────────────────────
// Modo padrão: HEADLESS — o QR aparece DENTRO da plataforma (painel WhatsApp),
// como no portal do WhatsApp Web. Sessão persiste (LocalAuth): depois do 1º
// escaneio, reconecta sozinho SEM pedir QR de novo. WA_HEADFUL=1 volta a abrir
// a janela visível do Chrome (modo antigo), se um dia for preciso depurar.
// Chrome zumbi segurando o perfil da sessão = "Failed to launch the browser process".
// Mata qualquer chrome.exe órfão que esteja usando o diretório wa-session antes de lançar outro.
function killZombieChrome() {
  if (process.platform !== 'win32') return;
  try {
    const ps = `Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -match 'wa-session' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    execSync(`powershell -NoProfile -Command "${ps}"`, { timeout: 20000, stdio: 'ignore' });
  } catch {}
}

function armWatchdog(ms = 120000) {
  clearTimeout(watchdog);
  watchdog = setTimeout(async () => {
    if (!['starting', 'loading'].includes(state.status)) return;
    console.warn(`[wa] travado em "${state.status}" — limpando cache do WhatsApp Web e liberando para nova tentativa`);
    try { await client?.destroy(); } catch {}
    client = null;
    try { fs.rmSync(CACHE_DIR, { recursive: true, force: true }); } catch {}
    state.status = 'error';
    state.error = 'A conexão travou no carregamento. Cache limpo — clique em Conectar de novo.';
  }, ms);
}

export async function connect(chromePath) {
  if (client && ['starting', 'qr', 'loading', 'ready', 'authenticated'].includes(state.status)) return state; // já em andamento/conectado
  if (client) { try { await client.destroy(); } catch {} client = null; }  // sobrou client em erro → recomeça limpo
  if (!Client) {
    const mod = require('whatsapp-web.js');
    Client = mod.Client; LocalAuth = mod.LocalAuth;
  }
  lastChromePath = chromePath || lastChromePath;
  state.status = 'starting'; state.error = ''; state.qr = '';
  killZombieChrome();                                   // libera o perfil antes de lançar
  await new Promise(r => setTimeout(r, 800));           // deixa o Windows soltar os locks
  // O service worker do WhatsApp Web (gravado no perfil) serve a versão NOVA da
  // app sem passar pela rede — ignorando a versão PINADA (webVersionCache).
  // Removê-lo força a página a buscar via rede, onde o wwebjs injeta a versão
  // pinada. O login (IndexedDB/LocalStorage) NÃO é afetado — sessão continua.
  // (Apenas o SW: apagar Cache/Code Cache forçaria re-download e sync longos.)
  try { fs.rmSync(path.join(SESSION_DIR, 'session', 'Default', 'Service Worker'), { recursive: true, force: true }); } catch {}
  const headful = process.env.WA_HEADFUL === '1';
  // Versão do WhatsApp Web PINADA: as versões novas quebram o getChats() do
  // whatsapp-web.js 1.34.7 (erro minificado "r"). Esta é a de 08/07/2026 —
  // validada funcionando nesta plataforma — e expira ~08/09/2026.
  // Se um dia travar por expiração: escolher uma recente em
  // https://raw.githubusercontent.com/wppconnect-team/wa-version/main/versions.json
  // e trocar aqui ou via env WA_WEB_VERSION.
  const webVersion = process.env.WA_WEB_VERSION || '2.3000.1042852868-alpha';
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
    webVersion,
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html',
    },
    puppeteer: {
      headless: !headful,
      executablePath: lastChromePath || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
             '--no-first-run', '--no-default-browser-check',
             ...(headful ? ['--window-size=920,780', '--window-position=120,50'] : [])],
    },
  });
  armWatchdog();
  let qrCount = 0;
  client.on('qr', qr => {
    clearTimeout(watchdog); // esperando o operador escanear — sem prazo
    state.qr = qr; state.status = 'qr'; qrCount++;
    console.log(`[wa] QR #${qrCount} gerado — exibido no painel da plataforma (renova sozinho)`);
  });
  client.on('loading_screen', (p, m) => { if (state.status !== 'ready') { state.status = 'loading'; armWatchdog(300000); } console.log('[wa] carregando…', p || '', m || ''); });
  client.on('authenticated', () => { state.qr = ''; state.status = 'loading'; armWatchdog(300000); console.log('[wa] ✓ autenticado — sincronizando conversas… (pode levar minutos na 1ª vez)'); });
  client.on('auth_failure', async m => {
    clearTimeout(watchdog);
    try { await client?.destroy(); } catch {}
    client = null;
    killZombieChrome();
    // sessão salva rejeitada/corrompida → limpa para o próximo Conectar gerar QR novo e limpo
    try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
    state.status = 'error'; state.error = 'A sessão salva foi rejeitada. Limpei os dados — clique em Conectar para gerar um QR novo.';
    console.warn('[wa] auth_failure:', m, '→ sessão limpa');
  });
  client.on('ready', () => {
    clearTimeout(watchdog);
    state.status = 'ready'; state.qr = ''; state.startedAt = Date.now(); reconnects = 0;
    try { state.me = client.info?.wid?.user || ''; } catch {}
    console.log('[wa] ✓ WhatsApp CONECTADO:', state.me);
    client.getWWebVersion?.().then(v => { state.webVersion = v; console.log('[wa] versão WhatsApp Web em uso:', v, v === webVersion ? '(pinada ✓)' : '(≠ da pinada ' + webVersion + ')'); }).catch(() => {});
  });
  client.on('disconnected', r => {
    clearTimeout(watchdog);
    state.status = 'disconnected'; state.error = String(r || ''); client = null;
    console.warn('[wa] desconectado:', r);
    // reconexão automática com a sessão salva (sem QR), até 3 tentativas
    if (String(r).toUpperCase().includes('LOGOUT')) return; // deslogado no celular → precisa de QR novo, não insiste
    if (reconnects < 3) {
      reconnects++;
      const wait = 5000 * reconnects;
      console.log(`[wa] reconectando automaticamente em ${wait / 1000}s (tentativa ${reconnects}/3)…`);
      setTimeout(() => { connect(lastChromePath).catch(() => {}); }, wait);
    }
  });
  client.on('message', handleIncoming);
  client.initialize().catch(async e => {
    clearTimeout(watchdog);
    state.status = 'error'; state.error = e.message;
    try { await client?.destroy(); } catch {}
    client = null;
    // cache do WhatsApp Web corrompido é a causa clássica — limpa para a próxima tentativa
    try { fs.rmSync(CACHE_DIR, { recursive: true, force: true }); } catch {}
    console.warn('[wa] init erro:', e.message);
  });
  return state;
}

export async function disconnect() {
  clearTimeout(watchdog);
  reconnects = 3; // impede reconexão automática após desconexão manual
  try { await client?.destroy(); } catch {}
  client = null; state.status = 'off'; state.qr = ''; state.me = '';
}

// ── auto-resposta (com todas as proteções) ───────────────────────────────────
async function handleIncoming(msg) {
  try {
    if (state.status !== 'ready' || !state.autoReply) return;
    if (msg.isStatus || msg.fromMe) return;
    const from = msg.from;
    if (from.endsWith('@g.us')) return;            // ignora grupos
    if (!isAllowed(from)) return;                  // só contatos liberados
    if (!onReplyGen) return;

    const now = Date.now();
    if (now - (recentReplyAt.get(from) || 0) < 30000) return;   // 1 por contato/30s
    hourWindow = hourWindow.filter(t => now - t < 3600000);
    if (hourWindow.length >= 20) return;                        // máx 20/hora

    const chat = await msg.getChat();
    const msgs = await chat.fetchMessages({ limit: 16 });
    const history = msgs.map(m => ({ fromMe: m.fromMe, body: m.body })).filter(m => m.body);
    let contact = from.replace('@c.us', '');
    try { const c = await msg.getContact(); contact = c.pushname || c.name || c.number || contact; } catch {}
    const entry = allowRead().find(x => x.id === from); // perfil aprendido do relacionamento (tom, apelidos, assuntos)
    const reply = await onReplyGen({ contact: entry?.name || contact, history, incoming: msg.body, profile: entry?.profile || '' });
    if (!reply || !reply.trim()) return;

    // humanização: "digitando…" + atraso aleatório
    try { await chat.sendStateTyping(); } catch {}
    await new Promise(r => setTimeout(r, 4000 + Math.random() * 10000));
    await client.sendMessage(from, reply.trim());

    recentReplyAt.set(from, Date.now());
    hourWindow.push(Date.now());
    logAppend({ at: new Date().toISOString(), to: from, contact, incoming: msg.body, reply: reply.trim() });
    console.log('[wa] auto-resposta enviada a', contact);
  } catch (e) { console.warn('[wa] auto-reply erro:', e.message); }
}

// ── leitura / envio (usado pelas ferramentas do agente) ──────────────────────
// Busca FUZZY: aceita id serializado, número ou nome aproximado/falado.
async function findChat(query) {
  const q = String(query || '');
  const chats = await client.getChats();
  if (/@(c|g)\.us$/.test(q)) return chats.find(c => c.id._serialized === q) || null; // id exato
  const queryS = simplify(q);
  const queryTokens = q.split(/\s+/).map(simplify).filter(Boolean);
  const digits = norm(q);
  let best = null, bestScore = 0;
  for (const c of chats) {
    let s = scoreName(queryS, queryTokens, c.name || '');
    if (digits.length >= 8 && c.id.user.includes(digits)) s = Math.max(s, 88);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return bestScore >= 45 ? best : null; // abaixo disso é chute — melhor dizer que não achou
}

export async function listChats(limit = 12) {
  if (state.status !== 'ready') throw new Error('WhatsApp não conectado');
  const chats = await client.getChats();
  return chats.slice(0, limit).map(c => ({
    id: c.id._serialized, name: c.name || c.id.user, unread: c.unreadCount || 0,
    isGroup: !!c.isGroup, last: (c.lastMessage?.body || '').slice(0, 140), ts: c.timestamp || 0,
  }));
}

export async function readChat(query, limit = 15) {
  if (state.status !== 'ready') throw new Error('WhatsApp não conectado');
  const c = await findChat(query);
  if (!c) throw new Error(`Conversa "${query}" não encontrada`);
  const msgs = await c.fetchMessages({ limit: Math.min(Math.max(limit, 1), 300) });
  return {
    name: c.name || c.id.user, id: c.id._serialized, isGroup: !!c.isGroup,
    messages: msgs.map(m => ({ fromMe: m.fromMe, body: m.body, ts: m.timestamp })),
  };
}

export async function sendMessage(query, text) {
  if (state.status !== 'ready') throw new Error('WhatsApp não conectado');
  let to = query;
  if (!query.includes('@')) {
    const c = await findChat(query);
    to = c ? c.id._serialized : norm(query) + '@c.us';
  }
  await client.sendMessage(to, text);
  return to;
}
