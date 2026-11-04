/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA — analisador do MODO TRÂNSITO (ESM puro)

   Câmera apontada para a via (celular no para-brisa, câmera traseira).
   Três medidas, todas MONOCULARES — sem radar, sem estéreo:

   1. TEMPO ATÉ A COLISÃO (TTC) pela variação de escala.
      Com aproximação a velocidade constante, a largura aparente do alvo
      é w ∝ 1/Z. Então d(ln w)/dt = −Ż/Z = 1/TTC. Uma regressão linear de
      ln(w) contra o tempo, sobre ~0,9 s de histórico, dá o TTC SEM
      conhecer a distância — o mesmo princípio dos sistemas de alerta de
      colisão por câmera única (Dagan, Mano, Stein & Shashua, IEEE IV 2004).
      O R² da regressão separa aproximação real de tremor do detector.

   2. DISTÂNCIA pelo modelo pinhole: Z = f · W_real / w, com
      f = 0,5 / tan(FOV/2) em larguras de quadro. W_real é a largura
      média da classe (config.js) — por isso a tela mostra "~18 m".

   3. DISTÂNCIA TEMPORAL (headway) = Z / v_próprio, quando o GPS do
      celular informa a velocidade.

   Limiar crítico de TTC: a NHTSA exige que o alerta de colisão dispare
   até TTC 2,1 s no cenário de veículo parado à frente; este pipeline
   tem ~0,5 s de latência (quadros + janela da regressão), então dispara
   em 2,6 s. É um ASSISTENTE de atenção: não freia, não substitui ADAS
   homologado e degrada à noite, sob chuva e com o celular trepidando.
   ═══════════════════════════════════════════════════════════════════════ */
import { LIMIARES, CLASSES, DIMENSOES, rotulo } from './config.js';
import {
  trapezio, pontoNoPoligono, base, meiaLarguraEm, regressaoLinear,
  radianos, aparar,
} from './geometria.js';

const L = LIMIARES.transito;
const VEIC = new Set(CLASSES.veiculos), ANIM = new Set(CLASSES.animais), OBST = new Set(CLASSES.obstaculos);

export function tipoDe(classe) {
  if (classe === 'person') return 'pedestre';
  if (VEIC.has(classe)) return 'veiculo';
  if (ANIM.has(classe)) return 'animal';
  if (OBST.has(classe)) return 'obstaculo';
  return null;
}

/** Fator focal em LARGURAS de quadro: f_px / W = 0,5 / tan(FOVh/2). */
export const fatorFocal = fovH => 0.5 / Math.tan(radianos(fovH) / 2);

/** Distância estimada (m) pelo modelo pinhole, ou null se a classe não tem dimensão de projeto. */
export function distanciaEstimada(classe, caixa, fovH = L.fovHorizontalGraus, aspecto = 16 / 9) {
  const dim = DIMENSOES[classe];
  if (!dim) return null;
  const fw = fatorFocal(fovH);
  if (dim.largura) return caixa.w > 1e-4 ? (fw * dim.largura) / caixa.w : null;
  return caixa.h > 1e-4 ? (fw * aspecto * dim.altura) / caixa.h : null;
}

/**
 * TTC pela taxa de variação logarítmica do tamanho aparente.
 * Amostras com a caixa cortada pela borda do quadro são descartadas na
 * dimensão cortada — um carro muito perto "encolhe" na borda inferior
 * e mentiria um afastamento.
 */
export function estimarTTC(historico, t, o = {}) {
  const janelaMs = o.janelaMs ?? L.ttcJanelaMs, amostrasMin = o.amostrasMin ?? L.ttcAmostrasMin, r2Min = o.r2Min ?? L.ttcR2Min;
  const pts = historico.filter(h => t - h.t <= janelaMs && h.w > 0 && h.h > 0);
  if (pts.length < amostrasMin) return null;
  const t0 = pts[0].t;
  const largura = pts.filter(p => p.cx - p.w / 2 > 0.005 && p.cx + p.w / 2 < 0.995);
  const altura = pts.filter(p => p.cy - p.h / 2 > 0.005 && p.cy + p.h / 2 < 0.995);
  const regs = [];
  if (largura.length >= amostrasMin) regs.push(regressaoLinear(largura.map(p => [(p.t - t0) / 1000, Math.log(p.w)])));
  if (altura.length >= amostrasMin) regs.push(regressaoLinear(altura.map(p => [(p.t - t0) / 1000, Math.log(p.h)])));
  const boas = regs.filter(r => r.r2 >= r2Min);
  const r2max = regs.reduce((m, r) => Math.max(m, r.r2), 0);
  if (!boas.length) return { ttc: Infinity, taxa: 0, r2: r2max, confiavel: false };
  const peso = boas.reduce((s, r) => s + r.r2, 0);
  const taxa = boas.reduce((s, r) => s + r.inclinacao * r.r2, 0) / peso;   // 1/TTC no centro da janela
  const r2 = peso / boas.length;
  if (taxa <= 0.02) return { ttc: Infinity, taxa, r2, confiavel: true };  // estável ou se afastando
  /* A inclinação de mínimos quadrados estima 1/TTC no INSTANTE MÉDIO das
     amostras, não no último. Com velocidade constante o TTC cai 1 s por
     segundo, então TTC(agora) = TTC(centro) − (agora − t̄). Sem esta
     correção o alerta chegaria ~meia janela (~0,45 s) atrasado — o erro
     na direção perigosa. */
  const tMedio = pts.reduce((s, p) => s + p.t, 0) / pts.length;
  const ttc = Math.max(0, 1 / taxa - (t - tMedio) / 1000);
  return { ttc, taxa, r2, confiavel: true };
}

