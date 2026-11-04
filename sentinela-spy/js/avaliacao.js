/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA — avaliação de sessão de campo (ESM puro; roda em Node e no navegador)

   Entrada: o JSONL do gravador de campo. Saída: os números que decidem se
   um limiar está bom — e nada que pareça mais certo do que é.

   · ALARMES/HORA por tipo e por nível. Alarme crítico demais gera "fadiga
     de alarme": o motorista aprende a ignorar a sirene.
   · PRECISÃO = VP / (VP + FP), sobre os alertas que o operador rotulou,
     com intervalo de confiança de WILSON a 95% — com 6 rótulos, "83%" quer
     dizer "entre 44% e 97%", e o relatório diz isso.
   · REVOCAÇÃO ESTIMADA = VP / (VP + FN), com FN = eventos marcados como
     perdidos + "marcas" de teste dirigido sem alerta. É estimativa: só
     conta o que o operador viu acontecer.
   · LATÊNCIA de detecção nos testes dirigidos: o operador aperta MARCA ao
     provocar o comportamento (fechar os olhos, entrar na zona) e mede-se o
     tempo até o alerta.
   · PERCENTIS das métricas (EAR, PERCLOS, TTC…) — a distribuição real que
     orienta onde pôr o limiar.
   ═══════════════════════════════════════════════════════════════════════ */

export const LIMIAR_DO_TIPO = {
  fadiga: 'perclosAviso / perclosCritico', microssono: 'microssonoS', distracao: 'distracaoAvisoS / distracaoYawGraus',
  bocejos: 'bocejoMinS / bocejosAviso', pendendo: 'pendendoPitchGraus', mal_subito: 'malSubitoS', ausente: 'ausenteS',
  celular: 'celularMinS', instabilidade: 'instabilidade* (experimental)',
  colisao: 'ttcCriticoS', aproximacao: 'ttcAvisoS', distancia: 'headwayAvisoS / aproximacaoMs', pedestre: 'pedestreCriticoM',
  travessia: 'lateralPedestre', animal: '—', obstaculo: '—',
  intrusao: 'intrusaoMinS', permanencia: 'permanenciaS', abandono: 'abandonoS / raioDonoM', queda: 'quedaTorsoGraus / quedaMinS',
  corrida: 'corridaAlturasS', maos: 'maosAltoS', aglomeracao: 'aglomeracao', risco: 'riscoHitsMin',
};
const PESO = { info: 1, aviso: 2, critico: 3 };
const tipoBase = chave => String(chave || '').split(':')[0];

/** Intervalo de Wilson (95%) para k sucessos em n — honesto com amostras pequenas. */
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n, z2 = z * z;
  const centro = (p + z2 / (2 * n)) / (1 + z2 / n);
  const margem = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { p, inf: Math.max(0, centro - margem), sup: Math.min(1, centro + margem) };
}

export function percentil(ordenados, q) {
  if (!ordenados.length) return null;
  const i = (ordenados.length - 1) * q, a = Math.floor(i), b = Math.ceil(i);
  return ordenados[a] + (ordenados[b] - ordenados[a]) * (i - a);
}

/** Lê o JSONL (texto ou array de linhas) tolerando linha corrompida. */
export function lerJSONL(texto) {
  const regs = [];
  let corrompidas = 0;
  const linhas = Array.isArray(texto) ? texto : String(texto).split('\n');
  for (const l of linhas) {
    if (!l || !l.trim()) continue;
    try { regs.push(typeof l === 'string' ? JSON.parse(l) : l); } catch { corrompidas++; }
  }
  return { regs, corrompidas };
}

const METRICAS_POR_MODO = {
  motorista: { ear: 'EAR', fe: 'fechamento da pálpebra', pc: 'PERCLOS', ya: 'guinada (°)', pi: 'arfagem (°)', ro: 'rolagem (°)' },
  transito: { lt: 'TTC do líder (s)', lz: 'distância do líder (m)', lh: 'distância temporal (s)', lf: 'fechamento (m/s)' },
  sentinela: { np: 'pessoas', no: 'objetos vigiados' },
};

