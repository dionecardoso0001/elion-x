// Correlação de falhas sobre o grafo de dependências.
// Produz GRUPOS de sinais: cada grupo vira no máximo um incidente (supressão de duplicatas).
// Confiança é QUALITATIVA e derivada de critérios explícitos — nunca um percentual arbitrário.

import { DATA_PATH_EDGES } from '../domain/catalog.mjs';

const ABNORMAL = new Set(['critical', 'degraded', 'offline', 'unknown']);

export function correlate({ devices, deps, states }) {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const children = new Map(devices.map((d) => [d.id, []]));
  const parents = new Map(devices.map((d) => [d.id, []]));
  for (const e of deps) { children.get(e.from)?.push(e); parents.get(e.to)?.push(e); }

  const st = (id) => states.get(id)?.status;
  const abnormal = devices.filter((d) => ABNORMAL.has(st(d.id))).map((d) => d.id);
  const claimed = new Set();
  const groups = [];
  const hasReason = (id, prefix) => states.get(id)?.reasons?.some((r) => r.code.startsWith(prefix));

  // 1) Incêndio — sinais da central e dos detectores formam um único evento.
  const fireSignals = abnormal.filter((id) => ['smoke', 'mcp', 'facp'].includes(byId.get(id).type) && hasReason(id, 'state:crit'));
  if (fireSignals.length) {
    const detectors = fireSignals.filter((id) => byId.get(id).type !== 'facp');
    const panel = fireSignals.find((id) => byId.get(id).type === 'facp');
    const root = detectors[0] || panel;
    fireSignals.forEach((id) => claimed.add(id));
    groups.push({
      key: 'fire:' + (panel || root), kind: 'fire', root, members: fireSignals, relation: 'conhecida',
      confidence: 'requer confirmação humana',
      criteria: [
        panel ? `Central ${panel} reporta estado de alarme` : 'Central de incêndio não confirmou o alarme',
        detectors.length ? `Dispositivo(s) em alarme: ${detectors.join(', ')}` : 'Nenhum detector individual identificado',
        'O sinal é um fato registrado; a existência de fogo só é confirmada por verificação humana/visual',
      ],
    });
  }

  // 2) Energia — tensão de entrada fora da faixa no medidor do QDG.
  for (const meterId of abnormal.filter((id) => byId.get(id).type === 'meter' && hasReason(id, 'voltageV:crit'))) {
    const fed = descendants(meterId, children, (e) => e.type === 'power');
    const upsOnBattery = fed.filter((id) => byId.get(id).type === 'ups' && hasReason(id, 'onBattery'));
    const affected = fed.filter((id) => ABNORMAL.has(st(id)) && !claimed.has(id));
    const impacted = upsOnBattery.flatMap((u) => descendants(u, children, (e) => e.type === 'power'));
    [meterId, ...affected].forEach((id) => claimed.add(id));
    groups.push({
      key: 'power:' + meterId, kind: 'power', root: meterId, members: [meterId, ...affected], impacted: [...new Set(impacted)],
      relation: 'conhecida',
      confidence: upsOnBattery.length ? 'alta' : 'média',
      criteria: [
        `${meterId} reporta tensão de entrada abaixo do limite`,
        upsOnBattery.length ? `Fonte independente confirma: ${upsOnBattery.join(', ')} em bateria` : 'Nenhum nobreak confirmou transferência para bateria',
        'Dependências elétricas cadastradas (conhecidas) no grafo',
      ],
    });
  }

  // 3) Cascata — dispositivo observável mais alto na cadeia com dependentes sem dados.
  //    Processa raízes cujo próprio estado foi OBSERVADO (offline/critical), nunca "unknown".
  const roots = abnormal.filter((id) => !claimed.has(id) && ['offline', 'critical'].includes(st(id)));
  for (const root of roots) {
    const dependents = descendants(root, children, (e) => DATA_PATH_EDGES.has(e.type))
      .filter((id) => st(id) === 'unknown' && !claimed.has(id));
    if (!dependents.length) continue;
    const directKnown = children.get(root).filter((e) => DATA_PATH_EDGES.has(e.type) && e.type !== 'managed-by');
    const directAffected = directKnown.filter((e) => st(e.to) === 'unknown' || st(e.to) === 'offline');
    const all = directKnown.length > 0 && directAffected.length === directKnown.length;
    // corroboração: equipamento a montante reporta porta inativa
    const upstreamWitness = parents.get(root).map((e) => e.from).filter((p) => hasReason(p, 'portsDownUnexpected'));
    [root, ...dependents, ...upstreamWitness].forEach((id) => claimed.add(id));
    groups.push({
      key: 'cascade:' + root, kind: 'cascade', root, members: [root, ...dependents], witnesses: upstreamWitness, relation: 'conhecida',
      confidence: all && upstreamWitness.length ? 'alta' : all ? 'média' : 'baixa',
      criteria: [
        `${root} sem comunicação (estado observado: ${st(root)})`,
        `${directAffected.length} de ${directKnown.length} dependentes diretos cadastrados perderam telemetria`,
        upstreamWitness.length ? `Corroboração independente: ${upstreamWitness.join(', ')} reporta porta inativa inesperada` : 'Sem corroboração de equipamento a montante',
        'Relação de dependência conhecida (cadastrada)',
      ],
    });
  }

  // 4) Relação INFERIDA — irmãos com falha cujo pai comum não reporta problema.
  const remaining = abnormal.filter((id) => !claimed.has(id));
  const bySharedParent = new Map();
  for (const id of remaining) {
    for (const e of parents.get(id)) {
      if (!['poe', 'network', 'data-path', 'supervision'].includes(e.type)) continue;
      if (!bySharedParent.has(e.from)) bySharedParent.set(e.from, []);
      bySharedParent.get(e.from).push(id);
    }
  }
  for (const [parent, sibs] of bySharedParent) {
    const free = sibs.filter((id) => !claimed.has(id));
    if (free.length < 2 || ABNORMAL.has(st(parent))) continue;
    free.forEach((id) => claimed.add(id));
    groups.push({
      key: 'inferred:' + parent, kind: 'inferred', root: parent, members: free, relation: 'inferida',
      confidence: 'baixa',
      criteria: [
        `${free.length} dispositivos que compartilham ${parent} apresentam falha simultânea`,
        `${parent} NÃO reporta falha — a relação causal é uma inferência, não um fato`,
      ],
    });
  }

  // 5) Sinais isolados.
  for (const id of abnormal.filter((x) => !claimed.has(x))) {
    claimed.add(id);
    const s = states.get(id);
    const upstreamOk = parents.get(id).filter((e) => DATA_PATH_EDGES.has(e.type)).every((e) => st(e.from) === 'ok');
    let confidence = 'baixa';
    const criteria = [];
    if (s.status === 'critical' && s.reasons.some((r) => !r.statistical)) {
      confidence = upstreamOk ? 'média' : 'baixa';
      criteria.push('Evidência direta reportada pelo próprio dispositivo');
      criteria.push(upstreamOk ? 'Caminho a montante operante (falha tende a ser local)' : 'Há componentes a montante fora do normal');
    } else if (s.status === 'offline') {
      criteria.push('Dispositivo sem comunicação com caminho a montante operante');
      criteria.push('Causas possíveis múltiplas (alimentação, cabo, porta, firmware) — evidência insuficiente para distinguir');
    } else {
      criteria.push(s.reasons.some((r) => r.statistical) ? 'Desvio estatístico em relação à linha de base' : 'Limiar de alerta ultrapassado');
    }
    groups.push({ key: 'single:' + id, kind: 'single', root: id, members: [id], relation: 'conhecida', confidence, criteria });
  }

  return groups;
}

function descendants(id, children, edgeFilter) {
  const out = [];
  const seen = new Set([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of children.get(cur) || []) {
      if (!edgeFilter(e) || seen.has(e.to)) continue;
      seen.add(e.to); out.push(e.to); stack.push(e.to);
    }
  }
  return out;
}
