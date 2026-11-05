/**
 * SENTINELA SPY — monta dist/ para hospedagem ESTÁTICA (GitHub Pages,
 * Cloudflare Pages, qualquer servidor de arquivos com HTTPS).
 *
 *   npm run preparar && npm run build
 *
 * Em hospedagem estática não há servidor para guardar chave: o agente roda
 * no modo "chave própria" (o operador informa a chave no aparelho dele).
 * Copia só o que a interface usa — a mesma lista de permissão do servidor.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PUBLICOS_RAIZ, PASTAS_PUBLICAS } from '../estaticos.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(RAIZ, 'dist');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

let arquivos = 0, bytes = 0;
const copiar = (de, para) => {
  const st = fs.statSync(de);
  if (st.isDirectory()) {
    fs.mkdirSync(para, { recursive: true });
    for (const n of fs.readdirSync(de)) if (!n.startsWith('.')) copiar(path.join(de, n), path.join(para, n));
  } else { fs.copyFileSync(de, para); arquivos++; bytes += st.size; }
};
for (const f of PUBLICOS_RAIZ) if (fs.existsSync(path.join(RAIZ, f))) copiar(path.join(RAIZ, f), path.join(DIST, f));
for (const d of PASTAS_PUBLICAS) if (fs.existsSync(path.join(RAIZ, d))) copiar(path.join(RAIZ, d), path.join(DIST, d));

for (const obrigatorio of ['index.html', 'plataforma.json', 'vendor/anthropic-sdk.mjs']) {
  if (!fs.existsSync(path.join(DIST, obrigatorio))) { console.error(`✗ falta ${obrigatorio} — rode npm run preparar antes`); process.exit(1); }
}
// relé do alerta ao responsável (opcional): página estática só conversa com origens
// listadas na CSP. SPY_RELE_URL vem de uma variável do repositório no GitHub
// (Settings → Secrets and variables → Actions → Variables) — não é segredo: o token
// de cada aparelho é que autentica. Só a ORIGEM normalizada entra na CSP.
let rele = null;
if (process.env.SPY_RELE_URL) {
  let u;
  try { u = new URL(process.env.SPY_RELE_URL); } catch { console.error('✗ SPY_RELE_URL não é uma URL válida'); process.exit(1); }
  if (u.protocol !== 'https:') { console.error('✗ SPY_RELE_URL precisa ser https://'); process.exit(1); }
  rele = { url: u.href, origem: u.origin };
  const idx = path.join(DIST, 'index.html');
  const html = fs.readFileSync(idx, 'utf8');
  const novo = html.replace("connect-src 'self'", `connect-src 'self' ${u.origin}`);
  if (novo === html) { console.error("✗ CSP do index.html sem \"connect-src 'self'\" — não dá para liberar o relé"); process.exit(1); }
  fs.writeFileSync(idx, novo);
  console.log(`  ✓ relé liberado na CSP: ${u.origin}`);
}
// hospedagem estática não tem /api/: o boot não sonda servidor (evita um 404 no console)
const plat = JSON.parse(fs.readFileSync(path.join(DIST, 'plataforma.json'), 'utf8'));
fs.writeFileSync(path.join(DIST, 'plataforma.json'), JSON.stringify({ ...plat, hospedagem: 'estatica', ...(rele ? { rele } : {}) }, null, 2));
// GitHub Pages: sem Jekyll (ele esconderia arquivos e pastas que começam com "_")
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
console.log(`  ✓ dist/ pronto: ${arquivos} arquivos, ${(bytes / 1048576).toFixed(1)} MB`);
