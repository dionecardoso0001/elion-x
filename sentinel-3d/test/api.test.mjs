// Testes de contrato da API e de autorização (servidor real em porta efêmera, dados em diretório temporário).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';

let srv, base, dir;
const TOKEN = 'token-de-teste-com-tamanho-suficiente';

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-'));
  srv = await createServer({ port: 0, dataDir: dir, tickMs: 200, ingestToken: TOKEN });
  base = `http://127.0.0.1:${srv.port}`;
});
after(async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function login(role) {
  const r = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sentinel-Csrf': '1' }, body: JSON.stringify({ role }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  return cookie.split(';')[0];
}
const get = (u, c) => fetch(base + u, { headers: c ? { cookie: c } : {} });
const post = (u, c, body = {}, csrf = true) => fetch(base + u, { method: 'POST', headers: { cookie: c, 'Content-Type': 'application/json', ...(csrf ? { 'X-Sentinel-Csrf': '1' } : {}) }, body: JSON.stringify(body) });

test('cabeçalhos de segurança e CSP sem unsafe-inline', async () => {
  const r = await get('/');
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});

test('API exige sessão', async () => {
  assert.equal((await get('/api/devices')).status, 401);
});

test('CSRF: mutação sem cabeçalho anti-CSRF é recusada', async () => {
  const c = await login('operador');
  assert.equal((await post('/api/scenarios/A/start', c, {}, false)).status, 403);
});

test('observador: não vê áreas restritas, IP/serial nem IDs restritos em textos', async () => {
  const c = await login('observador');
  const devs = await (await get('/api/devices', c)).json();
  assert.ok(devs.length > 0 && devs.length < srv.platform.devices.length);
  assert.ok(!devs.some((d) => d.id === 'SW-03' || d.id === 'VAULT-01'), 'ativos de sala restrita ocultos');
  assert.ok(devs.every((d) => d.ip === undefined && d.serial === undefined));
  assert.equal((await get('/api/devices/SW-03', c)).status, 404, '404 também para não autorizado');
  assert.equal((await post('/api/scenarios/A/start', c)).status, 403);
  assert.equal((await get('/api/devices/CAM-014/video', c)).status, 403);
  assert.equal((await get('/api/admin/audit', c)).status, 403);
  // agregados derivados de ativos restritos (medidor, roteador, nobreaks) também não chegam
  const sum = await (await get('/api/metrics/summary?period=1h', c)).json();
  assert.ok(sum.series.every((x) => x.kw === null && x.wanMbps === null));
  assert.equal(sum.upsTrend, null);
});

test('cenário B via API: observador recebe motivo redigido; operador vê causa raiz', async () => {
  const op = await login('operador');
  assert.equal((await post('/api/scenarios/B/start', op)).status, 200);
  await new Promise((r) => setTimeout(r, 9000));
  const obs = await login('observador');
  const cam = await (await get('/api/devices/CAM-014', obs)).json();
  assert.equal(cam.device.status, 'unknown');
  assert.ok(cam.device.reasons.every((r) => !r.text.includes('SW-03')), 'ID restrito não vaza no motivo');
  const incOp = await (await get('/api/incidents?status=active', op)).json();
  assert.ok(incOp.some((i) => i.kind === 'cascade' && i.rootDeviceId === 'SW-03'));
  const incObs = await (await get('/api/incidents?status=active', obs)).json();
  assert.ok(incObs.filter((i) => i.deviceIds.length === 0 || i.redacted).length >= 1);
  assert.ok(!JSON.stringify(incObs).includes('SW-03'));
  assert.equal((await post('/api/scenarios/all/stop', op)).status, 200);
});

test('resolução exige nota e condição normalizada', async () => {
  const op = await login('operador');
  const list = await (await get('/api/incidents', op)).json();
  const anyId = list[0].id;
  assert.equal((await post(`/api/incidents/${anyId}/resolve`, op, { note: '' })).status, 400);
});

test('ingestão externa: token obrigatório, validação e descarte de campos desconhecidos', async () => {
  const bad = await fetch(`${base}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer errado' }, body: '{}' });
  assert.equal(bad.status, 401);
  const r = await fetch(`${base}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ readings: [{ deviceId: 'TH-01', sourceTs: Date.now(), values: { tempC: 23.1, cmd: 'rm -rf' } }, { deviceId: 'X-404', sourceTs: Date.now(), values: {} }] }) });
  assert.equal(r.status, 202);
  const body = await r.json();
  assert.equal(body.accepted, 1); assert.equal(body.rejected, 1);
  assert.deepEqual(body.results[0].dropped, ['cmd']);
});

test('administrador: auditoria registra ações e retenção valida entrada', async () => {
  const adm = await login('administrador');
  const audit = await (await get('/api/admin/audit', adm)).json();
  assert.ok(audit.some((a) => a.action === 'scenario.start'));
  assert.ok(audit.some((a) => a.action === 'denied'));
  const badCfg = await fetch(`${base}/api/admin/config`, { method: 'PUT', headers: { cookie: adm, 'Content-Type': 'application/json', 'X-Sentinel-Csrf': '1' }, body: JSON.stringify({ retentionDays: -5 }) });
  assert.equal(badCfg.status, 400);
});

test('assistente via API usa ferramenta tipada e relatório é derivado dos registros', async () => {
  const op = await login('operador');
  const a = await (await post('/api/assistant', op, { q: 'Mostre os incidentes críticos ainda sem tratamento' })).json();
  assert.equal(a.tool, 'tool_critical');
  const rep = await (await get('/api/reports/incidents?period=7d', op)).text();
  assert.match(rep, /MODO DEMONSTRAÇÃO — DADOS SIMULADOS/);
  assert.match(rep, /histórico sintético|SINTÉTICO/i);
});

test('todos os cenários do simulador são acionáveis pela API (e cenário inexistente → 404)', async () => {
  const op = await login('operador');
  const { scenarios } = await (await get('/api/scenarios', op)).json();
  assert.ok(scenarios.length >= 8);
  for (const s of scenarios) {
    assert.equal((await post(`/api/scenarios/${s.id}/start`, op)).status, 200, `start ${s.id}`);
    assert.equal((await post(`/api/scenarios/${s.id}/stop`, op)).status, 200, `stop ${s.id}`);
  }
  assert.equal((await post('/api/scenarios/Z/start', op)).status, 404);
  assert.equal((await get('/api/brand', op)).status, 200);
});
