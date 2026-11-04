// Gera standalone/sentinel-3d.html: arquivo ÚNICO que abre com duplo clique (file://), sem servidor,
// sem instalação e sem rede. Contém Three.js, o motor completo e a interface; CSP por hash.
//   npm run build:standalone
//   BRAND="SENTINEL 3D" OUT=caminho.html npm run build:standalone   (variação de nome/destino)

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT || 'standalone/sentinel-3d.html');
const BRAND = process.env.BRAND;
// ARTIFACT=1: fragmento para hospedagem que já fornece o esqueleto do documento e a própria CSP
const ARTIFACT = process.env.ARTIFACT === '1';

const bundle = await build({
  entryPoints: [path.join(ROOT, 'public/js/standalone.mjs')],
  bundle: true, format: 'iife', platform: 'browser', target: 'es2020',
  minify: true, write: false, legalComments: 'eof', logLevel: 'warning',
});
const js = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'); // não fecha a tag por engano
const css = fs.readFileSync(path.join(ROOT, 'public/css/app.css'), 'utf8').replace(/<\/style/gi, '<\\/style');

const sha = (s) => `'sha256-${crypto.createHash('sha256').update(s).digest('base64')}'`;
const csp = [
  "default-src 'none'", `script-src ${sha(js)}`, `style-src ${sha(css)}`,
  "img-src data: blob:", "connect-src 'none'", "font-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');

let html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
html = html
  .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '')
  .replace(/\s*<script type="module" src="\/js\/main\.mjs"><\/script>/, '')
  // substituições por FUNÇÃO: com string, o JS interpretaria "$&", "$'" e "$`" do código minificado
  .replace('<link rel="stylesheet" href="/css/app.css">', () => `<meta http-equiv="Content-Security-Policy" content="${csp}">\n  <style>${css}</style>`)
  .replace('<span>Planta e inventário fictícios · nenhum equipamento físico conectado</span>',
    '<span>Planta e inventário fictícios · nenhum equipamento físico conectado · versão autônoma (sem servidor)</span>')
  .replace('</body>', () => `<script>${js}</script>\n</body>`);
if (BRAND) html = html.replaceAll('SANTANDER SENTINEL 3D', BRAND);

for (const must of ['<style>', '<script>', 'Content-Security-Policy']) if (!html.includes(must)) throw new Error(`build inválido: falta ${must}`);
// o conteúdo embutido precisa ser byte a byte o que foi assinado na CSP
if (!html.includes(`<script>${js}</script>`) || !html.includes(`<style>${css}</style>`)) throw new Error('build inválido: conteúdo embutido difere do assinado na CSP');
if (/src="\/js\/|href="\/css\//.test(html)) throw new Error('build inválido: referência externa restante');

if (ARTIFACT) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<meta charset[^>]*>\s*/, '').replace(/<meta name="viewport"[^>]*>\s*/, '')
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  html = `${head.trim()}\n${body.trim()}\n`;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`✔ ${path.relative(ROOT, OUT)} — ${(html.length / 1024 / 1024).toFixed(2)} MB (abre com duplo clique, sem servidor)`);
