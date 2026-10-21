/* Testes de ponta a ponta com servidor real (porta efêmera) e um bot falso. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../server.mjs';
import { signBody, hmacHex } from '../lib/crypto.mjs';
import { quote } from '../lib/catalog.mjs';
import { paymentProvider } from '../lib/payments.mjs';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!!';
let app, base, dir, bot, botHits = [];

const validOrder = (over = {}) => ({
  packageId: 'reels-flash', addons: ['urgente'], acceptTerms: true,
  briefing: {
    goal: 'vender-produto', style: 'divertido', format: '9:16', brand: 'Café Nébula', product: 'Cold brew de baunilha',
    audience: 'jovens 20-35', message: 'Café gelado artesanal, entregue em 30 minutos na sua porta.', cta: 'Peça já', script: '', references: ['https://exemplo.com/ref'],
  },
  customer: { name: 'Ana Teste', email: 'ana@exemplo.com', whatsapp: '+55 11 90000-0000' },
  ...over,
});

async function call(path, { method = 'GET', body, token, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const r = await fetch(base + path, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, json, text, headers: r.headers };
}

const signed = (payload, secret = SECRET) => {
  const raw = JSON.stringify(payload);
  const { timestamp, signature } = signBody(secret, raw);
  return { raw, headers: { 'Content-Type': 'application/json', 'X-Studio-Timestamp': timestamp, 'X-Studio-Signature': signature } };
};

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'studio-'));
  bot = createServer((req, res) => {
    const c = []; req.on('data', d => c.push(d));
    req.on('end', () => { botHits.push({ headers: req.headers, body: Buffer.concat(c).toString() }); res.writeHead(202).end(); });
  });
  await new Promise(r => bot.listen(0, r));
  app = await createApp({
    PORT: '0', PAYMENT_PROVIDER: 'mock', DATA_FILE: join(dir, 'orders.json'), ADMIN_TOKEN: 'admin-token-de-teste-com-32-caracteres',
    BOT_SHARED_SECRET: SECRET, GROK_BOT_URL: `http://127.0.0.1:${bot.address().port}/pedido`,
  });
  await new Promise(r => app.server.listen(0, r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => { await app.close(); bot.close(); await rm(dir, { recursive: true, force: true }); });

test('orçamento é calculado no servidor (urgente = +40% e metade do prazo)', () => {
  const q = quote('reels-flash', ['urgente', 'urgente']);
  assert.equal(q.totalCents, 19700 + 7880);
  assert.equal(q.slaHours, 24);
  assert.deepEqual(q.addons, ['urgente']);
});

test('cabeçalhos de segurança e catálogo', async () => {
  const r = await call('/api/catalog');
  assert.equal(r.status, 200);
  assert.ok(r.json.packages.length >= 4);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});

test('página inicial é servida e path traversal é bloqueado', async () => {
  assert.equal((await call('/')).status, 200);
  assert.equal((await call('/..%2f..%2fserver.mjs')).status, 404);
  assert.equal((await call('/%2e%2e/.env.example')).status, 404);
});

test('validação recusa e-mail inválido, link http e termos não aceitos', async () => {
  let r = await call('/api/orders', { method: 'POST', body: validOrder({ customer: { name: 'Ana', email: 'nao-e-email' } }) });
  assert.equal(r.status, 400); assert.equal(r.json.field, 'email');
  r = await call('/api/orders', { method: 'POST', body: validOrder({ briefing: { ...validOrder().briefing, references: ['http://10.0.0.1/x'] } }) });
  assert.equal(r.status, 400);
  r = await call('/api/orders', { method: 'POST', body: validOrder({ acceptTerms: false }) });
  assert.equal(r.status, 400);
});

test('fluxo completo: pedido → pagamento → bot → callbacks → entrega → ajuste', async () => {
  // preço enviado pelo cliente é ignorado
  const created = await call('/api/orders', { method: 'POST', body: { ...validOrder(), totalCents: 100 } });
  assert.equal(created.status, 201);
  const { id, accessToken, checkoutUrl } = created.json;
  assert.match(id, /^AT-[A-Z0-9]{8}$/);
  assert.match(checkoutUrl, /pagamento-simulado/);

  // BOLA: token errado ou ausente = 404 indistinguível de inexistente
  assert.equal((await call(`/api/orders/${id}`)).status, 404);
  assert.equal((await call(`/api/orders/${id}`, { token: 'x'.repeat(43) })).status, 404);

  let o = (await call(`/api/orders/${id}`, { token: accessToken })).json;
  assert.equal(o.status, 'awaiting_payment');
  assert.equal(o.quote.totalCents, 27580);
  assert.equal(o.tokenHash, undefined, 'hash do token não pode vazar');

  // callback antes do pagamento é ignorado (pedido não pago não avança)
  const early = signed({ orderId: id, status: 'delivered', assets: [{ type: 'video', url: 'https://cdn.exemplo.com/v.mp4' }] });
  await call('/api/bots/callback', { method: 'POST', raw: early.raw, headers: early.headers });
  assert.equal((await call(`/api/orders/${id}`, { token: accessToken })).json.status, 'awaiting_payment');

  // pagamento simulado
  const paid = await call('/api/dev/mock-pay', { method: 'POST', token: accessToken, body: { id } });
  assert.equal(paid.status, 200);

  // despacho assinado chega ao bot
  for (let i = 0; i < 50 && !botHits.length; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(botHits.length, 1);
  const hit = botHits[0];
  const ts = hit.headers['x-studio-timestamp'];
  assert.equal(hit.headers['x-studio-signature'], `sha256=${hmacHex(SECRET, `${ts}.${hit.body}`)}`);
  const job = JSON.parse(hit.body);
  assert.equal(job.order.id, id);
  assert.equal(job.order.briefing.product, 'Cold brew de baunilha');
  assert.ok(!hit.body.includes(accessToken), 'token do cliente não vai para o bot');
  assert.ok(!hit.body.includes('ana@exemplo.com'), 'e-mail do cliente não vai para o bot');

  o = (await call(`/api/orders/${id}`, { token: accessToken })).json;
  assert.equal(o.status, 'in_production');

  // callback com assinatura falsa
  const fake = signed({ orderId: id, status: 'failed' }, 'outro-segredo');
  assert.equal((await call('/api/bots/callback', { method: 'POST', raw: fake.raw, headers: fake.headers })).status, 401);

  // progresso
  const prog = signed({ orderId: id, status: 'in_production', progress: 60, message: 'Gerando cenas' });
  assert.equal((await call('/api/bots/callback', { method: 'POST', raw: prog.raw, headers: prog.headers })).status, 200);
  // replay do mesmo callback é descartado
  assert.equal((await call('/api/bots/callback', { method: 'POST', raw: prog.raw, headers: prog.headers })).json.duplicate, true);

  // entrega com URL javascript: é recusada
  const evil = signed({ orderId: id, status: 'delivered', assets: [{ type: 'video', url: 'javascript:alert(1)' }] });
  assert.equal((await call('/api/bots/callback', { method: 'POST', raw: evil.raw, headers: evil.headers })).status, 400);

  const done = signed({ orderId: id, status: 'delivered', assets: [{ type: 'video', url: 'https://cdn.exemplo.com/v.mp4', label: 'Vídeo 9:16' }] });
  assert.equal((await call('/api/bots/callback', { method: 'POST', raw: done.raw, headers: done.headers })).status, 200);
  o = (await call(`/api/orders/${id}`, { token: accessToken })).json;
  assert.equal(o.status, 'delivered');
  assert.equal(o.progress, 100);
  assert.equal(o.assets[0].url, 'https://cdn.exemplo.com/v.mp4');

  // ajuste
  const rev = await call(`/api/orders/${id}/revision`, { method: 'POST', token: accessToken, body: { note: 'Trocar a trilha por algo mais animado' } });
  assert.equal(rev.status, 200);
  assert.equal(rev.json.status, 'revision_requested');
  assert.equal(rev.json.revisionsLeft, 0);
  for (let i = 0; i < 50 && botHits.length < 2; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(JSON.parse(botHits[1].body).event, 'order.revision');
  assert.equal(JSON.parse(botHits[1].body).revisionNote, 'Trocar a trilha por algo mais animado');
});

test('admin exige token', async () => {
  assert.equal((await call('/api/admin/orders')).status, 401);
  const r = await call('/api/admin/orders', { token: 'admin-token-de-teste-com-32-caracteres' });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json));
});

test('produção recusa provedor mock', async () => {
  await assert.rejects(createApp({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock' }), /proibido em produção/);
});

test('assinatura do webhook Stripe: válida, adulterada e expirada', () => {
  const p = paymentProvider({ PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_teste' });
  const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } });
  const t = Math.floor(Date.now() / 1000);
  const ok = `t=${t},v1=${hmacHex('whsec_teste', `${t}.${raw}`)}`;
  assert.equal(p.parseWebhook(raw, ok).type, 'checkout.session.completed');
  assert.equal(p.parseWebhook(raw.replace('cs_1', 'cs_2'), ok), null);
  const old = t - 3600;
  assert.equal(p.parseWebhook(raw, `t=${old},v1=${hmacHex('whsec_teste', `${old}.${raw}`)}`), null);
});
