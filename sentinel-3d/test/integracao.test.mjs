// Acesso de integração: roteiro de validação completo + gateway de referência pela linha de comando.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { validate } from '../scripts/validar-integracao.mjs';
import { createServer } from '../server.mjs';

test('validação do acesso de integração: todas as verificações aprovadas', async () => {
  const results = await validate();
  const failed = results.filter((r) => !r.ok).map((r) => `${r.id}: ${r.evidence}`);
  assert.deepEqual(failed, []);
  assert.ok(results.length >= 12);
});

test('gateway de referência pela linha de comando (NDJSON → lote aceito)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-gw-'));
  const token = crypto.randomBytes(32).toString('base64url');
  const srv = await createServer({ port: 0, dataDir: dir, tickMs: 250, mode: 'integracao', ingestToken: token });
  const file = path.join(dir, 'leituras.ndjson');
  fs.writeFileSync(file, ['{"deviceId":"UPS-01","values":{"onBattery":false,"batteryPct":100,"runtimeMin":45,"loadPct":40}}', 'linha quebrada', '{"deviceId":"MTR-01","values":{"voltageV":221,"kW":5.8,"pf":0.95}}', ''].join('\n'));
  try {
    const out = await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['scripts/gateway-referencia.mjs', file], { env: { ...process.env, SENTINEL_URL: `http://127.0.0.1:${srv.port}`, SENTINEL_INGEST_TOKEN: token } });
      let s = ''; p.stdout.on('data', (d) => (s += d)); p.stderr.on('data', (d) => (s += d));
      p.on('close', (code) => (code === 0 ? resolve(s) : reject(new Error(`código ${code}: ${s}`))));
    });
    assert.match(out, /total: 2 aceitas, 0 rejeitadas/);
    assert.match(out, /JSON inválido/);
    assert.equal(srv.platform.latest.get('UPS-01').connector, 'ingest-api');
    assert.equal(srv.platform.latest.get('MTR-01').values.kW, 5.8);
  } finally { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
