/* Testes de ponta a ponta com servidor real (porta efêmera). */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../server.mjs';
import { signBody, hmacHex } from '../lib/crypto.mjs';
import { quote } from '../lib/catalog.mjs';
import { paymentProvider } from '../lib/payments.mjs';
import { crc16, pixPayload } from '../lib/pix.mjs';
import { stripJpegMetadata, sniff } from '../lib/files.mjs';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const ADMIN = 'admin-token-de-teste-com-32-caracteres';

const validOrder = (over = {}) => ({
  packageId: 'reels-flash', addons: ['urgente'], acceptTerms: true,
  briefing: {
    goal: 'vender-produto', category: 'perfume', styles: { video: 'produto-360' }, format: '9:16',
    brand: 'Maison Nébula', product: 'Perfume Âmbar Noir 100 ml', audience: 'mulheres 25-40',
    message: 'Fragrância amadeirada com baunilha e âmbar, fixação marcante.', cta: 'Peça pelo WhatsApp', script: '', references: ['https://exemplo.com/ref'],
  },
  customer: { name: 'Ana Teste', email: 'ana@exemplo.com', whatsapp: '+55 11 90000-0000' },
  ...over,
});

/* JPEG mínimo com um segmento APP1 "Exif" contendo um marcador de GPS falso. */
const jpegWithExif = () => {
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('GPS-LAT-23.55')]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([0, exif.length + 2]), exif]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0, 0, 1, 0, 1, 0, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, app1, Buffer.from([0xff, 0xda, 0x00, 0x02]), Buffer.from('dados-da-imagem'), Buffer.from([0xff, 0xd9])]);
};
const fakeMp4 = () => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(2048, 7)]);

