/**
 * ELION-X · SIMULADOR MATEMÁTICO DE LOTERIAS
 *
 * ═══ A VERDADE MATEMÁTICA QUE ESTE MÓDULO NÃO ESCONDE ═══
 *
 * Sorteios de loteria são eventos INDEPENDENTES e EQUIPROVÁVEIS. Cada bola
 * tem exatamente a mesma chance em todo sorteio, sempre. Nenhuma análise do
 * passado — frequência, atraso, Fibonacci, numerologia, ciclos — altera em
 * NADA a probabilidade do próximo resultado. Acreditar que altera é a
 * "falácia do apostador", e é matematicamente falso, não questão de opinião.
 *
 * Então por que este módulo existe e o que ele entrega de real?
 *
 *   1) DESCRIÇÃO FACTUAL do histórico. Frequência, atraso, soma, paridade e
 *      distribuição são fatos sobre o passado. Interessantes, verificáveis —
 *      e explicitamente rotulados como passado, nunca como previsão.
 *
 *   2) PROBABILIDADE EXATA. Combinatória real: chance por faixa, custo,
 *      valor esperado. O jogador vê o número verdadeiro, não a ilusão.
 *
 *   3) O ÚNICO GANHO DEMONSTRÁVEL: evitar RATEIO. A chance de ganhar é fixa,
 *      mas o valor que se recebe NÃO é — prêmio é dividido entre acertadores.
 *      Milhões de pessoas jogam datas de nascimento (1-31), sequências e
 *      padrões de cartela. Uma combinação que foge desses padrões tem a MESMA
 *      chance de sair e uma chance MENOR de ser dividida. Isso é estatística
 *      de comportamento humano, não previsão de sorteio — e é real.
 *
 * As estratégias "quentes", "frios", "fibonacci" e "numerologia" existem aqui
 * porque o operador as pediu, e são geradas com rigor. Mas o relatório sempre
 * declara: elas NÃO aumentam a chance de acerto. Quem promete o contrário
 * está vendendo ilusão.
 */

const UA = 'ELION-X/3.1 (assistente pessoal)';
const t = ms => AbortSignal.timeout(ms);

/* ── REGRAS OFICIAIS DOS JOGOS ────────────────────────────────────────────
   universo = de quantos números se escolhe · escolhe = quantos saem no sorteio
   min/max  = limites da aposta · preco = valor da aposta mínima (R$)         */
export const REGRAS = {
  megasena: {
    nome: 'Mega-Sena', universo: 60, escolhe: 6, min: 6, max: 20, preco: 5.00,
    premia: [6, 5, 4], sorteios: 'quarta e sábado',
  },
  quina: {
    nome: 'Quina', universo: 80, escolhe: 5, min: 5, max: 15, preco: 2.50,
    premia: [5, 4, 3, 2], sorteios: 'segunda a sábado',
  },
  lotofacil: {
    nome: 'Lotofácil', universo: 25, escolhe: 15, min: 15, max: 20, preco: 3.00,
    premia: [15, 14, 13, 12, 11], sorteios: 'segunda a sábado',
  },
  lotomania: {
    nome: 'Lotomania', universo: 100, escolhe: 20, min: 50, max: 50, preco: 3.00,
    premia: [20, 19, 18, 17, 16, 15, 0], sorteios: 'terça e sexta',
    nota: 'aposta-se 50 números; 20 são sorteados. Zero acertos também premia.',
  },
  duplasena: {
    nome: 'Dupla Sena', universo: 50, escolhe: 6, min: 6, max: 15, preco: 2.50,
    premia: [6, 5, 4, 3], sorteios: 'terça, quinta e sábado',
    nota: 'dois sorteios por concurso — duas chances no mesmo bilhete.',
  },
  diadesorte: {
    nome: 'Dia de Sorte', universo: 31, escolhe: 7, min: 7, max: 15, preco: 2.50,
    premia: [7, 6, 5, 4], sorteios: 'terça, quinta e sábado',
    extra: { nome: 'Mês da Sorte', universo: 12, escolhe: 1 },
  },
  timemania: {
    nome: 'Timemania', universo: 80, escolhe: 7, min: 10, max: 10, preco: 3.50,
    premia: [7, 6, 5, 4, 3], sorteios: 'terça, quinta e sábado',
    extra: { nome: 'Time do Coração', universo: 80, escolhe: 1 },
  },
  maismilionaria: {
    nome: '+Milionária', universo: 50, escolhe: 6, min: 6, max: 12, preco: 6.00,
    premia: [6, 5, 4, 3, 2], sorteios: 'quarta e sábado',
    // exigeExtra: os trevos entram na faixa principal — sem eles não há prêmio máximo,
    // então a probabilidade real é C(50,6) × C(6,2). No Dia de Sorte e na Timemania o
    // campo extra premia à parte e NÃO multiplica a chance da faixa principal.
    extra: { nome: 'Trevos', universo: 6, escolhe: 2, exigeExtra: true },
  },
  supersete: {
    nome: 'Super Sete', universo: 10, escolhe: 7, min: 7, max: 21, preco: 2.50,
    premia: [7, 6, 5, 4, 3], sorteios: 'segunda, quarta e sexta',
    colunas: true, nota: 'sete colunas independentes, cada uma de 0 a 9.',
  },
};

