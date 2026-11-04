/**
 * ELION-X SENTINELA — avalia uma sessão do GRAVADOR DE CAMPO.
 *
 *   npm run sentinela:avaliar -- sentinela-campo-motorista-2026-11-04.jsonl
 *   npm run sentinela:avaliar -- sessao.jsonl --json        (saída em JSON)
 *
 * Calcula alarmes por hora, precisão e revocação com intervalo de Wilson
 * (95%), latência dos testes dirigidos e percentis das métricas, e diz qual
 * limiar ajustar — sempre apontando o número que sustenta a recomendação.
 */
import fs from 'fs';
import { avaliarSessao, formatarRelatorio } from '../assets/sentinela/avaliacao.js';

const args = process.argv.slice(2);
const arquivo = args.find(a => !a.startsWith('--'));
if (!arquivo) {
  console.error('uso: npm run sentinela:avaliar -- <sessao.jsonl> [--json]');
  process.exit(2);
}
let texto;
try { texto = fs.readFileSync(arquivo, 'utf8'); }
catch (e) { console.error(`não consegui ler ${arquivo}: ${e.message}`); process.exit(2); }

const rel = avaliarSessao(texto);
console.log(args.includes('--json') ? JSON.stringify(rel, null, 2) : formatarRelatorio(rel));
