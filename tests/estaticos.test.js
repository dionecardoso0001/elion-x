import test from 'node:test';
import assert from 'node:assert/strict';
import { classificarCaminho, CABECALHOS_SEGURANCA, CABECALHOS_TERCEIRO } from '../estaticos.mjs';

// o servidor aplica decodeURIComponent no pathname já normalizado pelo parser WHATWG
const via = p => classificarCaminho(decodeURIComponent(new URL(p, 'http://localhost').pathname));

test('a interface continua inteira acessível', () => {
  for (const p of ['/', '/index.html', '/sentinela.html', '/cyber.html', '/brain.html', '/whatsapp.html',
    '/manifest.webmanifest', '/sentinela.webmanifest', '/sw.js', '/assets/app.css', '/assets/sentinela/nucleo.js',
    '/assets/vendor/GLTFLoader.js', '/assets/vendor/modelos/face_landmarker.task', '/assets/elion-512.png'])
    assert.equal(via(p), 'publico', p);
});

test('segredos e dados do operador: negados em qualquer grafia', () => {
  for (const p of ['/.env', '/.git/config', '/.wwebjs_auth/x', '/assets/%2e%2e/.env', '/assets%2f..%2f.env',
    '/assets%5c..%5c.git%5cconfig', '/data/google-token.json', '/DATA/memory.json', '/data%5cfaces.json',
    '/node_modules/@mediapipe/tasks-vision/package.json', '/bin/cloudflared.exe'])
    assert.equal(via(p), 'negado', p);
});

test('Windows/NTFS: nome curto 8.3 e fluxo de diretório são negados', () => {
  // achados da revisão de segurança: o NTFS abre .env por ENV~1 e data/ por data::$INDEX_ALLOCATION
  for (const p of ['/ENV~1', '/GIT~1/config', '/NODE_M~1/x', '/data::$INDEX_ALLOCATION/google-token.json',
    '/data:$i30:$INDEX_ALLOCATION/memory.json', '/assets::$DATA', '/index.html::$DATA', '/x%00.html'])
    assert.equal(via(p), 'negado', p);
});

test('cabeçalhos da interface: anti-clickjacking e sensores só para a própria origem', () => {
  assert.equal(CABECALHOS_SEGURANCA['X-Frame-Options'], 'SAMEORIGIN');
  assert.match(CABECALHOS_SEGURANCA['Content-Security-Policy'], /frame-ancestors 'self'/);
  assert.equal(CABECALHOS_SEGURANCA['X-Content-Type-Options'], 'nosniff');
  assert.match(CABECALHOS_SEGURANCA['Permissions-Policy'], /camera=\(self\)/);
  assert.doesNotMatch(CABECALHOS_SEGURANCA['Permissions-Policy'], /camera=\(\)/, 'não pode desligar a câmera da própria Sentinela');
});

test('conteúdo de terceiro do proxy: sandbox sem scripts e sem a origem da casa', () => {
  const csp = CABECALHOS_TERCEIRO['Content-Security-Policy'];
  assert.match(csp, /(^|;\s*)sandbox\b/);
  assert.doesNotMatch(csp, /allow-scripts/, 'sem allow-scripts: manipulador de evento não roda');
  assert.doesNotMatch(csp, /allow-same-origin/, 'sem allow-same-origin: origem opaca, /api/* fora de alcance');
  assert.match(csp, /script-src 'none'/);
});

test('código e arquivos de trabalho fora da interface não são servidos', () => {
  for (const p of ['/server.js', '/sentinela.mjs', '/package.json', '/.env.example', '/operador.exemplo.json',
    '/docs/ARQUITETURA.md', '/apis-publicas.json', '/demo-loop/normalizar.js', '/server.js.bak'])
    assert.notEqual(via(p), 'publico', p);
});
