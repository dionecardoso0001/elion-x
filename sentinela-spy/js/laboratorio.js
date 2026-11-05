/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA SPY — laboratório de modelo (ESM puro, sem DOM)

   O operador ENSINA a plataforma com fotos dele:
     · LOCAL RESTRITO — fotos de um lugar onde ninguém pode estar. Quando a
       câmera vê esse lugar e há uma pessoa na cena → intrusão.
     · CLASSE NOVA — fotos de algo que os modelos de base não conhecem
       (veado, capivara, um equipamento específico). No trânsito, entra na
       varredura do corredor e no refino dos animais.

   Como "aprende" (sem treinar rede no aparelho, de propósito):
   cada foto vira um VETOR DE CARACTERÍSTICAS (embedding MobileNet-V3,
   1.280 números, norma 1). Reconhecer = similaridade de cosseno com os
   exemplos (vizinho mais próximo). Exemplos NEGATIVOS ("parecido, mas
   liberado") afiam a fronteira. Refinar = acrescentar exemplos — inclusive
   o quadro de um falso alarme, com um toque.

   O LIMIAR é calibrado por validação deixando-um-de-fora: cada foto
   positiva é comparada às outras (quão parecidas são as fotos do MESMO
   local) e às negativas (quão parecido é o que NÃO é). Com poucas fotos a
   tela diz que a confiança é baixa — não finge precisão.

   Fotos e vetores ficam SÓ neste aparelho (IndexedDB) — exportação manual
   em JSON para levar a outro aparelho.
   ═══════════════════════════════════════════════════════════════════════ */

export const FORMATO = 'sentinela-spy-laboratorio';
export const VERSAO_FORMATO = 1;
export const TIPOS_CONCEITO = ['local', 'classe'];
export const CFG_LAB = {
  // MEDIDO no MobileNet-V3 Large deste projeto (Chromium, 4 cenas × 7 variações):
  // mesma cena com recorte/brilho/espelho/escala 0,65–0,96 (mediana 0,89; recorte
  // de 15% = 0,73); cenas diferentes ≤ 0,09. Padrão abaixo do mínimo medido da
  // mesma cena; com 3+ fotos a calibração substitui este número.
  limiarPadrao: 0.62,
  limiarMin: 0.3, limiarMax: 0.97, // piso baixo: a calibração com os SEUS exemplos é quem decide
  margemNegativo: 0.02,   // precisa ser mais parecido com o positivo do que com qualquer negativo
  minPositivos: 3,        // abaixo disso a calibração não tem dado
  maxExemplos: 60,        // por conceito: memória e velocidade no celular
};

/** Produto interno = cosseno (vetores já L2-normalizados pelo embedder). */
export function cosseno(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na > 0 && nb > 0 ? s / Math.sqrt(na * nb) : 0;
}

const quantil = (xs, q) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const p = (v.length - 1) * q, i = Math.floor(p), f = p - i;
  return v[i] + (v[Math.min(i + 1, v.length - 1)] - v[i]) * f;
};

