// NÍVEL 1 — Motor de regras determinísticas.
// Funções puras: recebem leitura + contexto e devolvem estado + motivos rastreáveis.
// Regras documentadas em docs/ARQUITETURA.md §6 (máquina de estados).

import { TYPES, DATA_PATH_EDGES } from '../domain/catalog.mjs';

export const STALE_FACTOR = 3; // telemetria é "antiga" após 3 intervalos sem leitura

function test(cond, value) {
  if (!cond || value === undefined || value === null) return false;
  switch (cond.op) {
    case 'gt': return value > cond.v;
    case 'lt': return value < cond.v;
    case 'eq': return value === cond.v;
    case 'in': return cond.v.includes(value);
    default: return false;
  }
}

/** Avalia limiares de uma leitura. Retorna { level: 'ok'|'degraded'|'critical', reasons[] } */
export function evaluateThresholds(type, values) {
  const def = TYPES[type];
  const reasons = [];
  let level = 'ok';
  for (const m of def.metrics) {
    const v = values[m.key];
    if (test(m.crit, v)) {
      level = 'critical';
      reasons.push({ code: `${m.key}:crit`, level: 'critical', metric: m.key, value: v, text: m.msg || `${m.label} em nível crítico (${fmt(v, m.unit)})` });
    } else if (test(m.warn, v)) {
      if (level === 'ok') level = 'degraded';
      reasons.push({ code: `${m.key}:warn`, level: 'degraded', metric: m.key, value: v, text: m.msg || `${m.label} fora da faixa (${fmt(v, m.unit)})` });
    }
  }
  return { level, reasons };
}

function fmt(v, unit) {
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (typeof v === 'number') return `${Math.round(v * 100) / 100}${unit ? ' ' + unit : ''}`;
  return String(v);
}

export function staleAfterMs(type) { return TYPES[type].intervalMs * STALE_FACTOR; }

/**
 * Calcula o estado de todos os dispositivos em ordem topológica do caminho de dados.
 * @param devices   lista de dispositivos
 * @param deps      arestas de dependência
 * @param latest    Map id -> última leitura válida { values, sourceTs, ingestTs, quality }
 * @param now       timestamp (ms)
 * @param flags     Map id -> { maintenance: bool }
 * @param anomalies Map id -> [reason] (nível 2, estatístico)
 */
export function computeStates({ devices, deps, latest, now, flags = new Map(), anomalies = new Map() }) {
  const parents = new Map(devices.map((d) => [d.id, []]));
  for (const e of deps) if (DATA_PATH_EDGES.has(e.type) && parents.has(e.to)) parents.get(e.to).push(e);

  const states = new Map();
  const byId = new Map(devices.map((d) => [d.id, d]));
  const visiting = new Set();

  const visit = (id) => {
    if (states.has(id)) return states.get(id);
    if (visiting.has(id)) throw new Error(`Ciclo no grafo de dados em ${id}`);
    visiting.add(id);
    for (const e of parents.get(id)) visit(e.from);
    visiting.delete(id);
    const st = evaluateDevice(byId.get(id), parents.get(id), states, latest.get(id), now, flags.get(id), anomalies.get(id));
    states.set(id, st);
    return st;
  };
  for (const d of devices) visit(d.id);
  return states;
}

function evaluateDevice(device, parentEdges, states, reading, now, flag, anomaly) {
  const base = { id: device.id, lastSeen: reading?.ingestTs ?? null, ageMs: reading ? now - reading.ingestTs : null };

  if (flag?.maintenance) {
    return { ...base, status: 'maintenance', reasons: [{ code: 'maintenance', level: 'maintenance', text: `Em manutenção programada${flag.note ? ': ' + flag.note : ''}` }] };
  }
  if (!reading) {
    return { ...base, status: 'unknown', reasons: [{ code: 'never', level: 'unknown', text: 'Nenhuma telemetria recebida desde o cadastro' }] };
  }
  const stale = now - reading.ingestTs > staleAfterMs(device.type);
  if (stale) {
    // Regra central: telemetria antiga NUNCA vira "operacional".
    // Se o caminho de comunicação caiu, não sabemos o estado físico → "sem dados confiáveis".
    const down = (e) => ['offline', 'unknown'].includes(states.get(e.from)?.status);
    // caminhos redundantes (ex.: dois links WAN) só contam como quebrados se TODOS caírem
    const redundant = parentEdges.filter((e) => e.redundant);
    const brokenPath = [
      ...parentEdges.filter((e) => !e.redundant && down(e)),
      ...(redundant.length && redundant.every(down) ? redundant : []),
    ];
    if (brokenPath.length) {
      return {
        ...base, status: 'unknown', impactedBy: brokenPath.map((e) => e.from),
        reasons: [{ code: 'path-down', level: 'unknown', text: `Sem telemetria: caminho de comunicação via ${brokenPath.map((e) => e.from).join(', ')} indisponível. Estado físico indeterminado.` }],
      };
    }
    return {
      ...base, status: 'offline',
      reasons: [{ code: 'comm-loss', level: 'offline', text: `Sem comunicação há ${Math.round((now - reading.ingestTs) / 1000)} s (limite ${staleAfterMs(device.type) / 1000} s); caminho de rede a montante operante` }],
    };
  }
  if (reading.quality === 'bad') {
    return { ...base, status: 'unknown', reasons: [{ code: 'bad-quality', level: 'unknown', text: 'Leitura recebida com qualidade inválida' }] };
  }
  const { level, reasons } = evaluateThresholds(device.type, reading.values);
  const all = [...reasons, ...(anomaly || [])];
  const status = level === 'ok' && anomaly?.length ? 'degraded' : level;
  return { ...base, status, reasons: all };
}
