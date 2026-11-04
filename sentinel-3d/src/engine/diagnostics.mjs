// NÍVEL 3 — Explicação estruturada (SENTINEL AI).
// Neste MVP a explicação é gerada por um motor DETERMINÍSTICO de templates sobre evidências
// coletadas: separa fatos, hipótese, critérios de confiança, recomendações e incertezas.
// Um LLM pode futuramente reescrever o texto, mas nunca acrescentar fatos (ver docs/ARQUITETURA.md §8).

import { TYPES, EDGE_LABELS } from '../domain/catalog.mjs';

export const ENGINE_ID = 'sentinel-ai/deterministico-v1';

export function diagnose(group, ctx) {
  const { byId, states, latest, now, roomsById } = ctx;
  const root = byId.get(group.root);
  const rootState = states.get(group.root);
  const name = (id) => `${id} (${byId.get(id)?.name ?? '—'})`;
  const age = (id) => {
    const s = states.get(id);
    return s?.lastSeen ? `${Math.round((now - s.lastSeen) / 1000)} s` : 'nunca';
  };
  const reasonsOf = (id) => (states.get(id)?.reasons || []).map((r) => `${id}: ${r.text}`);
  const room = roomsById.get(root?.room)?.name ?? root?.room;

  const base = {
    engine: ENGINE_ID, generatedAt: now, relation: group.relation,
    confidence: group.confidence, confidenceCriteria: group.criteria,
    devices: group.members, rootDeviceId: group.root,
  };

  switch (group.kind) {
    case 'fire': {
      // região = onde estão os DETECTORES em alarme; a sala da central não é a zona do evento
      const detectors = group.members.filter((id) => byId.get(id).type !== 'facp');
      const zoneRooms = [...new Set((detectors.length ? detectors : group.members).map((id) => roomsById.get(byId.get(id).room)?.name))];
      const cams = ctx.devices.filter((d) => d.type === 'camera' && detectors.some((m) => byId.get(m).room === d.room)).map((d) => d.id);
      return {
        ...base, kind: 'fire', severity: 'critical', priority: 'P1',
        title: `Sinal de alarme de incêndio — ${zoneRooms.join(', ')}`,
        facts: [
          ...group.members.flatMap(reasonsOf),
          `Região: ${zoneRooms.join(', ')}`,
          'Nenhum comando de atuação física foi ou será executado por esta plataforma',
        ],
        hypothesis: 'Possível princípio de incêndio ou acionamento indevido na região indicada. A plataforma NÃO confirma a existência de fogo.',
        recommendations: [
          `Verificação visual imediata pelas câmeras autorizadas da região${cams.length ? ': ' + cams.join(', ') : ' (nenhuma câmera cadastrada na zona)'}`,
          'Seguir o Plano de Emergência (PAE) da agência — o sistema certificado de incêndio continua sendo a autoridade',
        ],
        uncertainties: ['Detectores de fumaça podem disparar por poeira, vapor ou manutenção', 'A confirmação depende de verificação humana'],
        protocol: {
          note: 'MODELO DEMONSTRATIVO — substituir pelo Plano de Emergência aprovado da agência',
          steps: [
            'Confirmar o sinal na central de incêndio local e com a central de monitoramento',
            'Verificação visual pelo CFTV autorizado e/ou brigadista presente',
            'Acionar a brigada e o responsável da agência conforme o plano',
            'Se confirmado: acionar o Corpo de Bombeiros (193) e conduzir abandono conforme o plano',
            'Registrar a ocorrência, horários e evidências nesta plataforma',
          ],
        },
      };
    }
    case 'power': {
      const ups = group.members.filter((id) => byId.get(id).type === 'ups');
      const upsFacts = ups.map((id) => {
        const v = latest.get(id)?.values || {};
        return `${id}: em bateria = ${v.onBattery ? 'sim' : 'não'}, carga ${Math.round(v.batteryPct ?? 0)}%, autonomia estimada ${Math.round(v.runtimeMin ?? 0)} min`;
      });
      const minRuntime = Math.min(...ups.map((id) => latest.get(id)?.values?.runtimeMin ?? Infinity));
      return {
        ...base, kind: 'power', severity: 'critical', priority: 'P1',
        title: `Falha de alimentação elétrica na entrada (${group.root})`,
        facts: [
          ...reasonsOf(group.root),
          ...upsFacts,
          `Equipamentos sem alimentação ou alterados: ${group.members.filter((m) => m !== group.root).join(', ') || 'nenhum'}`,
          group.impacted?.length ? `Operando sob autonomia de nobreak: ${group.impacted.join(', ')}` : 'Nenhum equipamento identificado sob autonomia de nobreak',
        ],
        hypothesis: 'Interrupção do fornecimento ou falha no quadro geral (QDG). Origem externa ou interna ainda não determinada.',
        recommendations: [
          'Confirmar com a concessionária e com a manutenção predial a origem da falta de energia',
          Number.isFinite(minRuntime) ? `Planejar desligamento ordenado de cargas não essenciais antes do fim da autonomia (~${Math.round(minRuntime)} min, estimativa do próprio UPS)` : 'Verificar autonomia dos nobreaks',
          'Verificar gerador/energia de emergência, se existente',
        ],
        uncertainties: ['A autonomia é estimada pelo UPS e varia com a carga', 'Não há medição por circuito para isolar a origem dentro do quadro'],
      };
    }
    case 'cascade': {
      const deps = group.members.filter((m) => m !== group.root);
      const edgeTypes = [...new Set(ctx.deps.filter((e) => e.from === group.root && deps.includes(e.to)).map((e) => EDGE_LABELS[e.type]))];
      const isGateway = root.type === 'gateway';
      return {
        ...base, kind: 'cascade',
        severity: deps.length >= 5 || ['router', 'firewall'].includes(root.type) ? 'critical' : 'high',
        priority: deps.length >= 5 ? 'P1' : 'P2',
        title: `Perda de comunicação em ${group.root} com ${deps.length} dependente(s) afetado(s)`,
        facts: [
          `${name(group.root)} — última comunicação há ${age(group.root)}`,
          ...deps.map((d) => `${name(d)} — sem telemetria há ${age(d)}`),
          ...(group.witnesses || []).flatMap(reasonsOf),
          `Relação: ${edgeTypes.join(', ') || 'dependência cadastrada'}`,
        ],
        hypothesis: isGateway
          ? `Indisponibilidade do gateway ${group.root}. Os sensores podem estar íntegros: apenas o caminho de telemetria foi interrompido.`
          : `Possível indisponibilidade do ${TYPES[root.type].label.toLowerCase()} ${group.root} (componente compartilhado), afetando os dependentes.`,
        recommendations: isGateway
          ? [`Verificar alimentação, rede e serviço do ${group.root}`, 'Não abrir chamados individuais para os sensores antes de restabelecer o gateway', 'Últimas leituras preservadas com indicação de idade']
          : [`Verificar disponibilidade e alimentação do ${group.root} antes de manutenção individual nos dependentes`, 'Checar a porta correspondente no equipamento a montante', 'Após restabelecer, confirmar retorno da telemetria de cada dependente'],
        uncertainties: [
          'O estado físico dos dependentes é indeterminado enquanto não houver telemetria',
          'Falha de alimentação, cabo, porta ou firmware ainda não distinguidas',
        ],
      };
    }
    case 'failover': {
      const backups = group.witnesses || [];
      const bw = backups.map((id) => { const v = latest.get(id)?.values || {}; return `${name(id)}: ${v.bandwidthMbps ?? '—'} Mbps, latência ${v.latencyMs ?? '—'} ms`; });
      return {
        ...base, kind: 'failover', severity: backups.length ? 'high' : 'critical', priority: backups.length ? 'P2' : 'P1',
        title: backups.length ? `Queda do link principal ${group.root} — tráfego em failover para ${backups.join(', ')}` : `Queda de link ${group.root} sem caminho redundante`,
        facts: [`${name(group.root)} — última comunicação há ${age(group.root)}`, ...bw, ...group.members.filter((m) => m !== group.root).flatMap(reasonsOf)],
        hypothesis: `Indisponibilidade do link ou do equipamento ${group.root} (operadora, cabo ou alimentação). A redundância está ${backups.length ? 'mantendo' : 'NÃO está mantendo'} a conectividade.`,
        recommendations: [
          `Abrir chamado com a operadora do link de ${group.root} e verificar alimentação/cabeamento local`,
          'Acompanhar latência e consumo do link secundário (4G pode ter franquia e desempenho inferior)',
          'Após o retorno, confirmar o retorno do tráfego ao link principal',
        ],
        uncertainties: ['A falha pode ser na operadora ou no equipamento local; a telemetria disponível não distingue'],
      };
    }
    case 'thermal': {
      const heating = group.members.filter((m) => m !== group.root);
      const temps = heating.map((id) => { const v = latest.get(id)?.values?.tempC; return `${name(id)}: ${v ?? '—'} °C`; });
      const supply = latest.get(group.root)?.values?.supplyTempC;
      return {
        ...base, kind: 'thermal',
        severity: group.members.some((id) => states.get(id)?.status === 'critical') ? 'high' : 'medium',
        priority: group.members.some((id) => states.get(id)?.status === 'critical') ? 'P2' : 'P3',
        title: `Degradação térmica — ${group.root} (${room}) com ${heating.length} equipamento(s) aquecendo`,
        facts: [
          ...reasonsOf(group.root),
          supply != null ? `Temperatura de insuflamento atual: ${supply} °C` : 'Temperatura de insuflamento indisponível',
          ...temps,
          ...heating.flatMap(reasonsOf),
        ],
        hypothesis: `Perda de rendimento da climatização ${group.root} (filtro obstruído, falta de gás ou falha do compressor) elevando a temperatura da zona de racks.`,
        recommendations: [
          `Acionar manutenção de climatização para inspecionar ${group.root}`,
          'Acompanhar a tendência de temperatura dos servidores; se atingir o limite crítico, planejar desligamento ordenado de cargas não essenciais',
          'Verificar ventilação provisória da sala de racks',
        ],
        uncertainties: ['A causa mecânica exata não é observável pela telemetria disponível', 'Carga computacional atípica também eleva a temperatura dos servidores'],
      };
    }
    case 'inferred':
      return {
        ...base, kind: 'inferred', severity: 'medium', priority: 'P3',
        title: `Falhas simultâneas em dispositivos que compartilham ${group.root}`,
        facts: group.members.flatMap(reasonsOf),
        hypothesis: `Relação INFERIDA: um problema em ${group.root} ou no caminho comum pode explicar as falhas, mas ${group.root} não reporta falha.`,
        recommendations: [`Inspecionar ${group.root} e o cabeamento comum`, 'Validar se a coincidência temporal é causal antes de agir'],
        uncertainties: ['Correlação temporal não implica causalidade'],
      };
    default: { // single
      const s = rootState;
      const isVideo = s.reasons.some((r) => r.code === 'videoOk:crit');
      const statistical = s.reasons.length && s.reasons.every((r) => r.statistical);
      const portDown = s.reasons.length && s.reasons.every((r) => r.code === 'portsDownUnexpected:warn');
      const severity = s.status === 'critical' ? 'high' : s.status === 'offline' ? 'high' : 'medium';
      return {
        ...base, kind: isVideo ? 'video-loss' : statistical ? 'anomaly' : portDown ? 'port-down' : s.status, severity, priority: severity === 'high' ? 'P2' : 'P3',
        title: isVideo ? `Perda de vídeo — ${group.root} (${room})`
          : s.status === 'offline' ? `Sem comunicação — ${name(group.root)}`
          : s.status === 'unknown' ? `Telemetria não confiável — ${name(group.root)}`
          : statistical ? `Anomalia estatística — ${name(group.root)}`
          : `${s.status === 'critical' ? 'Falha' : 'Instabilidade'} — ${name(group.root)}`,
        facts: [
          ...reasonsOf(group.root),
          s.lastSeen ? `Última telemetria há ${age(group.root)}` : 'Sem telemetria registrada',
          ...(isVideo ? [`O dispositivo responde à rede (telemetria recente), portanto não é classificado como operacional`] : []),
        ],
        hypothesis: isVideo ? 'Falha local de stream/encoder, óptica obstruída ou configuração da câmera. Caminho de rede e VMS operantes.'
          : s.status === 'offline' ? 'Perda de alimentação, cabo, porta ou travamento do próprio dispositivo — evidência insuficiente para distinguir.'
          : statistical ? 'Comportamento fora da linha de base histórica; pode ser legítimo (ex.: carga atípica) ou início de falha.'
          : 'Condição reportada pelo próprio dispositivo ultrapassou o limiar configurado.',
        recommendations: isVideo ? [`Verificar stream de ${group.root} no VMS e reiniciar o perfil de vídeo`, 'Inspeção visual da lente/posição', 'Se persistir, manutenção individual da câmera']
          : s.status === 'offline' ? ['Verificar a porta do switch/alimentação do dispositivo', 'Confirmar se houve intervenção recente no local']
          : ['Acompanhar a evolução da métrica', 'Comparar com dispositivos semelhantes'],
        uncertainties: statistical ? ['Linha de base construída com histórico curto/sintético'] : ['Diagnóstico baseado apenas nos sinais disponíveis'],
      };
    }
  }
}