/* ── COMBINATÓRIA EXATA (BigInt: os números passam de 10^15) ────────────── */
export function combinacoes(n, k) {
  if (k < 0 || k > n) return 0n;
  k = Math.min(k, n - k);
  let r = 1n;
  for (let i = 0; i < k; i++) r = r * BigInt(n - i) / BigInt(i + 1);
  return r;
}

/** chance real de acertar cada faixa, com o custo da aposta */
export function probabilidade(jogo, dezenasApostadas = null) {
  const R = REGRAS[jogo];
  if (!R) throw new Error(`jogo desconhecido: ${jogo}`);
  const d = dezenasApostadas || R.min;

  if (R.colunas) {  // Super Sete: 10^7 por coluna independente
    const total = 10n ** 7n;
    return { total: total.toString(), faixas: [{ acertos: 7, chance: `1 em ${total}`, uma_em: Number(total) }],
             custo: R.preco, dezenas: d };
  }

  // campo extra obrigatório (trevos da +Milionária) multiplica o espaço amostral
  const fatorExtra = R.extra?.exigeExtra ? combinacoes(R.extra.universo, R.extra.escolhe) : 1n;

  const faixas = R.premia.filter(a => a > 0).map(acertos => {
    // apostando d números, quantas combinações do sorteio dão exatamente `acertos`
    const favoraveis = combinacoes(d, acertos) * combinacoes(R.universo - d, R.escolhe - acertos);
    const total = combinacoes(R.universo, R.escolhe) * fatorExtra;
    const umaEm = favoraveis > 0n ? Number(total / favoraveis) : Infinity;
    return { acertos, uma_em: umaEm, chance: `1 em ${umaEm.toLocaleString('pt-BR')}`,
             ...(R.extra?.exigeExtra ? { nota: `inclui acertar ${R.extra.escolhe} ${R.extra.nome.toLowerCase()}` } : {}) };
  });

  // preço cresce com o número de combinações contidas na aposta
  const custo = R.preco * Number(combinacoes(d, R.min) / combinacoes(R.min, R.min));
  return { faixas, custo: +custo.toFixed(2), dezenas: d,
           total_combinacoes: combinacoes(R.universo, R.escolhe).toString() };
}

/* ── HISTÓRICO OFICIAL ────────────────────────────────────────────────────
   Busca em paralelo com teto de concorrência: a API da Caixa derruba
   requisições em rajada. 6 simultâneas é o equilíbrio medido.              */
