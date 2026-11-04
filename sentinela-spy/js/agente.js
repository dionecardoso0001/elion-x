/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA SPY — narrador local (ESM puro)

   Camada SEMPRE ligada, offline e determinística: traduz condições, eventos
   e métricas em narrativa operacional com o protocolo recomendado. É ela
   que acompanha o alarme, em milissegundos e sem rede.

   A interpretação por IA (agente Sentinela Spy, js/spy/) roda POR CIMA,
   leva segundos e nunca está no caminho do alarme: um modelo de linguagem
   decidindo se a sirene toca seria lento demais para quem cochila ao volante.
   ═══════════════════════════════════════════════════════════════════════ */
import { rotulo } from './config.js';

const PROTOCOLO = [
  [/^intrusao/, 'verificação presencial da zona; registrar horário e trajeto do alvo'],
  [/^permanencia/, 'observar intenção; abordagem preventiva se persistir'],
  [/^abandono/, 'não manusear o objeto; isolar o entorno e acionar a segurança'],
  [/^(retirada|sumiu)/, 'conferir as imagens e confirmar a posse do objeto'],
  [/^queda/, 'verificar o estado da pessoa; sem resposta, acionar o SAMU (192)'],
  [/^maos/, 'confirmar visualmente: rendição, pedido de ajuda ou gesto comum'],
  [/^risco/, 'confirmação visual antes de qualquer ação — detector genérico erra'],
  [/^corrida/, 'identificar origem e destino do deslocamento'],
  [/^aglomeracao/, 'monitorar densidade e rotas de saída'],
  [/^(microssono|fadiga|pendendo|bocejos)/, 'parar em local seguro e descansar antes de seguir'],
  [/^(mal_subito|ausente)/, 'parar o veículo; havendo mal-estar, acionar o SAMU (192)'],
  [/^instabilidade/, 'reduzir a velocidade; se houver tontura, parar em local seguro'],
  [/^(distracao|celular)/, 'olhos na via; celular só com o veículo parado'],
  [/^(colisao|aproximacao|distancia)/, 'aliviar o acelerador e ampliar a distância'],
  [/^(pedestre|travessia|animal|obstaculo)/, 'reduzir a velocidade e preparar a frenagem'],
  [/^anomalia/, 'revisar o alvo: padrão incomum para esta cena'],
];

export function protocoloPara(chave = '') {
  for (const [re, txt] of PROTOCOLO) if (re.test(chave)) return txt;
  return null;
}

const hhmmss = d => d.toTimeString().slice(0, 8);
const pct = v => `${(v * 100).toFixed(1).replace('.', ',')}%`;
const NIVEL_TXT = { critico: '▲ CRÍTICO', aviso: '◆ AVISO', info: '· INFO' };

/** Linha narrativa para uma condição nova/escalada ou um evento. */
export function narrar(e, agora = new Date()) {
  const prot = e.nivel !== 'info' ? protocoloPara(e.chave) : null;
  return {
    hora: hhmmss(agora),
    nivel: e.nivel,
    texto: `${NIVEL_TXT[e.nivel] || ''} ${e.titulo}${e.detalhe ? ' — ' + e.detalhe : ''}`.trim(),
    protocolo: prot ? `PROTOCOLO: ${prot}` : null,
  };
}

