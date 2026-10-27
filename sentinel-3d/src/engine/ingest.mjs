// Validação e normalização de telemetria — a mesma porta de entrada para o
// simulador e para conectores reais (POST /api/ingest). Nada entra no estado sem passar aqui.

import { TYPES } from '../domain/catalog.mjs';

const MAX_PAST_MS = 24 * 3600 * 1000;   // leituras mais antigas que 24 h são rejeitadas
const MAX_FUTURE_MS = 5 * 60 * 1000;    // tolerância de relógio do equipamento: 5 min

const STRING_ENUMS = {
  state: ['normal', 'alarme', 'falha', 'supervisao', 'violado'],
  armed: ['armada', 'desarmada', 'parcial'],
  sensorState: ['fechado', 'aberto', 'indeterminado'],
};

/**
 * @returns {{ ok: true, reading } | { ok: false, error }}
 * reading = { deviceId, sourceTs, ingestTs, values, quality, dropped[] }
 */
export function validateReading(raw, devicesById, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'payload inválido' };
  const { deviceId, sourceTs, values } = raw;
  if (typeof deviceId !== 'string' || !/^[A-Z0-9-]{2,32}$/.test(deviceId)) return { ok: false, error: 'deviceId inválido' };
  const device = devicesById.get(deviceId);
  if (!device) return { ok: false, error: `dispositivo não cadastrado: ${deviceId}` };
  if (!Number.isFinite(sourceTs)) return { ok: false, error: 'sourceTs deve ser epoch em ms (UTC)' };
  if (sourceTs < now - MAX_PAST_MS || sourceTs > now + MAX_FUTURE_MS) return { ok: false, error: 'sourceTs fora da janela aceita (relógio do equipamento?)' };
  if (!values || typeof values !== 'object' || Array.isArray(values)) return { ok: false, error: 'values deve ser objeto' };

  const def = TYPES[device.type];
  const allowed = new Map(def.metrics.map((m) => [m.key, m]));
  const clean = {};
  const dropped = [];
  for (const [k, v] of Object.entries(values)) {
    if (!allowed.has(k)) { dropped.push(k); continue; }
    if (typeof v === 'number') { if (Number.isFinite(v)) clean[k] = v; else dropped.push(k); }
    else if (typeof v === 'boolean') clean[k] = v;
    else if (typeof v === 'string' && STRING_ENUMS[k]?.includes(v)) clean[k] = v;
    else dropped.push(k);
  }
  const quality = raw.quality === 'bad' ? 'bad' : (dropped.length ? 'partial' : 'good');
  return { ok: true, reading: { deviceId, sourceTs, ingestTs: now, values: clean, quality, dropped } };
}