function client(base) {
  return async function call(path, { method = 'GET', body, token, headers = {}, raw } = {}) {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (token) h.Authorization = `Bearer ${token}`;
    const r = await fetch(base + path, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const buf = Buffer.from(await r.arrayBuffer());
    let json; try { json = JSON.parse(buf.toString()); } catch { json = null; }
    return { status: r.status, json, buf, headers: r.headers };
  };
}

test('CRC16 do Pix confere com o exemplo do manual do Banco Central', () => {
  assert.equal(crc16('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304'), '1D3D');
  const p = pixPayload({ key: 'pix@example.com', name: 'José Ação', city: 'São Paulo', amountCents: 27580, txid: 'AT-ABCDEFGH' });
  assert.match(p, /5406275\.80/);
  assert.match(p, /5909Jose Acao/);
  assert.match(p, /62140510ATABCDEFGH/);
  assert.equal(p.slice(-4), crc16(p.slice(0, -4)));
});

test('remoção de EXIF em JPEG e detecção de tipo pelos bytes', () => {
  const j = jpegWithExif();
  assert.ok(j.includes('GPS-LAT'));
  const clean = stripJpegMetadata(j);
  assert.ok(!clean.includes('GPS-LAT'));
  assert.ok(clean.includes('dados-da-imagem'));
  assert.equal(sniff(clean), 'jpg');
  assert.equal(sniff(fakeMp4()), 'mp4');
  assert.equal(sniff(Buffer.from('<script>alert(1)</script>')), null);
});

test('orçamento é calculado no servidor (urgente = +40% e metade do prazo)', () => {
  const q = quote('reels-flash', ['urgente', 'urgente']);
  assert.equal(q.totalCents, 19700 + 7880);
  assert.equal(q.slaHours, 24);
});

describe('modo Pix com produção manual', () => {
  let app, call, dir;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'studio-pix-'));
    app = await createApp({ PORT: '0', PAYMENT_PROVIDER: 'pix', PIX_KEY: 'pix@example.com', PIX_NAME: 'Advanced Tech TI', PIX_CITY: 'Sao Paulo', DATA_FILE: join(dir, 'orders.json'), ADMIN_TOKEN: ADMIN });
    await new Promise(r => app.server.listen(0, r));
    call = client(`http://127.0.0.1:${app.server.address().port}`);
  });
  after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });

  test('cabeçalhos de segurança, catálogo com galeria e path traversal', async () => {
    const r = await call('/api/catalog');
    assert.equal(r.status, 200);
    assert.ok(r.json.styles.some(s => s.medium === 'video') && r.json.styles.some(s => s.medium === 'image'));
    assert.ok(r.json.styles.every(s => s.description && s.idealFor.length && s.send));
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal((await call('/..%2f..%2fserver.mjs')).status, 404);
  });

  test('validação: estilo precisa combinar com a mídia do pacote', async () => {
    let r = await call('/api/orders', { method: 'POST', body: validOrder({ briefing: { ...validOrder().briefing, styles: { video: 'still-estudio' } } }) });
    assert.equal(r.status, 400); assert.equal(r.json.field, 'styles.video');
    r = await call('/api/orders', { method: 'POST', body: validOrder({ packageId: 'comercial-pro', briefing: { ...validOrder().briefing, styles: { video: 'produto-360' } } }) });
    assert.equal(r.status, 400); assert.equal(r.json.field, 'styles.image', 'pacote com vídeo + imagens exige os dois estilos');
    r = await call('/api/orders', { method: 'POST', body: validOrder({ briefing: { ...validOrder().briefing, category: 'xyz' } }) });
    assert.equal(r.status, 400);
  });

  test('fluxo: pedido → fotos → Pix → aviso → confirmação → arquivos → entrega → ajuste', async () => {
    const created = await call('/api/orders', { method: 'POST', body: { ...validOrder(), totalCents: 1 } });
    assert.equal(created.status, 201);
    const { id, accessToken, checkoutUrl } = created.json;
    assert.match(checkoutUrl, new RegExp(`/pedido\\.html\\?id=${id}#t=`), 'no Pix o checkout é a própria página do pedido');

    // instruções Pix com valor do servidor (não o enviado pelo cliente)
    let o = (await call(`/api/orders/${id}`, { token: accessToken })).json;
    assert.equal(o.payment.method, 'pix');
    assert.equal(o.payment.amountCents, 27580);
    assert.match(o.payment.copyPaste, /^000201.*5406275\.80.*6304[0-9A-F]{4}$/);

    // BOLA
    assert.equal((await call(`/api/orders/${id}`)).status, 404);
    assert.equal((await call(`/api/orders/${id}`, { token: 'x'.repeat(43) })).status, 404);

    // foto do cliente: EXIF removido; arquivo falso recusado
    const up = await call(`/api/orders/${id}/photos`, { method: 'PUT', token: accessToken, raw: jpegWithExif(), headers: { 'Content-Type': 'image/jpeg', 'X-File-Label': 'frasco%20frente' } });
    assert.equal(up.status, 201);
    assert.equal(up.json.photos.length, 1);
    assert.equal(up.json.photos[0].label, 'frasco frente');
    const bad = await call(`/api/orders/${id}/photos`, { method: 'PUT', token: accessToken, raw: Buffer.from('<html>oi</html>'), headers: { 'Content-Type': 'image/jpeg' } });
    assert.equal(bad.status, 415);
    const photo = await call(up.json.photos[0].url);
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get('content-type'), 'image/jpeg');
    assert.ok(!photo.buf.includes('GPS-LAT'), 'GPS não pode chegar ao disco nem ao download');
    assert.equal((await call(up.json.photos[0].url.replace(/sig=[0-9a-f]+/, 'sig=00'))).status, 403, 'assinatura adulterada');

    // cliente não consegue se marcar como pago; aviso só sinaliza
    const rep = await call(`/api/orders/${id}/payment-reported`, { method: 'POST', token: accessToken, body: { payerName: 'Ana T.' } });
    assert.equal(rep.json.status, 'payment_reported');
    assert.equal((await call('/api/dev/mock-pay', { method: 'POST', token: accessToken, body: { id } })).status, 404);

    // operador: não envia arquivo antes de confirmar; confirma; produz; envia; entrega
    assert.equal((await call(`/api/admin/orders/${id}/files`, { method: 'PUT', token: ADMIN, raw: fakeMp4() })).status, 409);
    assert.equal((await call(`/api/admin/orders/${id}/confirm-payment`, { method: 'POST', token: 'errado', body: {} })).status, 401);
    let a = await call(`/api/admin/orders/${id}/confirm-payment`, { method: 'POST', token: ADMIN, body: {} });
    assert.equal(a.json.status, 'paid');
    assert.ok(a.json.dueAt);
    assert.equal((await call(`/api/admin/orders/${id}/confirm-payment`, { method: 'POST', token: ADMIN, body: {} })).status, 409, 'confirmação é idempotente');
    assert.equal((await call(`/api/orders/${id}/photos`, { method: 'PUT', token: accessToken, raw: jpegWithExif() })).status, 201, 'ainda pode mandar foto antes da produção');

    a = await call(`/api/admin/orders/${id}/status`, { method: 'POST', token: ADMIN, body: { status: 'in_production', message: 'Gerando as cenas' } });
    assert.equal(a.json.status, 'in_production');
    assert.equal((await call(`/api/orders/${id}/photos`, { method: 'PUT', token: accessToken, raw: jpegWithExif() })).status, 409, 'fotos travam na produção');
    assert.equal((await call(`/api/admin/orders/${id}/deliver`, { method: 'POST', token: ADMIN, body: {} })).status, 400, 'não entrega sem arquivo');

    a = await call(`/api/admin/orders/${id}/files`, { method: 'PUT', token: ADMIN, raw: fakeMp4(), headers: { 'X-File-Label': 'Reels%209x16' } });
    assert.equal(a.status, 201);
    assert.equal(a.json.files[0].ext, 'mp4');

    o = (await call(`/api/orders/${id}`, { token: accessToken })).json;
    assert.equal(o.assets.length, 0, 'cliente só vê arquivos depois da entrega');

    a = await call(`/api/admin/orders/${id}/deliver`, { method: 'POST', token: ADMIN, body: {} });
    assert.equal(a.json.status, 'delivered');
    o = (await call(`/api/orders/${id}`, { token: accessToken })).json;
    assert.equal(o.assets.length, 1);
    assert.equal(o.assets[0].type, 'video');

    // download com Range (Safari exige para tocar vídeo)
    const part = await call(o.assets[0].url, { headers: { Range: 'bytes=0-15' } });
    assert.equal(part.status, 206);
    assert.equal(part.buf.length, 16);
    assert.match(part.headers.get('content-range'), /^bytes 0-15\/2060$/);
    const dl = await call(o.assets[0].download);
    assert.match(dl.headers.get('content-disposition'), /^attachment/);

    // ajuste
    const rev = await call(`/api/orders/${id}/revision`, { method: 'POST', token: accessToken, body: { note: 'Deixar a luz mais dourada no final' } });
    assert.equal(rev.json.status, 'revision_requested');

    // novo link do cliente invalida o antigo
    const link = await call(`/api/admin/orders/${id}/access-link`, { method: 'POST', token: ADMIN, body: {} });
    const newToken = new URL(link.json.trackUrl).hash.slice(3);
    assert.equal((await call(`/api/orders/${id}`, { token: accessToken })).status, 404);
    assert.equal((await call(`/api/orders/${id}`, { token: newToken })).status, 200);
  });
});

