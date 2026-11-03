/**
 * ELION-X SENTINELA — baixa os modelos de visão para uso OFFLINE.
 *
 *   npm run sentinela:modelos
 *
 * Sem este passo a Sentinela funciona do mesmo jeito: o navegador baixa os
 * modelos do Google na primeira abertura e guarda no próprio cache. Este
 * script existe para rede que bloqueia storage.googleapis.com (comum em
 * ambiente corporativo) e para instalação sem internet: os arquivos ficam
 * em assets/vendor/modelos/ (fora do git — binário pesado não vai para o
 * repositório) e o servidor os entrega pela própria origem.
 *
 * Integridade: cada arquivo é conferido contra o SHA-256 fixado em
 * assets/sentinela/config.js. Divergiu, o arquivo é descartado — modelo
 * adulterado decide o que é "pessoa" e o que é "olho fechado".
 *
 * Atrás de proxy corporativo, o fetch nativo do Node só usa o proxy com
 * NODE_USE_ENV_PROXY=1 (Node 22.21 ou mais novo).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { MODELOS } from '../assets/sentinela/config.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = path.join(RAIZ, 'assets', 'vendor', 'modelos');
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const mb = n => (n / 1048576).toFixed(1) + ' MB';

fs.mkdirSync(DESTINO, { recursive: true });
let falhas = 0;
for (const m of Object.values(MODELOS)) {
  const alvo = path.join(DESTINO, m.arquivo);
  if (fs.existsSync(alvo) && sha256(fs.readFileSync(alvo)) === m.sha256) {
    console.log(`  ✓ ${m.arquivo.padEnd(28)} já presente e íntegro`);
    continue;
  }
  process.stdout.write(`  ▸ ${m.arquivo.padEnd(28)} baixando ${mb(m.bytes)}… `);
  try {
    const r = await fetch(m.url, { signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const h = sha256(buf);
    if (h !== m.sha256) throw new Error(`SHA-256 divergente (${h.slice(0, 16)}…) — arquivo RECUSADO`);
    fs.writeFileSync(alvo + '.parcial', buf);
    fs.renameSync(alvo + '.parcial', alvo);   // escrita atômica: nunca fica meio arquivo com nome válido
    console.log('✓ sha256 confere');
  } catch (e) {
    falhas++;
    console.log(`✗ ${e.message}`);
  }
}
console.log(falhas
  ? `\n  ${falhas} modelo(s) falharam. A Sentinela tentará baixá-los pelo navegador.`
  : `\n  Modelos prontos em ${path.relative(RAIZ, DESTINO)} — a Sentinela abre sem depender do Google.`);
process.exit(falhas ? 1 : 0);
