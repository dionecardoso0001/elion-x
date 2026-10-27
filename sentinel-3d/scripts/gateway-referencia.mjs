// Gateway de REFERÊNCIA — envia leituras à plataforma pelo contrato POST /api/ingest.
// Roda no segmento autorizado da agência. Ele NÃO conversa com equipamentos: os adaptadores
// (SNMPv3, ONVIF, MQTT, BACnet, Modbus) entram aqui após homologação com cada fabricante e
// produzem linhas NDJSON no formato abaixo.
//
// Uso:
//   SENTINEL_URL=https://sentinel.exemplo:8730 SENTINEL_INGEST_TOKEN=... \
//     node scripts/gateway-referencia.mjs leituras.ndjson      (ou via stdin: ... | node scripts/gateway-referencia.mjs)
// Cada linha: {"deviceId":"TH-01","values":{"tempC":23.4,"humidityPct":47},"sourceTs":1767225600000}
// (sourceTs opcional: usa o relógio do gateway; mantenha o gateway sincronizado por NTP)

import fs from 'node:fs';
import readline from 'node:readline';

const URL_BASE = process.env.SENTINEL_URL || 'http://127.0.0.1:8730';
const TOKEN = process.env.SENTINEL_INGEST_TOKEN;
const BATCH = 500;          // limite do contrato
const FLUSH_MS = 2000;
const MAX_RETRIES = 5;

export async function send(readings, { url = URL_BASE, token = TOKEN, log = console } = {}) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetch(`${url}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ readings }),
      });
      if (res.status === 401 || res.status === 404) throw Object.assign(new Error(`HTTP ${res.status}: ${(await res.json()).error}`), { fatal: true });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      for (const r of body.results.filter((x) => !x.ok)) log.warn(`  rejeitada: ${r.error}`);
      return body;
    } catch (e) {
      if (e.fatal || attempt === MAX_RETRIES) throw e;
      const wait = 1000 * 2 ** attempt; // 1, 2, 4, 8, 16 s
      log.warn(`  falha de envio (${e.message}); nova tentativa em ${wait / 1000} s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function main() {
  if (!TOKEN) { console.error('Defina SENTINEL_INGEST_TOKEN.'); process.exit(2); }
  const input = process.argv[2] ? fs.createReadStream(process.argv[2]) : process.stdin;
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let buf = [];
  let total = { accepted: 0, rejected: 0 };
  const flush = async () => {
    if (!buf.length) return;
    const batch = buf; buf = [];
    const r = await send(batch);
    total.accepted += r.accepted; total.rejected += r.rejected;
    console.log(`lote: ${r.accepted} aceitas, ${r.rejected} rejeitadas`);
  };
  const timer = setInterval(() => flush().catch((e) => { console.error(e.message); process.exitCode = 1; }), FLUSH_MS);
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { console.warn(`linha ignorada (JSON inválido): ${line.slice(0, 80)}`); continue; }
    buf.push({ sourceTs: Date.now(), ...rec });
    if (buf.length >= BATCH) await flush();
  }
  clearInterval(timer);
  await flush();
  console.log(`total: ${total.accepted} aceitas, ${total.rejected} rejeitadas`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
