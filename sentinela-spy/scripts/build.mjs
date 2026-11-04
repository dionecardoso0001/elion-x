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
// hospedagem estática não tem /api/: o boot não sonda servidor (evita um 404 no console)
const plat = JSON.parse(fs.readFileSync(path.join(DIST, 'plataforma.json'), 'utf8'));
fs.writeFileSync(path.join(DIST, 'plataforma.json'), JSON.stringify({ ...plat, hospedagem: 'estatica' }, null, 2));
// GitHub Pages: sem Jekyll (ele esconderia arquivos e pastas que começam com "_")
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
console.log(`  ✓ dist/ pronto: ${arquivos} arquivos, ${(bytes / 1048576).toFixed(1)} MB`);