export function avaliarSessao(entrada, { janelaRotuloS = 30, janelaMarcaS = 10 } = {}) {
  const { regs, corrompidas } = lerJSONL(entrada);
  const cab = regs.find(r => r.tipo === 'cabecalho') || {};
  const modo = cab.modo || 'desconhecido';
  const fim = regs.find(r => r.tipo === 'fim');
  const amostras = regs.filter(r => r.tipo === 'amostra');
  const duracaoMs = fim?.t ?? (amostras.length ? amostras[amostras.length - 1].t : 0);
  const horas = duracaoMs / 3600000;
  // taxa por hora extrapolada de poucos minutos é ruído com cara de número: só a partir de 5 min
  const horasTaxa = duracaoMs >= 5 * 60000 ? horas : 0;

  // ── alertas: início/fim por chave; "início" repetido sem fim = escalada do mesmo alerta ──
  const alertas = [], abertos = new Map();
  for (const r of regs.filter(x => x.tipo === 'condicao')) {
    if (r.fase === 'inicio') {
      const a = abertos.get(r.chave);
      if (a) { if (PESO[r.nivel] > PESO[a.nivel]) a.nivel = r.nivel; continue; }
      const novo = { chave: r.chave, tipo: tipoBase(r.chave), grupo: r.grupo, nivel: r.nivel, titulo: r.titulo, t: r.t, fim: null, rotulo: null };
      alertas.push(novo); abertos.set(r.chave, novo);
    } else if (r.fase === 'fim') {
      const a = abertos.get(r.chave);
      if (a) { a.fim = r.t; abertos.delete(r.chave); }
    }
  }

  // ── anotações ──
  const anot = regs.filter(r => r.tipo === 'anotacao');
  let semVinculo = 0, perdidos = 0;
  const latencias = [], marcasSemAlerta = [];
  for (const n of anot) {
    if (n.rotulo === 'verdadeiro' || n.rotulo === 'falso_alarme') {
      const cand = alertas.filter(a => a.t <= n.t && n.t - a.t <= janelaRotuloS * 1000 && (!n.alvo || a.chave === n.alvo));
      const a = cand[cand.length - 1];
      if (a) a.rotulo = n.rotulo === 'verdadeiro' ? 'vp' : 'fp'; else semVinculo++;
    } else if (n.rotulo === 'perdeu') perdidos++;
    else if (n.rotulo === 'marca') {
      const a = alertas.find(x => x.t > n.t && x.t - n.t <= janelaMarcaS * 1000);
      if (a) { latencias.push((a.t - n.t) / 1000); if (!a.rotulo) a.rotulo = 'vp'; } else marcasSemAlerta.push(n.t);
    }
  }

  // ── por tipo ──
  const porTipo = {};
  for (const a of alertas) {
    const p = porTipo[a.tipo] || (porTipo[a.tipo] = { n: 0, critico: 0, aviso: 0, info: 0, vp: 0, fp: 0, duracoesS: [] });
    p.n++; p[a.nivel] = (p[a.nivel] || 0) + 1;
    if (a.rotulo === 'vp') p.vp++;
    if (a.rotulo === 'fp') p.fp++;
    if (a.fim != null) p.duracoesS.push((a.fim - a.t) / 1000);
  }
  for (const p of Object.values(porTipo)) {
    p.porHora = horasTaxa > 0 ? p.n / horasTaxa : null;
    p.precisao = p.vp + p.fp ? wilson(p.vp, p.vp + p.fp) : null;
    p.duracaoMedianaS = percentil([...p.duracoesS].sort((x, y) => x - y), 0.5);
    delete p.duracoesS;
  }
  const vp = alertas.filter(a => a.rotulo === 'vp').length, fp = alertas.filter(a => a.rotulo === 'fp').length;
  const fn = perdidos + marcasSemAlerta.length;
  const criticos = alertas.filter(a => a.nivel === 'critico').length;

  // ── métricas ──
  const metricas = {};
  for (const [k, rot] of Object.entries(METRICAS_POR_MODO[modo] || {})) {
    const v = amostras.map(s => s.m?.[k]).filter(x => typeof x === 'number' && isFinite(x)).sort((x, y) => x - y);
    if (v.length) metricas[k] = { rotulo: rot, n: v.length, p5: percentil(v, 0.05), p50: percentil(v, 0.5), p95: percentil(v, 0.95) };
  }
  let cobertura = null;
  if (modo === 'motorista') {
    const validas = amostras.filter(s => s.m && s.m.ca === 0);
    cobertura = validas.length ? validas.filter(s => s.m.pr === 1).length / validas.length : null;
  }

  const lat = [...latencias].sort((x, y) => x - y);
  const rel = {
    sessao: { modo, perfil: cab.perfil || 'padrao', demo: !!cab.demo, iniciado_em: cab.iniciado_em || null,
      duracaoMin: duracaoMs / 60000, amostras: amostras.length, corrompidas, truncado: !!fim?.truncado, cobertura },
    alertas: { total: alertas.length, porHora: horasTaxa > 0 ? alertas.length / horasTaxa : null, criticos,
      criticosPorHora: horasTaxa > 0 ? criticos / horasTaxa : null, porTipo },
    rotulos: { vp, fp, fn, perdidos, marcasSemAlerta: marcasSemAlerta.length, semVinculo,
      precisao: vp + fp ? wilson(vp, vp + fp) : null, revocacao: vp + fn ? wilson(vp, vp + fn) : null },
    latencia: lat.length ? { n: lat.length, medianaS: percentil(lat, 0.5), p95S: percentil(lat, 0.95), maxS: lat[lat.length - 1] } : null,
    metricas,
  };
  rel.recomendacoes = recomendar(rel);
  return rel;
}

