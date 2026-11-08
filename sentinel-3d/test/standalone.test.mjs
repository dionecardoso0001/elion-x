// Garante que a versão autônoma (arquivo único, sem servidor) é gerada íntegra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

test('build autônomo: HTML único, sem referências externas, CSP por hash íntegra', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-sa-')), 'sentinel.html');
  execFileSync(process.execPath, ['scripts/build-standalone.mjs'], { env: { ...process.env, OUT: out }, stdio: 'pipe' });
  const html = fs.readFileSync(out, 'utf8');
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+stylesheet|type="module"|importmap/, 'nada pode depender de arquivo externo');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /connect-src 'none'/);
  const sha = (s) => crypto.createHash('sha256').update(s).digest('base64');
  const js = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/)[1];
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.ok(csp.includes(`'sha256-${sha(js)}'`), 'hash do script confere (conteúdo não corrompido)');
  assert.ok(csp.includes(`'sha256-${sha(css)}'`), 'hash do CSS confere');
  assert.ok(html.length < 3 * 1024 * 1024, 'arquivo abaixo de 3 MB');
});

test('núcleo compartilhado não depende de módulos do Node (roda no navegador)', () => {
  const files = ['src/http/api.mjs', 'src/platform.mjs', 'src/security/auth.mjs', ...fs.readdirSync('src/engine').map((f) => `src/engine/${f}`), ...fs.readdirSync('src/domain').map((f) => `src/domain/${f}`)];
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /from 'node:/, f);
});