describe('automação opcional com bots (provedor mock)', () => {
  let app, call, dir, bot;
  const hits = [];
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'studio-bot-'));
    bot = createServer((req, res) => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => { hits.push({ headers: req.headers, body: Buffer.concat(c).toString() }); res.writeHead(202).end(); }); });
    await new Promise(r => bot.listen(0, r));
    app = await createApp({ PORT: '0', PAYMENT_PROVIDER: 'mock', DATA_FILE: join(dir, 'orders.json'), ADMIN_TOKEN: ADMIN, BOT_SHARED_SECRET: SECRET, GROK_BOT_URL: `http://127.0.0.1:${bot.address().port}/pedido` });
    await new Promise(r => app.server.listen(0, r));
    call = client(`http://127.0.0.1:${app.server.address().port}`);
  });
  after(async () => { await app.close(); bot.close(); await rm(dir, { recursive: true, force: true }); });

  const signed = (payload, secret = SECRET) => {
    const raw = JSON.stringify(payload);
    const { timestamp, signature } = signBody(secret, raw);
    return { raw, headers: { 'Content-Type': 'application/json', 'X-Studio-Timestamp': timestamp, 'X-Studio-Signature': signature } };
  };

  test('despacho assinado com fotos, callbacks e anti-replay', async () => {
    const { id, accessToken } = (await call('/api/orders', { method: 'POST', body: validOrder() })).json;
    await call(`/api/orders/${id}/photos`, { method: 'PUT', token: accessToken, raw: jpegWithExif() });
    await call('/api/dev/mock-pay', { method: 'POST', token: accessToken, body: { id } });
    for (let i = 0; i < 50 && !hits.length; i++) await new Promise(r => setTimeout(r, 20));
    const hit = hits[0];
    assert.equal(hit.headers['x-studio-signature'], `sha256=${hmacHex(SECRET, `${hit.headers['x-studio-timestamp']}.${hit.body}`)}`);
    const job = JSON.parse(hit.body);
    assert.equal(job.order.briefing.styles.video, 'produto-360');
    assert.equal(job.photos.length, 1);
    assert.match(job.photos[0].url, /\/api\/files\/AT-.*sig=/);
    assert.ok(!hit.body.includes(accessToken) && !hit.body.includes('ana@exemplo.com'));

    const fake = signed({ orderId: id, status: 'failed' }, 'outro-segredo');
    assert.equal((await call('/api/bots/callback', { method: 'POST', raw: fake.raw, headers: fake.headers })).status, 401);
    const prog = signed({ orderId: id, status: 'in_production', progress: 60 });
    assert.equal((await call('/api/bots/callback', { method: 'POST', raw: prog.raw, headers: prog.headers })).status, 200);
    assert.equal((await call('/api/bots/callback', { method: 'POST', raw: prog.raw, headers: prog.headers })).json.duplicate, true);
    const evil = signed({ orderId: id, status: 'delivered', assets: [{ type: 'video', url: 'javascript:alert(1)' }] });
    assert.equal((await call('/api/bots/callback', { method: 'POST', raw: evil.raw, headers: evil.headers })).status, 400);
    const done = signed({ orderId: id, status: 'delivered', assets: [{ type: 'video', url: 'https://cdn.exemplo.com/v.mp4' }] });
    await call('/api/bots/callback', { method: 'POST', raw: done.raw, headers: done.headers });
    const o = (await call(`/api/orders/${id}`, { token: accessToken })).json;
    assert.equal(o.status, 'delivered');
    assert.equal(o.assets[0].url, 'https://cdn.exemplo.com/v.mp4');
  });
});

test('produção recusa provedor mock e exige dados do Pix', async () => {
  await assert.rejects(createApp({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock' }), /proibido em produção/);
  await assert.rejects(createApp({ PAYMENT_PROVIDER: 'pix' }), /PIX_KEY/);
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
