// Autorização (RBAC + atributos) e sessões de DEMONSTRAÇÃO.
// Em produção, a sessão vem do IdP corporativo (OIDC/SAML com MFA); este módulo
// mantém apenas a camada de autorização, que é independente do provedor.


export const ROLES = {
  observador: {
    label: 'Observador',
    perms: ['read:twin', 'read:incidents'],
  },
  operador: {
    label: 'Operador NOC',
    perms: ['read:twin', 'read:incidents', 'read:restricted', 'read:sensitive', 'read:video', 'incident:ack', 'incident:resolve', 'device:maintenance', 'scenario:run', 'assistant:use'],
  },
  administrador: {
    label: 'Administrador',
    perms: ['read:twin', 'read:incidents', 'read:restricted', 'read:sensitive', 'read:video', 'incident:ack', 'incident:resolve', 'device:maintenance', 'scenario:run', 'assistant:use', 'admin:audit', 'admin:config'],
  },
};

export const can = (session, perm) => !!session && ROLES[session.role]?.perms.includes(perm);

const SESSION_TTL_MS = 8 * 3600 * 1000;

export class Sessions {
  constructor() { this.map = new Map(); }
  create(role) {
    if (!ROLES[role]) return null;
    // Web Crypto: disponível no Node ≥ 20 e no navegador (núcleo compartilhado)
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(24));
    const sid = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const s = { sid, role, user: `demo.${role}`, createdAt: Date.now(), agencies: ['AG-DEMO-001'] };
    this.map.set(sid, s);
    return s;
  }
  get(sid) {
    const s = sid && this.map.get(sid);
    if (!s) return null;
    if (Date.now() - s.createdAt > SESSION_TTL_MS) { this.map.delete(sid); return null; }
    return s;
  }
  destroy(sid) { this.map.delete(sid); }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const ID_RE = /\b[A-Z]+(?:-[A-Z]+)*-\d+\b/g;
/** Substitui identificadores de ativos ocultos em textos livres (motivos, diagnósticos). */
export const redactText = (text, hiddenIds) => String(text).replace(ID_RE, (m) => (hiddenIds.has(m) ? '[ativo em área restrita]' : m));

/** Remove campos sensíveis e oculta áreas restritas conforme o perfil. */
export function sanitizeDevice(device, session, restrictedRooms, hiddenIds = new Set()) {
  if (!can(session, 'read:restricted') && restrictedRooms.has(device.room)) return null;
  const d = { ...device };
  if (!can(session, 'read:sensitive')) { delete d.ip; delete d.serial; }
  if (!can(session, 'read:restricted') && hiddenIds.size) {
    // o motivo de um ativo visível não pode revelar a existência/ID de um ativo restrito
    if (d.reasons) d.reasons = d.reasons.map((r) => ({ ...r, text: redactText(r.text, hiddenIds) }));
    if (d.impactedBy) d.impactedBy = d.impactedBy.map((id) => (hiddenIds.has(id) ? '[restrito]' : id));
  }
  return d;
}

export function sanitizeIncident(inc, session, restrictedDeviceIds) {
  if (can(session, 'read:restricted')) return inc;
  const touchesRestricted = inc.deviceIds.some((id) => restrictedDeviceIds.has(id));
  if (!touchesRestricted) return inc;
  return {
    id: inc.id, kind: inc.kind, severity: inc.severity, priority: inc.priority, status: inc.status,
    createdAt: inc.createdAt, updatedAt: inc.updatedAt, agencyId: inc.agencyId, synthetic: inc.synthetic,
    title: 'Ocorrência envolvendo área restrita', deviceIds: [], redacted: true,
    timeline: [], diagnosis: null,
  };
}
