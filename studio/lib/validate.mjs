/**
 * VALIDAÇÃO DE ENTRADA — lista branca, tamanho máximo e tipo em cada campo.
 *
 * O briefing vai para um modelo de IA (os bots Grok). Por isso, além do
 * básico, limito o tamanho de cada campo e removo caracteres de controle:
 * texto gigante encarece a geração e facilita injeção de prompt.
 */
import { GOALS, STYLES, FORMATS, findPackage, ADDONS } from './catalog.mjs';

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;

export class ValidationError extends Error {
  constructor(field, message) { super(message); this.field = field; this.status = 400; }
}

function text(v, field, { min = 0, max, required = false } = {}) {
  const s = String(v ?? '').replace(CONTROL, '').trim();
  if (required && !s) throw new ValidationError(field, `${field}: campo obrigatório`);
  if (s.length < min) throw new ValidationError(field, `${field}: mínimo de ${min} caracteres`);
  if (s.length > max) throw new ValidationError(field, `${field}: máximo de ${max} caracteres`);
  return s;
}

function oneOf(v, list, field) {
  if (!list.includes(v)) throw new ValidationError(field, `${field}: opção inválida`);
  return v;
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

/**
 * Só aceito https e não BUSCO esses links no servidor — eles são repassados
 * ao bot como referência. Assim a plataforma não vira proxy para a rede
 * interna (SSRF).
 */
export function httpsUrl(v, field) {
  const s = text(v, field, { max: 500 });
  let u;
  try { u = new URL(s); } catch { throw new ValidationError(field, `${field}: URL inválida`); }
  if (u.protocol !== 'https:') throw new ValidationError(field, `${field}: use um link https://`);
  if (u.username || u.password) throw new ValidationError(field, `${field}: URL com credenciais não é aceita`);
  return u.toString();
}

export function validateOrderInput(body) {
  if (!body || typeof body !== 'object') throw new ValidationError('body', 'corpo inválido');

  const packageId = text(body.packageId, 'packageId', { required: true, max: 40 });
  if (!findPackage(packageId)) throw new ValidationError('packageId', 'pacote inexistente');

  const addons = Array.isArray(body.addons) ? body.addons.slice(0, ADDONS.length).map(String) : [];
  for (const a of addons) if (!ADDONS.some(x => x.id === a)) throw new ValidationError('addons', 'adicional inválido');

  const b = body.briefing || {};
  const references = Array.isArray(b.references) ? b.references.filter(Boolean).slice(0, 5) : [];

  const briefing = {
    goal: oneOf(b.goal, GOALS, 'goal'),
    style: oneOf(b.style, STYLES, 'style'),
    format: oneOf(b.format, FORMATS, 'format'),
    brand: text(b.brand, 'brand', { required: true, min: 2, max: 80 }),
    product: text(b.product, 'product', { required: true, min: 2, max: 120 }),
    audience: text(b.audience, 'audience', { max: 200 }),
    message: text(b.message, 'message', { required: true, min: 20, max: 1500 }),
    cta: text(b.cta, 'cta', { max: 80 }),
    script: text(b.script, 'script', { max: 2500 }),
    references: references.map((r, i) => httpsUrl(r, `references[${i}]`)),
  };

  const c = body.customer || {};
  const email = text(c.email, 'email', { required: true, max: 254 }).toLowerCase();
  if (!EMAIL.test(email)) throw new ValidationError('email', 'e-mail inválido');
  const customer = {
    name: text(c.name, 'name', { required: true, min: 2, max: 100 }),
    email,
    whatsapp: text(c.whatsapp, 'whatsapp', { max: 20 }).replace(/[^\d+]/g, ''),
  };

  if (body.acceptTerms !== true) throw new ValidationError('acceptTerms', 'é preciso aceitar os termos e a política de privacidade');

  return { packageId, addons, briefing, customer };
}