export class AnalisadorTransito {
  constructor(cfg = {}) {
    this.cfg = { ...L, ...cfg, roi: { ...L.roi, ...(cfg.roi || {}) } };
    this.estado = new Map();   // por trilha: série de distância e flags
  }

  reiniciar() { this.estado.clear(); }
  /** Troca de perfil: corredor e campo de visão são calibração do operador — ficam. */
  ajustar(cfg) {
    const { roi, fovHorizontalGraus } = this.cfg;
    Object.assign(this.cfg, cfg, { roi, fovHorizontalGraus });
  }
  definirROI(roi) { this.cfg.roi = { ...this.cfg.roi, ...roi }; }
  definirFOV(fov) { this.cfg.fovHorizontalGraus = fov; }

  processar({ t, trilhas, aspecto = 16 / 9, velocidade = null }) {
    const roi = this.cfg.roi, poly = trapezio(roi);
    const condicoes = [], eventos = [], alvos = [];
    const vivos = new Set();
    let lider = null;
    const contagem = { veiculo: 0, pedestre: 0, animal: 0, obstaculo: 0 };

    for (const tr of trilhas) {
      const tipo = tipoDe(tr.classe);
      if (!tipo) continue;
      vivos.add(tr.id);
      contagem[tipo]++;
      let st = this.estado.get(tr.id);
      if (!st) { st = { dist: [] }; this.estado.set(tr.id, st); }

      /* Ponto de apoio limitado à base do corredor: um objeto COLADO à frente
         do veículo sai cortado pela borda inferior (pé em y ≈ 1,0, abaixo da
         base do trapézio) — e é justamente o caso mais urgente. Sem este
         limite ele ficava "fora do corredor" (falha real vista no teste E2E). */
      const pe0 = base(tr);
      const pe = { x: pe0.x, y: Math.min(pe0.y, roi.baseY - 1e-3) };
      const noCorredor = pontoNoPoligono(pe, poly);
      const z = distanciaEstimada(tr.classe, tr, this.cfg.fovHorizontalGraus, aspecto);
      if (z != null && isFinite(z)) { st.dist.push({ t, z }); aparar(st.dist, t, 1200); }

      // velocidade de fechamento (m/s) pela derivada da distância
      let fechamento = null;
      if (st.dist.length >= 5) {
        const t0 = st.dist[0].t;
        const r = regressaoLinear(st.dist.map(s => [(s.t - t0) / 1000, s.z]));
        if (r.r2 >= 0.3) fechamento = -r.inclinacao;
      }

      const maduro = tr.hits >= 5 && t - tr.nasceu >= 500;
      const est = maduro ? estimarTTC(tr.historico, t, { janelaMs: this.cfg.ttcJanelaMs, amostrasMin: this.cfg.ttcAmostrasMin, r2Min: this.cfg.ttcR2Min }) : null;
      let ttc = est && est.confiavel ? est.ttc : Infinity;
      if (!isFinite(ttc) && z != null && fechamento != null && fechamento > 0.5) ttc = z / fechamento;

      // proximidade lateral do corredor (negativo = dentro)
      const dxCentro = pe.x - roi.centroX;
      const foraDoCorredor = Math.abs(dxCentro) - meiaLarguraEm(roi, pe.y);
      const rumoAoCorredor = Math.sign(dxCentro) !== Math.sign(tr.vx) && Math.abs(tr.vx) >= this.cfg.lateralPedestre;

      const alvo = { id: tr.id, tipo, classe: tr.classe, z, ttc, fechamento, noCorredor, risco: null, lider: false };
      alvos.push(alvo);

      if (tipo === 'veiculo' && noCorredor && maduro && (z == null || z <= this.cfg.distanciaMaxAlvoM)) {
        if (!lider || pe.y > lider.pe.y) lider = { alvo, tr, pe };
      }

      const nome = rotulo(tr.classe);
      const zTxt = z != null ? `~${z.toFixed(0)} m` : 'distância indefinida';

      if (tipo === 'pedestre' && maduro) {
        if (noCorredor) {
          const crit = (z != null && z <= this.cfg.pedestreCriticoM) || ttc <= 3;
          alvo.risco = crit ? 'critico' : 'aviso';
          condicoes.push({ chave: `pedestre:${tr.id}`, grupo: 'pedestre', nivel: alvo.risco, titulo: 'PEDESTRE NA PISTA',
            detalhe: `alvo TGT-${tr.id} no corredor do veículo (${zTxt})`,
            voz: crit ? 'Cuidado! Pedestre à frente!' : 'Atenção, pedestre na pista à frente.' });
        } else if (foraDoCorredor < 0.12 && rumoAoCorredor) {
          alvo.risco = 'aviso';
          condicoes.push({ chave: `travessia:${tr.id}`, grupo: 'travessia', nivel: 'aviso', titulo: 'PEDESTRE ATRAVESSANDO',
            detalhe: `alvo TGT-${tr.id} entrando no corredor (${zTxt})`, voz: 'Atenção, pedestre atravessando.' });
        }
      }

      if (tipo === 'animal' && noCorredor && maduro) {
        alvo.risco = (z != null && z <= 40) || ttc <= this.cfg.ttcAvisoS ? 'critico' : 'aviso';
        condicoes.push({ chave: `animal:${tr.id}`, grupo: 'animal', nivel: alvo.risco, titulo: 'ANIMAL NA PISTA',
          detalhe: `${nome} no corredor do veículo (${zTxt})`, voz: 'Cuidado! Animal na pista!' });
      }

      if (tipo === 'obstaculo' && noCorredor && maduro) {
        alvo.risco = ttc <= this.cfg.ttcCriticoS ? 'critico' : 'aviso';
        condicoes.push({ chave: `obstaculo:${tr.id}`, grupo: 'obstaculo', nivel: alvo.risco, titulo: `OBJETO NA PISTA: ${nome}`,
          detalhe: isFinite(ttc) ? `aproximação: colisão em ${ttc.toFixed(1)} s` : 'objeto parado no corredor', voz: 'Atenção, objeto na pista.' });
      }
    }

    // ── veículo-líder: alerta de colisão frontal e distância ──
    let metricasLider = null;
    if (lider) {
      const { alvo } = lider;
      alvo.lider = true;
      const thw = velocidade != null && velocidade >= 5 && alvo.z != null ? alvo.z / velocidade : null;
      metricasLider = { id: alvo.id, classe: alvo.classe, z: alvo.z, ttc: alvo.ttc, fechamento: alvo.fechamento, thw };
      const longe = alvo.z != null && alvo.z > 60;
      if (!longe && alvo.ttc <= this.cfg.ttcCriticoS) {
        alvo.risco = 'critico';
        condicoes.push({ chave: 'colisao', grupo: 'colisao', nivel: 'critico', titulo: 'RISCO DE COLISÃO',
          detalhe: `colisão em ${alvo.ttc.toFixed(1)} s com ${rotulo(alvo.classe)} TGT-${alvo.id}${alvo.z != null ? ` (~${alvo.z.toFixed(0)} m)` : ''}`,
          voz: 'Freie! Risco de colisão à frente!' });
      } else if (!longe && alvo.ttc <= this.cfg.ttcAvisoS) {
        alvo.risco = 'aviso';
        condicoes.push({ chave: 'aproximacao', grupo: 'colisao', nivel: 'aviso', titulo: 'VEÍCULO À FRENTE SE APROXIMANDO',
          detalhe: `colisão projetada em ${alvo.ttc.toFixed(1)} s`, voz: 'Atenção, veículo à frente se aproximando.' });
      }
      if (thw != null && thw < this.cfg.headwayAvisoS) {
        alvo.risco = alvo.risco || 'aviso';
        condicoes.push({ chave: 'distancia', grupo: 'distancia', nivel: 'aviso', titulo: 'DISTÂNCIA INSEGURA',
          detalhe: `${thw.toFixed(1)} s até o veículo à frente (~${alvo.z.toFixed(0)} m a ${(velocidade * 3.6).toFixed(0)} km/h)`,
          voz: 'Aumente a distância do veículo à frente.' });
      } else if (thw == null && alvo.fechamento != null && alvo.fechamento >= this.cfg.aproximacaoMs
                 && alvo.z != null && alvo.z <= this.cfg.distanciaCurtaM) {
        alvo.risco = alvo.risco || 'aviso';
        condicoes.push({ chave: 'distancia', grupo: 'distancia', nivel: 'aviso', titulo: 'DISTÂNCIA ENCURTANDO',
          detalhe: `fechando a ${alvo.fechamento.toFixed(1)} m/s (~${alvo.z.toFixed(0)} m)`,
          voz: 'Atenção, a distância para o veículo à frente está diminuindo.' });
      }
    }

    for (const id of this.estado.keys()) if (!vivos.has(id)) this.estado.delete(id);

    return {
      metricas: { contagem, lider: metricasLider, velocidade, roi },
      condicoes, eventos, alvos,
    };
  }
}