/** Recomendações a partir de evidência — cada uma diz em que número se apoia. */
export function recomendar(rel) {
  const out = [];
  const { alertas, rotulos, sessao } = rel;
  const rotulados = rotulos.vp + rotulos.fp;
  if (sessao.duracaoMin < 30) out.push(`Sessão curta (${sessao.duracaoMin.toFixed(1)} min): taxas por hora ainda instáveis. Acumule ao menos algumas horas por cenário (dia, noite, chuva) antes de decidir limiares.`);
  if (rotulados < 10) out.push(`Poucos alertas rotulados (${rotulados}): a precisão tem incerteza alta — veja o intervalo de Wilson antes de concluir.`);
  for (const [tipo, p] of Object.entries(alertas.porTipo)) {
    if (p.fp >= 3 && p.precisao && p.precisao.p < 0.6)
      out.push(`Falso alarme frequente em "${tipo}" (${p.fp} FP, precisão ${(p.precisao.p * 100).toFixed(0)}%): teste o perfil CONSERVADOR ou eleve ${LIMIAR_DO_TIPO[tipo] || 'o limiar do tipo'}.`);
  }
  if (rotulos.fn >= 2) out.push(`${rotulos.fn} evento(s) perdido(s): teste o perfil SENSÍVEL e confira o enquadramento da câmera.`);
  if (alertas.criticosPorHora != null && sessao.duracaoMin >= 10 && alertas.criticosPorHora > 6)
    out.push(`${alertas.criticosPorHora.toFixed(1)} alarmes CRÍTICOS por hora: risco de fadiga de alarme (o operador passa a ignorar a sirene).`);
  if (sessao.cobertura != null && sessao.cobertura < 0.85)
    out.push(`Rosto ausente em ${((1 - sessao.cobertura) * 100).toFixed(0)}% do tempo após a calibração: reposicione o celular (frontal, altura dos olhos, sem contraluz).`);
  if (rel.latencia && rel.latencia.p95S > 3) out.push(`Latência p95 de ${rel.latencia.p95S.toFixed(1)} s nos testes dirigidos: verifique quadros/s e delegado (GPU/CPU) do aparelho.`);
  if (sessao.truncado) out.push('A gravação atingiu o teto de linhas e foi truncada: divida sessões longas.');
  if (sessao.demo) out.push('Sessão com PRESET DEMONSTRAÇÃO: tempos encurtados — não use para calibrar operação.');
  if (!out.length) out.push('Nenhum sinal de desajuste nesta sessão. Repita em outros cenários antes de concluir.');
  return out;
}

const pct = w => (w ? `${(w.p * 100).toFixed(0)}% (IC95% ${(w.inf * 100).toFixed(0)}–${(w.sup * 100).toFixed(0)}%)` : '—');
const n1 = v => (v == null ? '—' : v.toFixed(1));

export function formatarRelatorio(rel) {
  const s = rel.sessao, a = rel.alertas, r = rel.rotulos;
  const L = [];
  L.push(`SENTINELA · AVALIAÇÃO DE SESSÃO DE CAMPO`);
  L.push(`modo ${s.modo} · perfil ${s.perfil}${s.demo ? ' · DEMONSTRAÇÃO' : ''} · ${n1(s.duracaoMin)} min · ${s.amostras} amostras${s.corrompidas ? ` · ${s.corrompidas} linha(s) corrompida(s)` : ''}`);
  if (s.cobertura != null) L.push(`rosto presente: ${(s.cobertura * 100).toFixed(1)}% do tempo pós-calibração`);
  L.push('');
  L.push(`ALERTAS: ${a.total} (${a.porHora == null ? 'taxa/h só com sessão ≥ 5 min' : n1(a.porHora) + '/h'}) · críticos ${a.criticos}${a.criticosPorHora == null ? '' : ` (${n1(a.criticosPorHora)}/h)`}`);
  for (const [tipo, p] of Object.entries(a.porTipo).sort((x, y) => y[1].n - x[1].n))
    L.push(`  ${tipo.padEnd(14)} ${String(p.n).padStart(4)}  ${n1(p.porHora).padStart(6)}/h  crít ${p.critico || 0}  VP ${p.vp} FP ${p.fp}  precisão ${pct(p.precisao)}`);
  L.push('');
  L.push(`RÓTULOS: VP ${r.vp} · FP ${r.fp} · FN ${r.fn} (perdidos ${r.perdidos}, marcas sem alerta ${r.marcasSemAlerta})${r.semVinculo ? ` · ${r.semVinculo} sem alerta vinculado` : ''}`);
  L.push(`  precisão  ${pct(r.precisao)}`);
  L.push(`  revocação ${pct(r.revocacao)}  (estimada: só conta o que o operador viu)`);
  if (rel.latencia) L.push(`LATÊNCIA (testes dirigidos, n=${rel.latencia.n}): mediana ${rel.latencia.medianaS.toFixed(2)} s · p95 ${rel.latencia.p95S.toFixed(2)} s`);
  const m = Object.values(rel.metricas);
  if (m.length) {
    L.push('');
    L.push('DISTRIBUIÇÃO DAS MÉTRICAS (p5 · mediana · p95):');
    for (const x of m) L.push(`  ${x.rotulo.padEnd(24)} ${x.p5.toFixed(3)} · ${x.p50.toFixed(3)} · ${x.p95.toFixed(3)}   (n=${x.n})`);
  }
  L.push('');
  L.push('RECOMENDAÇÕES:');
  for (const t of rel.recomendacoes) L.push(`  • ${t}`);
  return L.join('\n');
}