/** Relatório de situação compacto, por modo. */
export function relatorioSituacao(modo, m, defcon) {
  if (!m) return null;
  const ameaca = `AMEAÇA ${defcon}/5`;
  if (modo === 'motorista') {
    if (m.calibrando) return `CALIBRANDO CONDUTOR — olhe para a via em postura normal (${Math.round((m.progressoCalibracao || 0) * 100)}%).`;
    if (!m.presente) return `CONDUTOR FORA DE VISÃO há ${(m.ausenteS || 0).toFixed(0)} s · ${ameaca}.`;
    return `CONDUTOR: ${m.fechado ? 'olhos FECHADOS' : 'olhos abertos'} · PERCLOS ${pct(m.perclos || 0)} · `
      + `${m.piscadasMin ?? 0} piscadas/min · ${m.bocejos5min ?? 0} bocejo(s) em 5 min · `
      + `cabeça ${Math.abs(m.yaw || 0) < 15 && Math.abs(m.pitch || 0) < 12 ? 'estável' : 'desviada'} · `
      + `índice de fadiga ${m.indiceFadiga ?? 0}/100 · ${ameaca}.`;
  }
  if (modo === 'transito') {
    const c = m.contagem || {};
    const l = m.lider;
    const lider = l ? `líder ${rotulo(l.classe)} TGT-${l.id}${l.z != null ? ` a ~${l.z.toFixed(0)} m` : ''}, TTC ${isFinite(l.ttc) ? l.ttc.toFixed(1) + ' s' : '∞'}` : 'corredor livre';
    const vel = m.velocidade != null ? ` · ${(m.velocidade * 3.6).toFixed(0)} km/h` : '';
    return `VIA: ${c.veiculo || 0} veículo(s) · ${c.pedestre || 0} pedestre(s) · ${c.animal || 0} animal(is) · ${lider}${vel} · ${ameaca}.`;
  }
  const n = m.normalidade || {};
  const aq = n.alvo ? Math.min(100, Math.round((100 * n.amostras) / n.alvo)) : 0;
  return `VARREDURA: ${m.pessoas || 0} pessoa(s) · ${m.objetos || 0} objeto(s) sob vigilância`
    + `${m.semDono ? ` (${m.semDono} sem dono)` : ''}${m.abandonados ? ` · ${m.abandonados} ABANDONADO(S)` : ''}`
    + ` · modelo de normalidade ${n.aquecido ? 'ativo' : `aprendendo ${aq}%`} · ${ameaca}.`;
}

/** Telemetria compacta: o que o agente Sentinela Spy recebe junto com o quadro. */
export function montarTelemetria({ modo, defcon, ativas = [], historico = [], trilhas = [], metricas = {}, zonas = [] }) {
  const r2 = v => Math.round(v * 100) / 100;
  return {
    modo,
    horario: new Date().toISOString(),
    nivel_ameaca_local: defcon,
    alertas_ativos: ativas.slice(0, 8).map(a => ({ titulo: a.titulo, nivel: a.nivel, detalhe: a.detalhe })),
    eventos_recentes: historico.slice(-10).map(e => ({ titulo: e.titulo, nivel: e.nivel, ha_s: Math.round((performance.now() - e.t) / 1000) })),
    alvos: trilhas.slice(0, 25).map(tr => ({
      id: tr.id, classe: tr.classe, rotulo: rotulo(tr.classe), confianca: r2(tr.score),
      caixa_xywh: [r2(tr.x), r2(tr.y), r2(tr.w), r2(tr.h)], estatico: !!tr.estatico,
    })),
    zonas: zonas.map(z => ({ nome: z.nome, tipo: z.tipo })),
    metricas: resumoMetricas(modo, metricas),
  };
}

function resumoMetricas(modo, m = {}) {
  const r = v => (typeof v === 'number' && isFinite(v) ? Math.round(v * 1000) / 1000 : v ?? null);
  if (modo === 'motorista') {
    return { presente: m.presente, perclos: r(m.perclos), fechamento_olho: r(m.fechamento), piscadas_min: m.piscadasMin,
      bocejos_5min: m.bocejos5min, guinada_graus: r(m.yaw), arfagem_graus: r(m.pitch), rolagem_graus: r(m.roll),
      indice_fadiga: m.indiceFadiga, celular: m.celular, em_movimento: m.emMovimento };
  }
  if (modo === 'transito') {
    const l = m.lider;
    return { contagem: m.contagem, velocidade_kmh: m.velocidade != null ? r(m.velocidade * 3.6) : null,
      lider: l ? { classe: l.classe, distancia_m: r(l.z), ttc_s: isFinite(l.ttc) ? r(l.ttc) : null, headway_s: r(l.thw) } : null };
  }
  return { pessoas: m.pessoas, objetos: m.objetos, sem_dono: m.semDono, abandonados: m.abandonados };
}