/** Novo conceito (local restrito ou classe). */
export function novoConceito({ nome, tipo = 'local', porte = 'grande', id = null }) {
  const n = String(nome || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40).toUpperCase();
  if (!n) throw new Error('dê um nome ao conceito');
  if (!TIPOS_CONCEITO.includes(tipo)) throw new Error('tipo inválido');
  return { id: id || `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, nome: n, tipo,
    porte: porte === 'pequeno' ? 'pequeno' : 'grande', exemplos: [], limiar: CFG_LAB.limiarPadrao, limiarManual: false, criadoEm: Date.now() };
}

/** Acrescenta um exemplo (vetor + miniatura). Mantém no máximo `maxExemplos` (os mais antigos saem). */
export function adicionarExemplo(conceito, { vetor, rotulo = 'positivo', miniatura = null, origem = 'arquivo' }) {
  if (!vetor || !vetor.length) throw new Error('exemplo sem vetor de características');
  if (conceito.exemplos.length && conceito.exemplos[0].vetor.length !== vetor.length) throw new Error('vetor de tamanho diferente dos outros exemplos (outro modelo?)');
  conceito.exemplos.push({ id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, vetor: Array.from(vetor, x => Math.round(x * 1e6) / 1e6),
    rotulo: rotulo === 'negativo' ? 'negativo' : 'positivo', miniatura, origem, em: Date.now() });
  while (conceito.exemplos.length > CFG_LAB.maxExemplos) conceito.exemplos.shift();
  if (!conceito.limiarManual) conceito.limiar = calibrar(conceito).limiar;
  return conceito;
}

export function removerExemplo(conceito, idExemplo) {
  conceito.exemplos = conceito.exemplos.filter(e => e.id !== idExemplo);
  if (!conceito.limiarManual) conceito.limiar = calibrar(conceito).limiar;
  return conceito;
}

/**
 * Calibração por validação deixando-um-de-fora.
 * @returns {{limiar:number, qualidade:'insuficiente'|'baixa'|'boa'|'otima', acerto:number|null,
 *            positivos:number, negativos:number, simPositivos:number|null, simNegativos:number|null}}
 */
export function calibrar(conceito) {
  const pos = conceito.exemplos.filter(e => e.rotulo === 'positivo');
  const neg = conceito.exemplos.filter(e => e.rotulo === 'negativo');
  const base = { positivos: pos.length, negativos: neg.length, simPositivos: null, simNegativos: null, acerto: null };
  if (pos.length < CFG_LAB.minPositivos) return { ...base, limiar: CFG_LAB.limiarPadrao, qualidade: 'insuficiente' };
  // quão parecida cada foto positiva é com a MELHOR outra positiva
  const loo = pos.map((p, i) => Math.max(...pos.filter((_, j) => j !== i).map(q => cosseno(p.vetor, q.vetor))));
  const simNeg = neg.map(n => Math.max(...pos.map(p => cosseno(n.vetor, p.vetor))));
  const p10 = quantil(loo, 0.1), n90 = simNeg.length ? quantil(simNeg, 0.9) : null;
  let limiar = n90 == null ? p10 - 0.05 : (p10 + n90) / 2;
  limiar = Math.min(CFG_LAB.limiarMax, Math.max(CFG_LAB.limiarMin, limiar));
  // acerto deixando-um-de-fora com o limiar escolhido
  let certos = 0;
  loo.forEach(s => { if (s >= limiar) certos++; });
  simNeg.forEach(s => { if (s < limiar) certos++; });
  const acerto = certos / (loo.length + simNeg.length);
  const separacao = n90 == null ? null : p10 - n90;
  const qualidade = acerto >= 0.95 && (separacao == null ? pos.length >= 8 : separacao > 0.05) ? 'otima'
    : acerto >= 0.85 ? 'boa' : 'baixa';
  return { ...base, limiar, qualidade, acerto, simPositivos: quantil(loo, 0.5), simNegativos: n90 };
}

/**
 * O vetor (da cena ou de um recorte) é este conceito?
 * Positivo = similaridade com o melhor exemplo positivo ≥ limiar E maior que
 * a do melhor negativo (+ margem).
 */
export function reconhecer(conceito, vetor) {
  let melhorPos = -1, melhorNeg = -1;
  for (const e of conceito.exemplos) {
    const s = cosseno(vetor, e.vetor);
    if (e.rotulo === 'positivo') { if (s > melhorPos) melhorPos = s; } else if (s > melhorNeg) melhorNeg = s;
  }
  const ok = melhorPos >= conceito.limiar && melhorPos > melhorNeg + CFG_LAB.margemNegativo;
  return { ok, similaridade: Math.max(0, melhorPos), negativo: Math.max(0, melhorNeg), limiar: conceito.limiar };
}

/** Melhor conceito do tipo pedido que reconhece o vetor (ou null). */
export function melhorConceito(conceitos, vetor, tipo) {
  let melhor = null;
  for (const c of conceitos) {
    if (c.tipo !== tipo || !c.exemplos.some(e => e.rotulo === 'positivo')) continue;
    const r = reconhecer(c, vetor);
    if (r.ok && (!melhor || r.similaridade > melhor.similaridade)) melhor = { conceito: c, ...r };
  }
  return melhor;
}

/** Exporta para JSON (levar a outro aparelho). */
export function exportar(conceitos, modelo) {
  return { formato: FORMATO, versao: VERSAO_FORMATO, modelo, exportado_em: new Date().toISOString(), conceitos };
}

/** Importa JSON exportado, com validação (arquivo de fora é dado não confiável). */
export function importar(dados, modeloEsperado) {
  if (!dados || dados.formato !== FORMATO) throw new Error('não é um arquivo do laboratório do Sentinela Spy');
  if (dados.versao !== VERSAO_FORMATO) throw new Error(`versão ${dados.versao} do arquivo não suportada`);
  if (modeloEsperado && dados.modelo !== modeloEsperado) throw new Error(`os vetores foram gerados por outro modelo (${dados.modelo}) — refaça as fotos neste aparelho`);
  if (!Array.isArray(dados.conceitos) || dados.conceitos.length > 50) throw new Error('lista de conceitos inválida');
  return dados.conceitos.map(c => {
    const novo = novoConceito({ nome: c.nome, tipo: c.tipo, porte: c.porte });
    let dim = null;
    for (const e of (Array.isArray(c.exemplos) ? c.exemplos : []).slice(-CFG_LAB.maxExemplos)) {
      if (!Array.isArray(e.vetor) || e.vetor.length < 16 || e.vetor.length > 4096 || !e.vetor.every(Number.isFinite)) throw new Error(`exemplo inválido em ${novo.nome}`);
      if (dim != null && e.vetor.length !== dim) throw new Error(`vetores de tamanhos diferentes em ${novo.nome}`);
      dim = e.vetor.length;
      const mini = typeof e.miniatura === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(e.miniatura) && e.miniatura.length < 60000 ? e.miniatura : null;
      novo.exemplos.push({ id: `e${Math.random().toString(36).slice(2, 10)}`, vetor: e.vetor, rotulo: e.rotulo === 'negativo' ? 'negativo' : 'positivo',
        miniatura: mini, origem: 'importado', em: Number(e.em) || Date.now() });
    }
    if (c.limiarManual && Number.isFinite(c.limiar)) { novo.limiar = Math.min(CFG_LAB.limiarMax, Math.max(CFG_LAB.limiarMin, c.limiar)); novo.limiarManual = true; }
    else novo.limiar = calibrar(novo).limiar;
    return novo;
  });
}
