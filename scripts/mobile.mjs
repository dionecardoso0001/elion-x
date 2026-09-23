/**
 * ELION-X Mobile — sobe um túnel HTTPS (Cloudflare) e mostra um QR Code
 * para abrir a plataforma no smartphone, de qualquer rede, com voz e câmera.
 */
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 3001;
const CF = path.join(ROOT, 'bin', 'cloudflared.exe');

const line = '═'.repeat(54);
const log = (...a) => console.log(...a);

function serverUp() {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${PORT}/api/status`, r => { r.resume(); resolve(r.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(2500, () => { req.destroy(); resolve(false); });
  });
}

async function ensureServer() {
  if (await serverUp()) { log('  ✓ Núcleo ELION-X já está no ar.'); return; }
  log('  ▸ Iniciando o núcleo ELION-X...');
  const node = spawn(process.execPath, ['server.js'], { cwd: ROOT, detached: true, stdio: 'ignore' });
  node.unref();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 600));
    if (await serverUp()) { log('  ✓ Núcleo online.'); return; }
  }
  log('  ⚠ Não consegui confirmar o núcleo, mas o túnel seguirá tentando.');
}

function startTunnel() {
  log(`\n  ${line}\n   E-L-I-O-N  X   ·   ACESSO MOBILE (túnel HTTPS)\n  ${line}\n`);
  log('  ▸ Abrindo túnel seguro com a Cloudflare...\n');

  const cf = spawn(CF, ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], { cwd: ROOT });
  let shown = false;
  const urlRe = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

  const handle = buf => {
    const s = buf.toString();
    const m = s.match(urlRe);
    if (m && !shown) {
      shown = true;
      const link = m[0];
      log(`\n  ${line}`);
      log(`   ✅  SEU LINK MOBILE ESTÁ PRONTO, SENHOR:`);
      log(`\n        ${link}\n`);
      log(`   ◈ Um QR Code vai abrir no navegador do PC — escaneie`);
      log(`     com a câmera do celular para entrar com voz e câmera.`);
      log(`   ◈ Mantenha ESTA janela aberta enquanto usar no celular.`);
      log(`  ${line}\n`);
      // abre a página local de QR (o link não é enviado a terceiros)
      const qr = `http://localhost:${PORT}/qr?u=${encodeURIComponent(link)}`;
      spawn('cmd', ['/c', 'start', '', qr], { detached: true, stdio: 'ignore' }).unref();
    }
  };

  cf.stdout.on('data', handle);
  cf.stderr.on('data', handle); // cloudflared imprime o URL no stderr
  cf.on('exit', code => { log(`\n  Túnel encerrado (código ${code}). Feche esta janela.`); });
}

(async () => {
  await ensureServer();
  startTunnel();
})();
