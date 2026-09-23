/**
 * ELION-X · CATÁLOGO DE APIS PÚBLICAS
 *
 * As 796 APIs do repositório public-apis que NÃO exigem conta nem chave.
 * Fonte: https://github.com/public-apis/public-apis (MIT), filtradas por Auth="No".
 *
 * POR QUE DUAS FERRAMENTAS E NÃO 796:
 * O ELION tem 42 ferramentas. Declarar uma por API daria 838 — e muito antes
 * disso o modelo perde a capacidade de escolher a ferramenta certa, porque a
 * lista vira ruído. Aqui ele ganha CONHECIMENTO (busca no catálogo) e
 * CAPACIDADE (chama qualquer uma delas) com duas entradas apenas.
 *
 * SEGURANÇA — a razão de este arquivo existir em vez de um fetch genérico:
 * uma ferramenta que busca URL arbitrária é SSRF pronta. Um texto vindo de
 * fora poderia mandar o agente ler http://localhost:3001/api/whatsapp/chats ou
 * um endpoint de metadados de nuvem. A defesa aqui é lista de permissão: só
 * saem requisições para os 693 domínios do catálogo, e nunca para IP privado.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns/promises';
import net from 'net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

let CATALOGO = null;
let DOMINIOS = null;

function carregar() {
  if (CATALOGO) return CATALOGO;
  try {
    CATALOGO = JSON.parse(fs.readFileSync(path.join(__dirname, 'apis-publicas.json'), 'utf8'));
  } catch (e) {
    console.warn('[apis] catálogo indisponível:', e.message);
    CATALOGO = [];
  }
  // domínio permitido = o host da API + qualquer subdomínio dele
  DOMINIOS = new Set();
  for (const a of CATALOGO) {
    try { DOMINIOS.add(new URL(a.u).hostname.replace(/^www\./, '').toLowerCase()); } catch {}
  }
  return CATALOGO;
}

const semAcento = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Busca no catálogo por nome, descrição ou categoria. */
export function buscar(termo, { categoria = '', limite = 12 } = {}) {
  const cat = carregar();
  const q = semAcento(termo).split(/\s+/).filter(t => t.length >= 2);
  const filtroCat = semAcento(categoria);

  const pontuados = cat.map(a => {
    if (filtroCat && !semAcento(a.c).includes(filtroCat)) return null;
    if (!q.length) return { a, p: 1 };
    const nome = semAcento(a.n), desc = semAcento(a.d), c = semAcento(a.c);
    let p = 0;
    for (const t of q) {
      if (nome.includes(t)) p += 10;        // nome vale mais que descrição
      else if (desc.includes(t)) p += 4;
      else if (c.includes(t)) p += 2;
      else return null;                      // exige TODOS os termos
    }
    return { a, p };
  }).filter(Boolean).sort((x, y) => y.p - x.p);

  return pontuados.slice(0, limite).map(({ a }) => ({
    nome: a.n, url: a.u, descricao: a.d, categoria: a.c, https: a.https,
  }));
}

export function categorias() {
  const cat = carregar();
  const m = {};
  for (const a of cat) m[a.c] = (m[a.c] || 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([nome, total]) => ({ nome, total }));
}

export function total() { return carregar().length; }

/* ── proteção contra SSRF ──────────────────────────────────────────────────
   Bloquear por texto ("localhost", "127.") não basta: um domínio público pode
   resolver para IP privado (DNS rebinding). Por isso resolvemos o host e
   conferimos o IP de verdade antes de deixar a requisição sair. */
const privado = ip => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 ||
           (a === 172 && b >= 16 && b <= 31) ||
           (a === 192 && b === 168) ||
           (a === 169 && b === 254) ||
           (a === 100 && b >= 64 && b <= 127);
  }
  const s = ip.toLowerCase();
  return s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80');
};

async function verificarDestino(u) {
  const url = new URL(u);
  if (!/^https?:$/.test(url.protocol)) throw new Error('só http/https são permitidos');
  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  // lista de permissão: o host tem de ser (ou ser subdomínio de) um do catálogo
  const permitido = DOMINIOS.has(host) ||
    [...DOMINIOS].some(d => host === d || host.endsWith('.' + d));
  if (!permitido) {
    throw new Error(`domínio "${host}" não está no catálogo de APIs públicas. ` +
      `Esta ferramenta só alcança as 796 APIs catalogadas — use buscar_api para achar a certa.`);
  }

  let ips = [];
  try { ips = (await dns.lookup(host, { all: true })).map(r => r.address); }
  catch (e) { throw new Error(`não consegui resolver "${host}": ${e.message}`); }
  const ruim = ips.find(privado);
  if (ruim) throw new Error(`"${host}" resolve para endereço interno (${ruim}) — bloqueado`);
  return url;
}

/** Chama uma API do catálogo. Somente GET, somente domínio catalogado. */
export async function consultar(endpoint, { limite = 12000 } = {}) {
  carregar();
  const url = await verificarDestino(String(endpoint || '').trim());

  const r = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });

  const tipo = r.headers.get('content-type') || '';
  const bruto = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${bruto.slice(0, 200)}`);

  // JSON volta formatado; HTML é sinal de endpoint errado, e dizer isso
  // explicitamente evita o agente tentar interpretar uma página de erro
  if (/json/i.test(tipo)) {
    try {
      const j = JSON.parse(bruto);
      const txt = JSON.stringify(j, null, 1);
      return { ok: true, tipo: 'json', host: url.hostname,
               texto: txt.length > limite ? txt.slice(0, limite) + '\n… (resposta truncada)' : txt };
    } catch { /* content-type mentiu; cai no texto */ }
  }
  if (/html/i.test(tipo))
    return { ok: false, tipo: 'html', host: url.hostname,
             texto: 'O endereço devolveu uma PÁGINA HTML, não dados. Provavelmente é a documentação ' +
                    'da API e não um endpoint. Procure o endpoint real na documentação.' };
  return { ok: true, tipo: 'texto', host: url.hostname,
           texto: bruto.length > limite ? bruto.slice(0, limite) + '\n… (truncado)' : bruto };
}

/** Resumo curto para o systemPrompt — o agente sabe que o catálogo existe. */
export function resumo() {
  const cat = carregar();
  if (!cat.length) return '';
  const top = categorias().slice(0, 10).map(c => `${c.nome} (${c.total})`).join(', ');
  return `${cat.length} APIs públicas SEM necessidade de conta ou chave, em ${categorias().length} categorias. ` +
         `Maiores: ${top}.`;
}
