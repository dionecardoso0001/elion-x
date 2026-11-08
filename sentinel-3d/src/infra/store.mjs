// Persistência local do MVP: JSON/JSONL em ./data (fora do versionamento).
// Produção: PostgreSQL (entidades/incidentes/auditoria) + TimescaleDB (séries) — ver docs/ARQUITETURA.md §5.

import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.paths = {
      incidents: path.join(dir, 'incidents.json'),
      events: path.join(dir, 'events.jsonl'),
      audit: path.join(dir, 'audit.jsonl'),
      config: path.join(dir, 'config.json'),
    };
    this.saveTimer = null;
  }

  readJson(p, fallback) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
  }

  readJsonl(p, limit = 5000) {
    try {
      const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
      return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  }

  loadIncidents() { return this.readJson(this.paths.incidents, []); }
  loadEvents() { return this.readJsonl(this.paths.events); }
  loadAudit() { return this.readJsonl(this.paths.audit, 2000); }
  loadConfig() { return { retentionDays: 30, ...this.readJson(this.paths.config, {}) }; }

  saveConfig(cfg) { fs.writeFileSync(this.paths.config, JSON.stringify(cfg, null, 2)); }

  /** Grava incidentes com debounce e escrita atômica (tmp + rename). */
  saveIncidents(incidents) {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const tmp = this.paths.incidents + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(incidents));
      fs.renameSync(tmp, this.paths.incidents);
    }, 500);
  }

  appendEvent(ev) { fs.appendFile(this.paths.events, JSON.stringify(ev) + '\n', () => {}); }
  appendAudit(entry) { fs.appendFile(this.paths.audit, JSON.stringify(entry) + '\n', () => {}); }

  /** Retenção: remove eventos mais antigos que retentionDays. */
  prune(retentionDays, now = Date.now()) {
    const cutoff = now - retentionDays * 86400000;
    const keep = this.readJsonl(this.paths.events, Infinity).filter((e) => e.ts >= cutoff);
    fs.writeFileSync(this.paths.events, keep.map((e) => JSON.stringify(e)).join('\n') + (keep.length ? '\n' : ''));
    return keep.length;
  }

  flush(incidents) {
    clearTimeout(this.saveTimer);
    fs.writeFileSync(this.paths.incidents, JSON.stringify(incidents));
  }
}