async function umConcurso(jogo, n) {
  const alvo = n ? `${jogo}/${n}` : jogo;
  try {
    const j = await fetch(`https://servicebus2.caixa.gov.br/portaldeloterias/api/${alvo}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: t(9000) }).then(r => r.json());
    const dz = (j.listaDezenas || j.dezenasSorteadasOrdemSorteio || []).map(Number);
    if (dz.length) return { concurso: j.numero, data: j.dataApuracao, dezenas: dz.sort((a, b) => a - b),
                            dezenas2: (j.listaDezenasSegundoSorteio || []).map(Number).sort((a, b) => a - b) };
  } catch {}
  try {
    const url = n ? `https://loteriascaixa-api.herokuapp.com/api/${jogo}/${n}`
                  : `https://loteriascaixa-api.herokuapp.com/api/${jogo}/latest`;
    const j = await fetch(url, { headers: { 'User-Agent': UA }, signal: t(9000) }).then(r => r.json());
    if (j?.dezenas?.length) return { concurso: j.concurso, data: j.data,
                                     dezenas: j.dezenas.map(Number).sort((a, b) => a - b), dezenas2: [] };
  } catch {}
  return null;
}

export async function historico(jogo, quantos = 20) {
  if (!REGRAS[jogo]) throw new Error(`jogo desconhecido: ${jogo}`);
  const ultimo = await umConcurso(jogo, null);
  if (!ultimo) throw new Error('não consegui obter o último concurso na Caixa');

  const n = Math.max(1, Math.min(quantos, 200));
  const alvos = [];
  for (let i = 1; i < n; i++) if (ultimo.concurso - i > 0) alvos.push(ultimo.concurso - i);

  const out = [ultimo];
  const LOTE = 6;
  for (let i = 0; i < alvos.length; i += LOTE) {
    const parte = await Promise.all(alvos.slice(i, i + LOTE).map(c => umConcurso(jogo, c)));
    out.push(...parte.filter(Boolean));
  }
  return out.sort((a, b) => b.concurso - a.concurso);
}

/* ── ESTATÍSTICA DESCRITIVA (fatos sobre o PASSADO) ─────────────────────── */
export function estatisticas(jogo, sorteios) {
  const R = REGRAS[jogo];
  const todas = sorteios.flatMap(s => s.dezenas.concat(s.dezenas2 || []));
  const N = sorteios.length;

  const freq = new Map();
  for (let d = 1; d <= R.universo; d++) freq.set(d, 0);
  for (const d of todas) freq.set(d, (freq.get(d) || 0) + 1);

  // atraso: há quantos concursos a dezena não sai
  const atraso = new Map();
  for (let d = 1; d <= R.universo; d++) {
    let a = 0;
    for (const s of sorteios) { if (s.dezenas.includes(d) || (s.dezenas2 || []).includes(d)) break; a++; }
    atraso.set(d, a);
  }

  const ranking = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const somas = sorteios.map(s => s.dezenas.reduce((x, y) => x + y, 0));
  const pares = sorteios.map(s => s.dezenas.filter(d => d % 2 === 0).length);
  const media = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);

  // consecutivos e repetição do sorteio anterior — padrões reais dos resultados
  let consec = 0, repet = 0;
  for (let i = 0; i < sorteios.length; i++) {
    const dz = sorteios[i].dezenas;
    for (let k = 1; k < dz.length; k++) if (dz[k] === dz[k - 1] + 1) { consec++; break; }
    if (i + 1 < sorteios.length) {
      const ant = new Set(sorteios[i + 1].dezenas);
      repet += dz.filter(d => ant.has(d)).length;
    }
  }

  const esperado = (N * R.escolhe) / R.universo;   // frequência esperada se tudo for uniforme
  return {
    concursos: N,
    periodo: { de: sorteios.at(-1)?.concurso, ate: sorteios[0]?.concurso,
               dataDe: sorteios.at(-1)?.data, dataAte: sorteios[0]?.data },
    quentes: ranking.slice(0, 10).map(([d, f]) => ({ dezena: d, saiu: f })),
    frios:   ranking.slice(-10).reverse().map(([d, f]) => ({ dezena: d, saiu: f })),
    atrasadas: [...atraso.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
                 .map(([d, a]) => ({ dezena: d, ha: a })),
    soma:   { media: Math.round(media(somas)), min: Math.min(...somas), max: Math.max(...somas) },
    pares:  { media: +media(pares).toFixed(1), de: R.escolhe },
    consecutivos: { sorteios: consec, pct: Math.round(consec / N * 100) },
    repeticao: { media: +(repet / Math.max(1, N - 1)).toFixed(1) },
    frequenciaEsperada: +esperado.toFixed(1),
    desvioMaximo: +(ranking[0][1] - esperado).toFixed(1),
    freq, atraso,
  };
}

/* ── GERAÇÃO DE COMBINAÇÕES ──────────────────────────────────────────────
   Toda estratégia devolve combinações VÁLIDAS. Nenhuma aumenta a chance de
   acerto — a diferença entre elas é apenas o critério de escolha e, no caso
   de "antipopular", a chance de NÃO dividir o prêmio.                      */
const FIB = new Set([1, 2, 3, 5, 8, 13, 21, 34, 55, 89]);
const primo = n => { if (n < 2) return false; for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
const raizDigital = n => { while (n > 9) n = String(n).split('').reduce((s, c) => s + +c, 0); return n; };

/* O pool contém dezenas REPETIDAS de propósito: repetir é como se dá PESO a
   uma dezena na estratégia (quentes, antipopular…). Repetição é peso, nunca
   permissão de sair duas vezes no mesmo jogo — sem esta checagem, apostas
   grandes (Lotomania marca 50) quase sempre pegavam duplicata e o jogo era
   descartado antes mesmo de chegar aos filtros estatísticos. */
function sorteiaDe(pool, k, rnd) {
  const p = [...pool];
  const out = [], usados = new Set();
  while (out.length < k && p.length) {
    const v = p.splice(Math.floor(rnd() * p.length), 1)[0];
    if (usados.has(v)) continue;
    usados.add(v); out.push(v);
  }
  return out.sort((a, b) => a - b);
}

/** gerador determinístico por semente — o mesmo pedido reproduz o mesmo jogo */
function rng(semente) {
  let s = semente >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296); };
}

