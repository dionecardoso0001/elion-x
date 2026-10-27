// Motor de incidentes: um grupo correlacionado => um incidente (upsert por chave estável).
// Ciclo de vida: aberto → reconhecido → normalizado (condição cessou) → resolvido (humano).

export const ESCALATION_AFTER_MS = 60_000; // demo: crítico não reconhecido em 60 s sobe de nível
const SEV_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

// Janela de confirmação (hold-down): um sinal isolado de perda de comunicação precisa persistir
// antes de virar incidente, porque dispositivos de uma mesma cadeia ficam "antigos" em instantes
// ligeiramente diferentes (jitter de coleta). Sem isso, o dependente abriria um incidente
// duplicado segundos antes de a correlação identificar o componente compartilhado.
// O mesmo vale para "porta inativa" no switch a montante (indicador antecipado de falha a jusante)
// e para anomalias estatísticas, que exigem persistência por serem ruidosas por natureza.
export const HOLD_MS = { cascade: 0, power: 0, fire: 0, thermal: 0, failover: 10000, inferred: 8000, anomaly: 10000, 'port-down': 10000, offline: 10000, unknown: 10000, default: 3000 };
export const holdFor = (kind) => HOLD_MS[kind] ?? HOLD_MS.default;

export class IncidentManager {
  constructor({ incidents = [], onEvent = () => {} } = {}) {
    this.incidents = incidents;
    this.onEvent = onEvent;
    this.seq = incidents.length;
    this.pending = new Map(); // chave do grupo -> primeira vez observado
  }

  active() { return this.incidents.filter((i) => i.status !== 'resolvido'); }
  get(id) { return this.incidents.find((i) => i.id === id); }

  newId(now) {
    this.seq += 1;
    const d = new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
    return `INC-${d}-${String(this.seq).padStart(4, '0')}`;
  }

  /** Reconcilia os grupos do ciclo atual com os incidentes existentes. */
  reconcile(groups, diagnoses, now, ctx) {
    const changed = [];
    const seenKeys = new Set();
    for (const g of groups) {
      seenKeys.add(g.key);
      const dx = diagnoses.get(g.key);
      let inc = this.incidents.find((i) => i.key === g.key && i.status !== 'resolvido');
      if (!inc && g.kind !== 'single') {
        // a causa raiz (ou um membro) já tinha incidente individual: promove-o em vez de abrir outro
        const singles = [g.root, ...g.members].map((id) => 'single:' + id);
        inc = singles.map((k) => this.incidents.find((i) => i.key === k && i.status !== 'resolvido')).find(Boolean);
        if (inc) {
          inc.key = g.key;
          inc.timeline.push({ ts: now, type: 'correlacionado', text: `Correlacionado (${g.kind}): sinais relacionados agrupados neste incidente` });
        }
      }
      if (!inc) {
        const seen = this.pending.get(g.key) ?? now;
        this.pending.set(g.key, seen);
        if (now - seen < holdFor(dx.kind)) continue; // ainda em confirmação
        this.pending.delete(g.key);
        const firstSignalAt = Math.min(...g.members.map((id) => ctx.firstSignal.get(id) ?? now));
        inc = {
          id: this.newId(now), key: g.key, kind: dx.kind, agencyId: ctx.agencyId,
          title: dx.title, severity: dx.severity, priority: dx.priority,
          status: 'aberto', rootDeviceId: g.root, deviceIds: [...g.members],
          firstSignalAt, createdAt: now, updatedAt: now, escalationLevel: 1,
          alertCount: g.members.length, suppressedDuplicates: Math.max(0, g.members.length - 1),
          diagnosis: dx, timeline: [{ ts: now, type: 'criado', text: `Incidente criado: ${dx.title}` }],
          synthetic: true,
        };
        this.incidents.push(inc);
        this.onEvent('incident.created', inc);
        changed.push(inc);
        continue;
      }
      // atualização
      const before = JSON.stringify([inc.deviceIds, inc.severity, inc.diagnosis?.confidence, inc.status]);
      const added = g.members.filter((m) => !inc.deviceIds.includes(m));
      if (added.length) {
        inc.timeline.push({ ts: now, type: 'agrupado', text: `Sinais agrupados (duplicatas suprimidas): ${added.join(', ')}` });
        inc.alertCount += added.length;
        inc.suppressedDuplicates += added.length;
      }
      inc.deviceIds = [...new Set([...inc.deviceIds, ...g.members])];
      if (inc.status === 'normalizado') {
        inc.status = inc.ackAt ? 'reconhecido' : 'aberto';
        inc.recoveredAt = null;
        inc.recurrences = (inc.recurrences || 0) + 1;
        inc.timeline.push({ ts: now, type: 'reincidente', text: 'Condição voltou a ocorrer antes do encerramento' });
        this.onEvent('incident.reopened', inc);
      }
      if (SEV_RANK[dx.severity] > SEV_RANK[inc.severity]) {
        inc.timeline.push({ ts: now, type: 'severidade', text: `Severidade elevada: ${inc.severity} → ${dx.severity}` });
        inc.severity = dx.severity; inc.priority = dx.priority;
      }
      inc.title = dx.title;
      inc.kind = dx.kind;
      inc.diagnosis = dx;
      if (JSON.stringify([inc.deviceIds, inc.severity, inc.diagnosis?.confidence, inc.status]) !== before) {
        inc.updatedAt = now; changed.push(inc);
      }
    }
    for (const k of this.pending.keys()) if (!seenKeys.has(k)) this.pending.delete(k); // absorvido ou cessou
    // normalização e escalonamento
    for (const inc of this.incidents) {
      if (inc.status === 'resolvido' || inc.synthetic === 'history') continue;
      if (!seenKeys.has(inc.key) && inc.status !== 'normalizado') {
        inc.status = 'normalizado'; inc.recoveredAt = now; inc.updatedAt = now;
        inc.timeline.push({ ts: now, type: 'normalizado', text: 'Condição cessou na telemetria — aguardando encerramento pelo operador' });
        this.onEvent('incident.recovered', inc);
        changed.push(inc);
      }
      if (inc.status === 'aberto' && inc.severity === 'critical' && now - inc.createdAt > ESCALATION_AFTER_MS * inc.escalationLevel && inc.escalationLevel < 3) {
        inc.escalationLevel += 1; inc.updatedAt = now;
        const who = inc.escalationLevel === 2 ? 'supervisor de plantão (demo)' : 'coordenação de operações (demo)';
        inc.timeline.push({ ts: now, type: 'escalonado', text: `Sem reconhecimento: escalonado ao nível ${inc.escalationLevel} — ${who}` });
        this.onEvent('incident.escalated', inc);
        changed.push(inc);
      }
    }
    return changed;
  }

