/**
 * SENTINELA SPY — prepara a instalação (rode depois de `npm install`).
 *
 *   npm run preparar                 runtime + SDK + modelos
 *   npm run preparar -- --sem-modelos  pula os modelos (o navegador baixa do Google)
 *
 * 1. Runtime de visão: copia o MediaPipe Tasks Vision (versão EXATA do
 *    package.json) para vendor/mediapipe/<versão>/ — a plataforma não depende
 *    de CDN, que rede corporativa bloqueia com frequência.
 * 2. SDK oficial da Anthropic empacotado para o navegador (esbuild) em
 *    vendor/anthropic-sdk.mjs — usado só no modo "chave própria".
 * 3. Modelos de visão em modelos/, cada um conferido contra o SHA-256 fixado
 *    em js/config.js. Divergiu, o arquivo é RECUSADO: modelo adulterado
 *    decide o que é "pessoa" e o que é "olho fechado".
 * 4. plataforma.json: o que esta instalação tem localmente (o navegador lê
 *    isso no boot — funciona igual em servidor próprio e hospedagem estática).
 *
 * Atrás de proxy corporativo, o fetch nativo do Node só usa o proxy com
 * NODE_USE_ENV_PROXY=1 (Node 22.21 ou mais novo).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';
import { MODELOS, MEDIAPIPE_VERSAO, VERSAO } from '../js/config.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const semModelos = process.argv.includes('--sem-modelos');
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const mb = n => (n / 1048576).toFixed(1) + ' MB';
const pacote = nome => JSON.parse(fs.readFileSync(path.join(RAIZ, 'node_modules', nome, 'package.json'), 'utf8'));

// 1 ── runtime de visão
const mp = pacote('@mediapipe/tasks-vision');
if (mp.version !== MEDIAPIPE_VERSAO) {
  console.error(`✗ @mediapipe/tasks-vision instalado é ${mp.version}, a plataforma exige ${MEDIAPIPE_VERSAO}. Rode npm ci.`);
  process.exit(1);
}
const origemMp = path.join(RAIZ, 'node_modules', '@mediapipe', 'tasks-vision');
const destinoMp = path.join(RAIZ, 'vendor', 'mediapipe', MEDIAPIPE_VERSAO);
fs.mkdirSync(path.join(destinoMp, 'wasm'), { recursive: true });
for (const f of ['vision_bundle.mjs', 'wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.wasm',
  'wasm/vision_wasm_nosimd_internal.js', 'wasm/vision_wasm_nosimd_internal.wasm', 'LICENSE']) {
  const de = path.join(origemMp, f);
  if (fs.existsSync(de)) fs.copyFileSync(de, path.join(destinoMp, f));
}
console.log(`  ✓ runtime MediaPipe ${MEDIAPIPE_VERSAO} → vendor/mediapipe/${MEDIAPIPE_VERSAO}/`);

// 2 ── SDK oficial para o navegador
const sdk = pacote('@anthropic-ai/sdk');
await build({
  stdin: { contents: "export { default } from '@anthropic-ai/sdk';", resolveDir: RAIZ, loader: 'js' },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
  legalComments: 'eof', outfile: path.join(RAIZ, 'vendor', 'anthropic-sdk.mjs'), logLevel: 'error',
});
fs.copyFileSync(path.join(RAIZ, 'node_modules', '@anthropic-ai', 'sdk', 'LICENSE'), path.join(RAIZ, 'vendor', 'anthropic-sdk.LICENSE.txt'));
console.log(`  ✓ SDK oficial @anthropic-ai/sdk ${sdk.version} → vendor/anthropic-sdk.mjs (${mb(fs.statSync(path.join(RAIZ, 'vendor', 'anthropic-sdk.mjs')).size)})`);

// 3 ── modelos
const DESTINO = path.join(RAIZ, 'modelos');
fs.mkdirSync(DESTINO, { recursive: true });
const presentes = {};
let falhas = 0;
for (const [chave, m] of Object.entries(MODELOS)) {
  const alvo = path.join(DESTINO, m.arquivo);
  if (fs.existsSync(alvo) && sha256(fs.readFileSync(alvo)) === m.sha256) {
    presentes[chave] = true;
    console.log(`  ✓ ${m.arquivo.padEnd(28)} já presente e íntegro`);
    continue;
  }
  if (semModelos) { presentes[chave] = false; continue; }
  process.stdout.write(`  ▸ ${m.arquivo.padEnd(28)} baixando ${mb(m.bytes)}… `);
  try {
    const r = await fetch(m.url, { signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const h = sha256(buf);
    if (h !== m.sha256) throw new Error(`SHA-256 divergente (${h.slice(0, 16)}…) — arquivo RECUSADO`);
    fs.writeFileSync(alvo + '.parcial', buf);
    fs.renameSync(alvo + '.parcial', alvo);   // escrita atômica: nunca fica meio arquivo com nome válido
    presentes[chave] = true;
    console.log('✓ sha256 confere');
  } catch (e) {
    presentes[chave] = false; falhas++;
    console.log(`✗ ${e.message}`);
  }
}

// 4 ── o que esta instalação tem
fs.writeFileSync(path.join(RAIZ, 'plataforma.json'), JSON.stringify({
  nome: 'Sentinela Spy', versao: VERSAO, gerado_em: new Date().toISOString(),
  mediapipe: { local: true, versao: MEDIAPIPE_VERSAO },
  modelos: presentes,
  sdk: { local: true, versao: sdk.version },
}, null, 2));
console.log(falhas
  ? `\n  ${falhas} modelo(s) falharam — o navegador tentará baixá-los do Google (SHA-256 conferido do mesmo jeito).`
  : '\n  Instalação pronta. Inicie com: npm start');
process.exit(falhas ? 1 : 0);
