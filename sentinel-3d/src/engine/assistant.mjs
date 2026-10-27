// Assistente operacional: roteia a pergunta para FERRAMENTAS TIPADAS que consultam
// somente dados autorizados para a sessão. O texto do usuário nunca é executado nem
// repassado como instrução — apenas casado com intenções conhecidas (defesa contra prompt injection).

import { TYPES, STATUSES } from '../domain/catalog.mjs';
import { sanitizeDevice, sanitizeIncident } from '../security/auth.mjs';

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const WORD_NUM = { uma: 1, um: 1, duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, doze: 12, vinte: 20 };
const SEV_RANK = { critical: 3, high: 2, medium: 1, low: 0 };
const fmtAge = (ms) => (ms == null ? 'nunca' : ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60000)} min`);

export const INTENTS = [
  { id: 'report', test: (q) => /relatorio|report/.test(q) },
  { id: 'focus', test: (q) => /(leve|levar|mostre|ir ate|va ate|foco|focar|navegue|visualiza).*(equip|falh|problema|disposit)/.test(q) && !/camera/.test(q) },
  { id: 'camerasLost', test: (q) => /camera/.test(q) && /(perd|comunica|offline|sem video|sem sinal|cair|caiu)/.test(q) },
  { id: 'explain', test: (q) => /(causa|por que|porque|motivo|origem|explique|diagnost)/.test(q) },
  { id: 'ups', test: (q) => /(nobreak|ups|bateria)/.test(q) },
  { id: 'energy', test: (q) => /(energia|consum|kw|eletric)/.test(q) },
  { id: 'critical', test: (q) => /critic/.test(q) && /(incident|tratamento|abert|pendente)/.test(q) },
  { id: 'compare', test: (q) => /compar/.test(q) },
  { id: 'problems', test: (q) => /(problema|falha|alerta|anormal|status|situacao|como esta)/.test(q) },
];

export function answer(question, session, p, now = Date.now()) {
  const q = norm(String(question || '').slice(0, 500));
  const intent = INTENTS.find((i) => i.test(q))?.id || 'help';
  const tools = TOOLS[intent];
  const out = tools(q, { session, p, now });
  return { intent, tool: `tool_${intent}`, source: p.simulate ? 'Telemetria SIMULADA (modo demonstração)' : 'Telemetria de conectores (modo integração)', ...out };
}

const visibleDevices = (session, p, now) => p.devices
  .map((d) => sanitizeDevice(p.deviceView(d, now), session, p.restrictedRooms, p.restrictedDeviceIds))
  .filter(Boolean);

const TOOLS = {
  problems(q, { session, p, now }) {
    const bad = visibleDevices(session, p, now).filter((d) => !['ok', 'maintenance'].includes(d.status))
      .sort((a, b) => STATUSES[b.status].rank - STATUSES[a.status].rank);
    if (!bad.length) return { text: 'Todos os equipamentos visíveis ao seu perfil estão operacionais neste momento.', items: [] };
    return {
      text: `${bad.length} equipamento(s) fora do estado operacional:`,
      items: bad.map((d) => ({ deviceId: d.id, label: `${d.id} — ${d.name}`, status: d.status, detail: d.reasons[0]?.text || '' })),
      actions: [{ type: 'focus', deviceId: bad[0].id, label: `Ir até ${bad[0].id}` }],
    };
  },

  camerasLost(q, { session, p, now }) {
    const m = q.match(/(\d+|uma|um|duas|dois|tres|quatro|cinco|seis|doze|vinte)\s*(hora|h\b)/);
    const hours = m ? (WORD_NUM[m[1]] ?? Number(m[1])) : 2;
    const since = now - hours * 3600000;
    const cams = new Map(visibleDevices(session, p, now).filter((d) => d.type === 'camera').map((d) => [d.id, d]));
    const hits = new Set();
    for (const e of p.events) {
      if (e.ts < since || e.type !== 'state.changed' || !cams.has(e.deviceId)) continue;
      if (['offline', 'unknown', 'critical'].includes(e.to)) hits.add(e.deviceId);
    }
    for (const [id, d] of cams) if (['offline', 'unknown', 'critical'].includes(d.status)) hits.add(id);
    if (!hits.size) return { text: `Nenhuma câmera visível ao seu perfil perdeu comunicação ou vídeo nas últimas ${hours} h.`, items: [] };
    return {
      text: `${hits.size} câmera(s) com perda de comunicação ou de vídeo nas últimas ${hours} h:`,
      items: [...hits].map((id) => {
        const d = cams.get(id); // já sanitizado para o perfil
        return { deviceId: id, label: `${id} — ${d.name}`, status: d.status, detail: d.status === 'ok' ? 'Recuperada (evento registrado no período)' : d.reasons[0]?.text || 'evento registrado' };
      }),
    };
  },

  explain(q, { session, p, now }) {
    const active = p.incidents.active().map((i) => sanitizeIncident(i, session, p.restrictedDeviceIds)).filter((i) => !i.redacted);
    if (!active.length) return { text: 'Não há incidentes ativos visíveis ao seu perfil para diagnosticar.' };
    const room = p.agency.rooms.find((r) => norm(r.name).split(/[\s/()]+/).some((w) => w.length > 4 && q.includes(w)));
    const byRoom = room ? active.filter((i) => i.deviceIds.some((id) => p.byId.get(id)?.room === room.id)) : [];
    const byCam = /camera/.test(q) ? active.filter((i) => i.deviceIds.some((id) => p.byId.get(id)?.type === 'camera')) : [];
    // prioriza condição ativa (não normalizada), maior severidade e causa raiz que explica mais sinais
    const pick = [byRoom, byCam, active].find((l) => l.length).sort((a, b) =>
      (a.status === 'normalizado') - (b.status === 'normalizado') || SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.deviceIds.length - a.deviceIds.length)[0];
    const dx = pick.diagnosis;
    return {
      text: `Incidente ${pick.id}: ${dx.title}`,
      diagnosis: dx, incidentId: pick.id,
      note: room && !byRoom.length ? `Nenhum incidente ativo em ${room.name}; exibindo o mais severo.` : undefined,
      actions: [{ type: 'focus', deviceId: pick.rootDeviceId, label: `Ir até ${pick.rootDeviceId}` }],
    };
  },

  energy(q, { session, p, now }) {
    const meter = p.freshValues('MTR-01', now);
    const pdu = p.freshValues('PDU-01', now);
    const items = [];
    if (meter) items.push({ deviceId: 'MTR-01', label: 'MTR-01 — Quadro geral (QDG)', status: p.states.get('MTR-01').status, detail: `${meter.kW} kW agora · ${meter.kWhToday} kWh hoje · FP ${meter.pf ?? '—'}` });
    else items.push({ deviceId: 'MTR-01', label: 'MTR-01 — Quadro geral (QDG)', status: p.states.get('MTR-01').status, detail: `Sem leitura confiável (última há ${fmtAge(p.deviceView(p.byId.get('MTR-01'), now).ageMs)})` });
    if (pdu) items.push({ deviceId: 'PDU-01', label: 'PDU-01 — Rack do CPD', status: p.states.get('PDU-01').status, detail: `${pdu.kW} kW` });
    return {
      text: 'Pontos de medição de energia disponíveis:',
      items,
      note: 'Esta agência demonstrativa mede apenas o QDG (total) e a PDU do rack. Não há medição por equipamento individual, portanto não é possível ranquear quais equipamentos consomem mais sem instrumentação adicional.',
    };
  },

  ups(q, { session, p, now }) {
    const ups = visibleDevices(session, p, now).filter((d) => d.type === 'ups');
    if (!ups.length) return { text: 'Seu perfil não tem acesso aos nobreaks (área restrita).' };
    const tr = p.upsTrend();
    const a = tr.analysis;
    const items = ups.map((d) => ({ deviceId: d.id, label: `${d.id} — ${d.name}`, status: d.status,
      detail: `Em bateria: ${d.values.onBattery ? 'sim' : 'não'} · carga ${d.values.batteryPct ?? '—'}% · autonomia ${d.values.runtimeMin ?? '—'} min · saúde ${d.values.batteryHealthPct ?? '—'}%` }));
    let trendText = 'Sem tendência sustentada pelos dados.';
    if (a?.projection) trendText = `UPS-02: saúde da bateria caindo ${Math.abs(a.slopePerDay).toFixed(2)} p.p./dia (R² = ${a.r2.toFixed(2)}, n = ${a.n} dias). Projeção de atingir ${a.projection.threshold}% em ~${Math.round(a.projection.daysToThreshold)} dias, se a tendência linear se mantiver.`;
    return { text: 'Situação dos nobreaks:', items, note: `${trendText} Série histórica SINTÉTICA de demonstração.`, actions: [{ type: 'focus', deviceId: 'UPS-02', label: 'Ir até UPS-02' }] };
  },

  critical(q, { session, p }) {
    const list = p.incidents.active().filter((i) => i.severity === 'critical' && !i.ackAt).map((i) => sanitizeIncident(i, session, p.restrictedDeviceIds));
    if (!list.length) return { text: 'Não há incidentes críticos sem reconhecimento.' };
    return { text: `${list.length} incidente(s) crítico(s) aguardando tratamento:`, items: list.map((i) => ({ incidentId: i.id, deviceId: i.rootDeviceId, label: `${i.id} — ${i.title}`, status: 'critical', detail: `Aberto há ${fmtAge(Date.now() - i.createdAt)} · nível de escalonamento ${i.escalationLevel ?? 1}` })) };
  },

  compare(q, { p }) {
    const s = p.summary({ periodMs: 3600000 });
    const av = s.series.filter((x) => x.availabilityPct != null);
    const mean = av.length ? av.reduce((a, b) => a + b.availabilityPct, 0) / av.length : null;
    return {
      text: `Apenas ${p.twin.agencies.length} agência está cadastrada (${p.agency.name}); uma comparação exige ao menos duas.`,
      items: [{ label: p.agency.name, status: 'ok', detail: `Disponibilidade média na última hora: ${mean == null ? '—' : mean.toFixed(2) + '%'}${p.simulate ? ' (dados simulados/sintéticos)' : ''}` }],
    };
  },

  focus(q, { session, p, now }) {
    const bad = visibleDevices(session, p, now).filter((d) => ['critical', 'offline', 'degraded', 'unknown'].includes(d.status))
      .sort((a, b) => STATUSES[b.status].rank - STATUSES[a.status].rank);
    if (!bad.length) return { text: 'Nenhum equipamento em falha visível ao seu perfil.' };
    const d = bad[0];
    return { text: `Levando a visualização até ${d.id} (${d.name}) — ${STATUSES[d.status].label}.`, actions: [{ type: 'focus', deviceId: d.id, auto: true, label: `Ir até ${d.id}` }] };
  },

  report(q, { now }) {
    return { text: 'Relatório técnico dos incidentes de hoje gerado a partir dos registros.', actions: [{ type: 'download', href: '/api/reports/incidents?period=today', label: 'Baixar relatório (.md)' }] };
  },

  help() {
    return {
      text: 'Posso consultar (somente dados autorizados ao seu perfil):',
      items: [
        'Quais equipamentos apresentam problemas?', 'Mostre as câmeras que perderam comunicação nas últimas duas horas.',
        'Qual a provável causa da falha das câmeras da recepção?', 'Quais equipamentos estão consumindo mais energia?',
        'Existe algum nobreak apresentando degradação?', 'Mostre os incidentes críticos ainda sem tratamento.',
        'Compare a disponibilidade das agências monitoradas.', 'Leve minha visualização até o equipamento que está falhando.',
        'Gere um relatório técnico dos incidentes de hoje.',
      ].map((t) => ({ label: t, suggestion: true })),
    };
  },
};

/** Relatório Markdown derivado dos registros (não inventa números). */
export function incidentReport(p, session, periodStart, now = Date.now()) {
  const incs = p.incidents.incidents.filter((i) => i.createdAt >= periodStart).map((i) => sanitizeIncident(i, session, p.restrictedDeviceIds));
  const d = (ts) => (ts ? new Date(ts).toLocaleString('pt-BR', { timeZone: p.agency.timezone }) : '—');
  const lines = [
    `# Relatório técnico de incidentes — ${p.agency.name}`,
    '',
    p.simulate ? '> **MODO DEMONSTRAÇÃO — DADOS SIMULADOS.** Nenhum dado deste relatório provém de equipamento real.'
      : '> **MODO INTEGRAÇÃO.** Dados recebidos de gateways de integração. Ambiente sujeito a homologação.',
    '',
    `- Período: ${d(periodStart)} a ${d(now)} (${p.agency.timezone})`,
    `- Gerado por: ${session.user} (${session.role})`,
    `- Incidentes no período: ${incs.length}`,
    '',
  ];
  for (const i of incs) {
    lines.push(`## ${i.id} — ${i.title}`, '', `- Severidade/prioridade: ${i.severity} / ${i.priority}`, `- Estado: ${i.status}`, `- Criado: ${d(i.createdAt)} · Reconhecido: ${d(i.ackAt)} · Resolvido: ${d(i.resolvedAt)}`);
    if (i.redacted) { lines.push('- Detalhes omitidos: envolve área restrita.', ''); continue; }
    lines.push(`- Dispositivos: ${i.deviceIds.join(', ')}`);
    const dx = i.diagnosis;
    if (dx) {
      lines.push('', '**Fatos coletados**', ...dx.facts.map((f) => `- ${f}`), '', `**Hipótese técnica:** ${dx.hypothesis}`, '', `**Confiança:** ${dx.confidence}`, ...(dx.confidenceCriteria || []).map((c) => `- ${c}`));
      if (dx.recommendations?.length) lines.push('', '**Recomendações**', ...dx.recommendations.map((r) => `- ${r}`));
      if (dx.uncertainties?.length) lines.push('', '**Incertezas**', ...dx.uncertainties.map((r) => `- ${r}`));
    }
    if (i.resolutionNote) lines.push('', `**Resolução:** ${i.resolutionNote}`);
    lines.push('');
  }
  return lines.join('\n');
}
