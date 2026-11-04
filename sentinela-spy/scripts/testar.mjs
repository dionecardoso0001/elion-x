/**
 * SENTINELA SPY — executa a suíte (npm test).
 * Testes se chamam *.spec.js e são listados aqui, em vez da descoberta automática do
 * `node --test`: funciona igual em Linux, macOS e Windows (o cmd.exe não expande
 * curingas e o Node 20 não aceita padrão glob no argumento).
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arquivos = readdirSync(path.join(RAIZ, 'tests')).filter(f => f.endsWith('.spec.js')).sort().map(f => path.join('tests', f));
const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...arquivos], { cwd: RAIZ, stdio: 'inherit' });
process.exit(r.status ?? 1);
