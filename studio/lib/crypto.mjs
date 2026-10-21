/**
 * Primitivas criptográficas usadas em toda a plataforma.
 */
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = s => createHash('sha256').update(s).digest('hex');
export const hmacHex = (secret, payload) => createHmac('sha256', secret).update(payload).digest('hex');

/** Comparação em tempo constante — evita descobrir o segredo medindo a latência. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** Id curto e legível para o cliente ("AT-7K2Q9M"), sem caracteres ambíguos. */
export function orderId() {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const b = randomBytes(8);
  let s = '';
  for (const byte of b) s += alphabet[byte % alphabet.length];
  return `AT-${s}`;
}

/**
 * Assinatura de webhook entre a plataforma e os bots:
 *   X-Studio-Timestamp: <unix segundos>
 *   X-Studio-Signature: sha256=<hex HMAC-SHA256(secret, `${timestamp}.${corpo}`)>
 * O timestamp entra na assinatura para impedir reenvio de uma mensagem antiga.
 */
export function signBody(secret, body, ts = Math.floor(Date.now() / 1000)) {
  return { timestamp: String(ts), signature: `sha256=${hmacHex(secret, `${ts}.${body}`)}` };
}

export function verifyBody(secret, body, timestamp, signature, toleranceSec = 300) {
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSec) return false;
  return safeEqual(signature, `sha256=${hmacHex(secret, `${ts}.${body}`)}`);
}