  acknowledge(id, user, now) {
    const inc = this.get(id);
    if (!inc) return { error: 'não encontrado', code: 404 };
    if (inc.status === 'resolvido') return { error: 'incidente já resolvido', code: 409 };
    if (inc.ackAt) return { incident: inc };
    inc.ackAt = now; inc.ackBy = user; inc.updatedAt = now;
    if (inc.status === 'aberto') inc.status = 'reconhecido';
    inc.timeline.push({ ts: now, type: 'reconhecido', text: `Reconhecido por ${user}` });
    this.onEvent('incident.acknowledged', inc);
    return { incident: inc };
  }

  resolve(id, user, note, now) {
    const inc = this.get(id);
    if (!inc) return { error: 'não encontrado', code: 404 };
    if (inc.status === 'resolvido') return { error: 'incidente já resolvido', code: 409 };
    if (inc.status !== 'normalizado') return { error: 'a condição ainda está ativa na telemetria; aguarde a normalização ou registre manutenção', code: 409 };
    inc.status = 'resolvido'; inc.resolvedAt = now; inc.resolvedBy = user; inc.resolutionNote = note; inc.updatedAt = now;
    if (!inc.ackAt) { inc.ackAt = now; inc.ackBy = user; }
    inc.timeline.push({ ts: now, type: 'resolvido', text: `Resolvido por ${user}: ${note}` });
    this.onEvent('incident.resolved', inc);
    return { incident: inc };
  }
}

/** Métricas operacionais derivadas dos registros (MTTD/MTTR em ms). */
export function incidentMetrics(incidents) {
  const detect = incidents.filter((i) => i.firstSignalAt && i.createdAt).map((i) => i.createdAt - i.firstSignalAt);
  const recover = incidents.filter((i) => i.resolvedAt).map((i) => i.resolvedAt - i.createdAt);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return { mttdMs: avg(detect), mttrMs: avg(recover), nDetect: detect.length, nRecover: recover.length };
}