export function gerar(jogo, { estrategia = 'equilibrado', quantidade = 5, dezenas = null,
                              stats = null, fixos = [], excluir = [], semente = 42 } = {}) {
  const R = REGRAS[jogo];
  if (!R) throw new Error(`jogo desconhecido: ${jogo}`);
  const k = Math.max(R.min, Math.min(dezenas || R.min, R.max));
  const rnd = rng(semente);

  /* SUPER SETE é estruturalmente outro jogo: não se escolhem dezenas de um
     universo, marcam-se 7 COLUNAS independentes, cada uma de 0 a 9. Nenhum
     conceito de soma, paridade ou consecutivo se aplica. */
  if (R.colunas) {
    const jogosC = [];
    for (let i = 0; i < quantidade; i++) {
      const col = Array.from({ length: 7 }, () => Math.floor(rnd() * 10));
      jogosC.push({ colunas: col, dezenas: col,
                    soma: col.reduce((a, b) => a + b, 0),
                    pares: col.filter(d => d % 2 === 0).length,
                    impares: col.filter(d => d % 2 !== 0).length,
                    consecutivos: 0, primos: col.filter(primo).length, ate31: 7 });
    }
    return { jogo, nome: R.nome, estrategia: 'colunas', dezenasPorJogo: 7, jogos: jogosC,
             extra: null, avisoAntipopular: null,
             notaColunas: 'Cada posição é sorteada de forma independente, de 0 a 9 — 10 milhões de resultados possíveis. Estatística de frequência aqui vale por coluna, não pelo conjunto.' };
  }

  const universo = [];
  for (let d = 1; d <= R.universo; d++) if (!excluir.includes(d)) universo.push(d);

  // peso por estratégia — define de qual conjunto as dezenas saem
  let pool = universo;
  if (stats && estrategia === 'quentes')    pool = stats.quentes.map(x => x.dezena).concat(universo);
  if (stats && estrategia === 'frios')      pool = stats.frios.map(x => x.dezena).concat(universo);
  if (stats && estrategia === 'atrasados')  pool = stats.atrasadas.map(x => x.dezena).concat(universo);
  if (estrategia === 'fibonacci')  pool = universo.filter(d => FIB.has(d)).concat(universo);
  if (estrategia === 'primos')     pool = universo.filter(primo).concat(universo);
  if (estrategia === 'numerologia') {
    // raiz digital: agrupa por soma reduzida — critério simbólico, sem efeito estatístico
    const alvo = raizDigital(semente) || 9;
    pool = universo.filter(d => raizDigital(d) === alvo).concat(universo);
  }
  /* Existe número FORA da faixa de datas de nascimento neste jogo?
     Na Lotofácil (1-25) e no Dia de Sorte (1-31) não existe — todo número é
     "de aniversário". Sem esta checagem o filtro rejeitava 100% dos jogos e o
     gerador devolvia lista vazia. Nesses jogos o antipopular age só pelas
     outras frentes: sem sequências e sem soma extrema. */
  const temFaixaFora = R.universo > 31;
  if (estrategia === 'antipopular' && temFaixaFora) {
    // fora da faixa de datas de nascimento: é onde a multidão NÃO joga
    pool = universo.filter(d => d > 31).concat(universo);
  }

  /* ESCALA DA APOSTA × ESCALA DO SORTEIO.
     A estatística mede o que foi SORTEADO (20 dezenas na Lotomania), mas o
     gerador monta a APOSTA (50 dezenas). Comparar as duas somas diretamente
     rejeitava 100% dos jogos — nenhuma aposta de 50 números soma como um
     sorteio de 20. O alvo é reescalado pela razão entre os dois tamanhos. */
  const escala = k / R.escolhe;
  const alvoSoma  = Math.round((stats?.soma?.media || (R.universo + 1) / 2 * R.escolhe) * escala);
  const alvoPares = Math.round((stats ? stats.pares.media : R.escolhe / 2) * escala);

  /* CONSECUTIVOS ESPERADOS — E = k(k−1)/N.
     Escolher 15 dezenas entre 25 (Lotofácil) FORÇA vizinhos pelo princípio da
     casa dos pombos: o esperado é 8,4 pares. Exigir zero rejeitava 100% dos
     jogos e o gerador devolvia lista vazia. O teto agora acompanha a densidade
     da aposta em vez de ser fixo. */
  const seqEsperado = (k * (k - 1)) / R.universo;
  const tetoSeqEquil = Math.max(1, Math.round(seqEsperado));
  /* Em aposta DENSA (Lotomania marca 50 de 100, Lotofácil 15 de 25) fugir de
     vizinhos é impossível — e inútil, porque a cartela de todo mundo também
     terá. O rigor contra sequência só faz sentido em aposta esparsa. */
  const densidade = k / R.universo;
  const tetoSeqAnti = densidade > 0.3
    ? Math.ceil(seqEsperado)                      // denso: no máximo o esperado — filtro brando
    : Math.max(0, Math.floor(seqEsperado * 0.5)); // esparso: rigor de verdade contra o padrão popular

  const jogos = [];
  const vistos = new Set();
  let tentativas = 0;

  while (jogos.length < quantidade && tentativas++ < quantidade * 4000) {
    const base = fixos.filter(d => d >= 1 && d <= R.universo && !excluir.includes(d));
    if (base.length > k) break;
    const c = [...new Set(base.concat(sorteiaDe(pool.filter(d => !base.includes(d)), k - base.length, rnd)))];
    if (c.length !== k) continue;
    c.sort((a, b) => a - b);

    const chave = c.join('-');
    if (vistos.has(chave)) continue;

    const soma = c.reduce((x, y) => x + y, 0);
    const pares = c.filter(d => d % 2 === 0).length;
    let seq = 0; for (let i = 1; i < c.length; i++) if (c[i] === c[i - 1] + 1) seq++;

    // filtros de plausibilidade: os sorteios reais quase nunca são extremos
    if (estrategia === 'equilibrado') {
      if (Math.abs(soma - alvoSoma) > alvoSoma * 0.18) continue;
      if (Math.abs(pares - alvoPares) > 1) continue;
      if (seq > tetoSeqEquil) continue;
    }
    if (estrategia === 'antipopular') {
      if (temFaixaFora && c.filter(d => d <= 31).length > Math.floor(k / 3)) continue; // pouca data
      if (seq > tetoSeqAnti) continue;                                            // sem sequência
      if (Math.abs(soma - alvoSoma) > alvoSoma * 0.25) continue;
    }

    vistos.add(chave);
    jogos.push({ dezenas: c, soma, pares, impares: k - pares, consecutivos: seq,
                 primos: c.filter(primo).length, ate31: c.filter(d => d <= 31).length });
  }

  return { jogo, nome: R.nome, estrategia, dezenasPorJogo: k, jogos,
           avisoAntipopular: (estrategia === 'antipopular' && !temFaixaFora)
             ? `Neste jogo o universo vai só até ${R.universo} — TODO número cabe numa data de nascimento. A estratégia antipopular aqui atua apenas evitando sequências e somas extremas; o ganho contra rateio é menor do que em jogos de universo maior (Mega-Sena, Quina, Lotomania).`
             : null,
           extra: R.extra ? { campo: R.extra.nome,
             valores: Array.from({ length: quantidade }, () => 1 + Math.floor(rnd() * R.extra.universo)) } : null };
}

