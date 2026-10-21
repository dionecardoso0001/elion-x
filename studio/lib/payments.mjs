/**
 * PAGAMENTOS — adaptador com três provedores:
 *
 *  - "pix":    Pix estático com a SUA chave. O site mostra QR e copia-e-cola
 *              com valor e id do pedido; o cliente avisa "já paguei" e VOCÊ
 *              confirma no painel depois de ver o crédito no extrato.
 *              Sem taxa de intermediário; conciliação manual.
 *  - "mock":   checkout simulado para desenvolvimento. O servidor RECUSA
 *              iniciar com ele em NODE_ENV=production.
 *  - "stripe": Stripe Checkout (cartão; Pix/boleto conforme habilitado na
 *              sua conta Stripe Brasil). Sem SDK: uma chamada REST e a
 *              verificação de assinatura do webhook feita aqui mesmo.
 *
 * Regra de ouro: o pedido só vira "pago" pelo WEBHOOK assinado do provedor,
 * nunca pelo redirecionamento do navegador (que qualquer um pode forjar).
 */
import { hmacHex, safeEqual } from './crypto.mjs';
import { pixPayload } from './pix.mjs';

const STRIPE_API = 'https://api.stripe.com/v1';

export function paymentProvider(env = process.env) {
  const name = (env.PAYMENT_PROVIDER || 'mock').toLowerCase();
  if (name === 'stripe') return stripeProvider(env);
  if (name === 'mock') return mockProvider(env);
  if (name === 'pix') return pixProvider(env);
  throw new Error(`PAYMENT_PROVIDER desconhecido: ${name}`);
}

function pixProvider(env) {
  const key = (env.PIX_KEY || '').trim();
  const holder = (env.PIX_NAME || '').trim();
  const city = (env.PIX_CITY || '').trim();
  if (!key || !holder || !city) throw new Error('Pix exige PIX_KEY, PIX_NAME e PIX_CITY no .env');
  return {
    name: 'pix',
    manual: true,
    // O "checkout" é a própria página do pedido, que mostra o QR.
    async createCheckout({ order }) { return { sessionId: `pix_${order.id}`, url: null }; },
    instructions(order) {
      return {
        method: 'pix',
        key,
        holder,
        amountCents: order.quote.totalCents,
        txid: order.id.replace(/[^A-Z0-9]/g, ''),
        copyPaste: pixPayload({ key, name: holder, city, amountCents: order.quote.totalCents, txid: order.id, description: `Pedido ${order.id}` }),
      };
    },
  };
}

function mockProvider() {
  return {
    name: 'mock',
    async createCheckout({ order, baseUrl }) {
      return { sessionId: `mock_${order.id}`, url: `${baseUrl}/pagamento-simulado.html?id=${encodeURIComponent(order.id)}` };
    },
  };
}

function stripeProvider(env) {
  const key = (env.STRIPE_SECRET_KEY || '').trim();
  const whsec = (env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!key || !whsec) throw new Error('Stripe exige STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET no .env');

  return {
    name: 'stripe',
    async createCheckout({ order, baseUrl }) {
      const p = new URLSearchParams();
      p.set('mode', 'payment');
      p.set('client_reference_id', order.id);
      p.set('customer_email', order.customer.email);
      p.set('metadata[order_id]', order.id);
      p.set('line_items[0][quantity]', '1');
      p.set('line_items[0][price_data][currency]', 'brl');
      p.set('line_items[0][price_data][unit_amount]', String(order.quote.totalCents));
      p.set('line_items[0][price_data][product_data][name]', `${order.packageName} · pedido ${order.id}`);
      p.set('success_url', `${baseUrl}/pedido.html?id=${encodeURIComponent(order.id)}&pago=1`);
      p.set('cancel_url', `${baseUrl}/pedido.html?id=${encodeURIComponent(order.id)}&cancelado=1`);

      const r = await fetch(`${STRIPE_API}/checkout/sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': `checkout-${order.id}`,
        },
        body: p,
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(`Stripe recusou o checkout (${r.status})`), { status: 502, detail: j?.error?.message });
      return { sessionId: j.id, url: j.url };
    },

    /**
     * Verifica o cabeçalho Stripe-Signature ("t=...,v1=...") sobre o corpo
     * BRUTO e devolve o evento já interpretado, ou null se for falso.
     */
    parseWebhook(rawBody, header, toleranceSec = 300) {
      if (!header) return null;
      const parts = Object.fromEntries(String(header).split(',').map(kv => kv.split('=')).filter(x => x.length === 2));
      const t = Number(parts.t);
      const sigs = String(header).split(',').filter(s => s.startsWith('v1=')).map(s => s.slice(3));
      if (!Number.isInteger(t) || !sigs.length || Math.abs(Date.now() / 1000 - t) > toleranceSec) return null;
      const expected = hmacHex(whsec, `${t}.${rawBody}`);
      if (!sigs.some(s => safeEqual(s, expected))) return null;
      try { return JSON.parse(rawBody); } catch { return null; }
    },
  };
}
