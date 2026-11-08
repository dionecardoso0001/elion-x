// Backend LOCAL da versão autônoma: o mesmo núcleo do servidor (src/http/api.mjs, motor,
// regras, correlação, RBAC) executando dentro do navegador. Usado só no arquivo único gerado
// por scripts/build-standalone.mjs; o modo servidor (npm start) não carrega este módulo.

import { Platform } from '../../../src/platform.mjs';
import { Sessions } from '../../../src/security/auth.mjs';
import { createApi } from '../../../src/http/api.mjs';

// Ida e volta em JSON: o cliente recebe cópias, exatamente como pela rede (sem estado compartilhado).
const wire = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

export function createLocalBackend({ tickMs = 1000 } = {}) {
  const platform = new Platform({ store: null }); // sem disco: histórico vive enquanto a aba estiver aberta
  const sessions = new Sessions();
  const auditLog = [];
  const audit = (session, action, target, extra = {}) => {
    auditLog.push({ ts: Date.now(), user: session?.user ?? 'anônimo', role: session?.role ?? null, action, target, ...extra });
    if (auditLog.length > 2000) auditLog.shift();
  };
  const core = createApi({ platform, sessions, audit, auditLog, uptimeS: () => performance.now() / 1000 });
  setInterval(() => platform.cycle(Date.now()), tickMs);
  let sid = null; // equivalente ao cookie de sessão

  return {
    mode: 'local',
    async request(method, url, body) {
      const u = new URL(url, 'http://sentinel.local');
      const r = core.handle({ method, path: u.pathname, query: u.searchParams, body: wire(body) ?? null, session: sessions.get(sid) });
      if (r.newSession) sid = r.newSession.sid;
      return { status: r.status, body: wire(r.body), text: r.text, filename: r.filename, contentType: r.contentType };
    },
    stream({ onSnapshot, onUpdate, onNotify, onState }) {
      const session = sessions.get(sid);
      if (!session) { onState?.('reconectando'); return { close() {} }; }
      const close = core.subscribe(session, (event, data) => {
        const d = wire(data);
        if (event === 'snapshot') onSnapshot(d); else if (event === 'update') onUpdate(d); else onNotify(d);
      });
      onState?.('aberto');
      return { close };
    },
  };
}