/* ── RELATÓRIO PARA O AGENTE NARRAR ─────────────────────────────────────── */
export function relatorio({ jogo, stats, ger, prob }) {
  const R = REGRAS[jogo];
  const L = [];
  L.push(`SIMULADOR MATEMÁTICO · ${R.nome.toUpperCase()}`);
  L.push(`Regra: escolhe-se de 1 a ${R.universo}; ${R.escolhe} são sorteados. Aposta mínima ${R.min} dezenas (R$ ${R.preco.toFixed(2)}). Sorteios: ${R.sorteios}.`);
  if (R.nota) L.push(`Particularidade: ${R.nota}`);

  if (stats) {
    L.push(`\n■ HISTÓRICO ANALISADO — ${stats.concursos} concursos (${stats.periodo.de} a ${stats.periodo.ate})`);
    L.push(`  Mais sorteadas: ${stats.quentes.map(x => `${x.dezena} (${x.saiu}x)`).join(', ')}`);
    L.push(`  Menos sorteadas: ${stats.frios.map(x => `${x.dezena} (${x.saiu}x)`).join(', ')}`);
    L.push(`  Maiores atrasos: ${stats.atrasadas.slice(0, 6).map(x => `${x.dezena} (${x.ha} conc.)`).join(', ')}`);
    L.push(`  Soma das dezenas: média ${stats.soma.media} (variou de ${stats.soma.min} a ${stats.soma.max})`);
    L.push(`  Pares por sorteio: média ${stats.pares.media} de ${stats.pares.de}`);
    L.push(`  Com dezenas consecutivas: ${stats.consecutivos.pct}% dos concursos`);
    L.push(`  Repetiram do concurso anterior: ${stats.repeticao.media} dezenas em média`);
    L.push(`  Frequência esperada por dezena se tudo fosse uniforme: ${stats.frequenciaEsperada}x — a mais sorteada ficou ${stats.desvioMaximo > 0 ? '+' : ''}${stats.desvioMaximo} acima.`);
    L.push(`  LEITURA CORRETA: esse desvio é FLUTUAÇÃO ALEATÓRIA normal em amostra pequena, não tendência. Numa amostra de ${stats.concursos} sorteios, desvios dessa ordem são esperados mesmo com sorteio perfeitamente justo.`);
  }

  if (prob) {
    L.push(`\n■ PROBABILIDADE REAL — apostando ${prob.dezenas} dezenas (R$ ${prob.custo.toFixed(2)})`);
    for (const f of prob.faixas) L.push(`  ${f.acertos} acertos: ${f.chance}`);
    if (prob.total_combinacoes) L.push(`  Total de combinações possíveis: ${BigInt(prob.total_combinacoes).toLocaleString('pt-BR')}`);
  }

  if (ger) {
    L.push(`\n■ COMBINAÇÕES GERADAS — estratégia "${ger.estrategia}" (${ger.jogos.length} jogos de ${ger.dezenasPorJogo} dezenas)`);
    ger.jogos.forEach((j, i) => {
      L.push(`  ${String(i + 1).padStart(2)}. ${j.dezenas.map(d => String(d).padStart(2, '0')).join(' - ')}` +
             `   [soma ${j.soma} · ${j.pares}p/${j.impares}i · ${j.primos} primos · ${j.ate31} até 31]`);
    });
    if (ger.extra) L.push(`  ${ger.extra.campo}: ${ger.extra.valores.join(', ')}`);
    if (ger.avisoAntipopular) L.push(`  ⚠ ${ger.avisoAntipopular}`);
    if (!ger.jogos.length) L.push(`  ⚠ Nenhuma combinação passou nos filtros desta estratégia — afrouxe os critérios ou troque de estratégia.`);
  }

  L.push(`\n■ DECLARAÇÃO OBRIGATÓRIA — diga isto ao operador, sem suavizar:`);
  L.push(`  Sorteios são independentes. NENHUMA das análises acima aumenta a chance de acerto —`);
  L.push(`  a probabilidade continua exatamente a mesma para qualquer combinação válida.`);
  L.push(`  O que a estatística oferece de REAL é outra coisa: a estratégia "antipopular" evita`);
  L.push(`  datas de nascimento (1-31), sequências e padrões de cartela, que milhões de pessoas`);
  L.push(`  jogam. Isso NÃO aumenta a chance de ganhar — mas reduz a chance de DIVIDIR o prêmio`);
  L.push(`  se ganhar. É o único ganho matematicamente demonstrável, e vem do comportamento`);
  L.push(`  humano dos outros apostadores, não do sorteio.`);
  L.push(`  Aposte apenas o que puder perder. Jogo é entretenimento, nunca investimento.`);
  return L.join('\n');
}
