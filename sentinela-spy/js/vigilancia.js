/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA — analisador do MODO SENTINELA / vigilância (ESM puro)

   Entrada: trilhas do rastreador (pessoas e objetos com identidade),
   esqueletos do Pose Landmarker, zonas desenhadas pelo operador.

   Comportamentos e a lógica de cada um:
   ─ INTRUSÃO: o PONTO DE APOIO (pé) da pessoa dentro de zona restrita
     por ≥ 0,6 s. Pé, e não o centro da caixa: em câmera alta, a cabeça
     "entra" na zona muito antes do corpo.
   ─ PERMANÊNCIA: tempo contínuo dentro de zona monitorada.
   ─ OBJETO ABANDONADO / ESQUECIDO: máquina de estados por objeto
     portátil — móvel → estático → sem dono → abandonado. O DONO é quem
     carregava ou estava junto quando o objeto parou. Distância em metros
     estimada pela altura da pessoa como régua (1,7 m), porque câmera de
     vigilância não tem calibração métrica.
   ─ RETIRADA: objeto parado há ≥ 10 s que volta a se mover junto de
     alguém que NÃO é o dono, ou some com alguém por perto.
   ─ CORRIDA: velocidade em "alturas de corpo por segundo" — invariante
     à distância da câmera (perto ou longe, o corpo é a régua).
   ─ QUEDA: transição BRUSCA (≤ 2 s) de ereto para deitado, sustentada.
     Deitar devagar no sofá não é queda; agachar não é queda porque o
     quadril fica alto em relação ao tornozelo.
   ─ MÃOS ERGUIDAS: os dois punhos acima do nariz por ≥ 2 s.
   ─ ANOMALIA: modelo estatístico de normalidade (anomalia.js).
   ═══════════════════════════════════════════════════════════════════════ */
import { LIMIARES, CLASSES, rotulo } from './config.js';
import { pontoNoPoligono, base, centro, iou, caixaDePontos, graus } from './geometria.js';
import { ModeloNormalidade } from './anomalia.js';

const L = LIMIARES.vigilancia;
const PORT = new Set(CLASSES.portateis), RISCO = new Set(CLASSES.risco);

/** Distância (m) entre um objeto e a caixa de uma pessoa, usando a altura dela como régua. */
export function distanciaObjetoPessoaM(obj, pessoa, aspecto = 16 / 9, alturaM = L.alturaPessoaM) {
  const c = centro(obj);
  const dx = Math.max(pessoa.x - c.x, 0, c.x - (pessoa.x + pessoa.w)) * aspecto;
  const dy = Math.max(pessoa.y - c.y, 0, c.y - (pessoa.y + pessoa.h));
  const dist = Math.hypot(dx, dy);                 // em alturas de quadro
  return pessoa.h > 1e-4 ? (dist * alturaM) / pessoa.h : Infinity;
}

/** Ângulo do tronco em relação à vertical (0° = em pé). null se ombros/quadris não estão visíveis. */
export function anguloTronco(lm, aspecto = 16 / 9) {
  const ok = i => lm[i] && (lm[i].visibility ?? 1) >= 0.5;
  if (!ok(11) || !ok(12) || !ok(23) || !ok(24)) return null;
  const ombro = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 };
  const quadril = { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 };
  return graus(Math.atan2(Math.abs(quadril.x - ombro.x) * aspecto, Math.abs(quadril.y - ombro.y)));
}

/** Separação vertical quadril–tornozelo (alturas de quadro), ou null. */
function separacaoPernas(lm) {
  const ok = i => lm[i] && (lm[i].visibility ?? 1) >= 0.5;
  if (!ok(23) || !ok(24) || !(ok(27) || ok(28))) return null;
  const quadrilY = (lm[23].y + lm[24].y) / 2;
  const tornY = ok(27) && ok(28) ? (lm[27].y + lm[28].y) / 2 : (ok(27) ? lm[27].y : lm[28].y);
  return Math.abs(tornY - quadrilY);
}

/** Dois punhos acima do nariz e dos ombros. */
export function maosErguidas(lm) {
  const ok = i => lm[i] && (lm[i].visibility ?? 1) >= 0.5;
  if (!ok(0) || !ok(15) || !ok(16) || !ok(11) || !ok(12)) return false;
  const ombroY = Math.min(lm[11].y, lm[12].y);
  return lm[15].y < lm[0].y && lm[16].y < lm[0].y && lm[15].y < ombroY && lm[16].y < ombroY;
}

export class AnalisadorVigilancia {
  constructor(cfg = {}) {
    this.cfg = { ...L, ...cfg };
    this.normalidade = new ModeloNormalidade(cfg.anomalia);
    this.reiniciar();
  }

  reiniciar() {
    this.pessoas = new Map();
    this.objetos = new Map();
    this.normalidade.reiniciar();
  }

  ajustar(cfg) { Object.assign(this.cfg, cfg); }

  processar({ t, trilhas, poses = [], zonas = [], aspecto = 16 / 9 }) {
    const condicoes = [], eventos = [];
    const pessoas = trilhas.filter(tr => tr.classe === 'person' && tr.hits >= 3);
    const vivas = new Set(trilhas.map(tr => tr.id));

    // ── esqueletos → pessoas (associação gulosa por IoU) ──
    const posePorPessoa = new Map();
    const pares = [];
    poses.forEach((lm, k) => {
      const cx = caixaDePontos(lm, 0.3);
      if (!cx) return;
      pessoas.forEach(p => { const o = iou(cx, p); if (o >= 0.25) pares.push([o, k, p.id]); });
    });
    pares.sort((a, b) => b[0] - a[0]);
    const usadas = new Set();
    for (const [, k, id] of pares) {
      if (usadas.has(k) || posePorPessoa.has(id)) continue;
      usadas.add(k); posePorPessoa.set(id, poses[k]);
    }

    const resumoPessoas = [];
    for (const tr of pessoas) {
      let st = this.pessoas.get(tr.id);
      if (!st) {
        st = { zonas: new Map(), vel: 0, rapidoDesde: null, eretoEm: null, quedaCand: null, caido: false,
               pernaEreta: null, maosDesde: null, anomaliaEm: -Infinity, amostraEm: -Infinity };
        this.pessoas.set(tr.id, st);
      }
      const pe = base(tr);
      const lm = posePorPessoa.get(tr.id) || null;
      const info = { id: tr.id, zonas: [], correndo: false, caido: false, maosAlto: false, atipico: false };

      // ── zonas ──
      for (const z of zonas) {
        const dentro = pontoNoPoligono(pe, z.pontos);
        if (dentro) {
          if (!st.zonas.has(z.id)) st.zonas.set(z.id, t);
          const s = (t - st.zonas.get(z.id)) / 1000;
          info.zonas.push(z.id);
          if (z.tipo === 'restrita' && s >= this.cfg.intrusaoMinS) {
            condicoes.push({ chave: `intrusao:${z.id}:${tr.id}`, grupo: `intrusao:${z.id}`, nivel: 'critico',
              titulo: `INTRUSÃO: ${z.nome}`, detalhe: `alvo TGT-${tr.id} dentro da zona restrita há ${s.toFixed(0)} s`,
              voz: `Alerta de intrusão na zona ${z.nome}.`, alvo: tr.id });
          }
          if (z.tipo === 'monitorada' && s >= this.cfg.permanenciaS) {
            condicoes.push({ chave: `permanencia:${z.id}:${tr.id}`, grupo: `permanencia:${z.id}`, nivel: 'aviso',
              titulo: `PERMANÊNCIA PROLONGADA: ${z.nome}`, detalhe: `alvo TGT-${tr.id} parado na zona há ${s.toFixed(0)} s`,
              voz: `Atenção, permanência prolongada na zona ${z.nome}.`, alvo: tr.id });
          }
        } else if (st.zonas.has(z.id)) {
          const s = (t - st.zonas.get(z.id)) / 1000;
          if (z.tipo === 'restrita' && s >= this.cfg.intrusaoMinS)
            eventos.push({ chave: `saida:${z.id}:${tr.id}`, nivel: 'info', titulo: `SAÍDA DA ZONA ${z.nome}`, detalhe: `TGT-${tr.id} deixou a zona após ${s.toFixed(0)} s` });
          st.zonas.delete(z.id);
        }
      }

      // ── corrida (alturas de corpo por segundo) ──
      const v = tr.h > 1e-4 ? Math.hypot(tr.vx * aspecto, tr.vy) / tr.h : 0;
      st.vel = 0.6 * st.vel + 0.4 * v;
      if (st.vel >= this.cfg.corridaAlturasS && tr.hits >= 6) { if (st.rapidoDesde == null) st.rapidoDesde = t; }
      else st.rapidoDesde = null;
      if (st.rapidoDesde != null && (t - st.rapidoDesde) / 1000 >= this.cfg.corridaMinS) {
        info.correndo = true;
        condicoes.push({ chave: `corrida:${tr.id}`, grupo: 'corrida', nivel: 'aviso', titulo: 'PESSOA CORRENDO',
          detalhe: `TGT-${tr.id} a ~${(st.vel * this.cfg.alturaPessoaM).toFixed(1)} m/s`, voz: 'Atenção, pessoa correndo na área.', alvo: tr.id });
      }

      // ── queda ──
      const razao = tr.h / Math.max(1e-4, tr.w * aspecto);      // altura/largura física
      const tronco = lm ? anguloTronco(lm, aspecto) : null;
      const pernas = lm ? separacaoPernas(lm) : null;
      const ereto = tronco != null ? tronco <= 30 : razao >= 1.6;
      if (ereto) {
        st.eretoEm = t;
        if (pernas != null) st.pernaEreta = st.pernaEreta == null ? pernas : 0.8 * st.pernaEreta + 0.2 * pernas;
      }
      /* Com esqueleto, o ESQUELETO manda. A razão da caixa é só o recurso para
         quando a pose falha (e ela falha justamente em quem está deitado).
         Misturar os dois gerou falso positivo real: braços abertos alargam a
         caixa (altura/largura ≈ 0,77) com o tronco perfeitamente vertical. */
      let deitado;
      if (tronco != null) {
        const quadrilBaixo = pernas == null || st.pernaEreta == null || pernas < 0.5 * st.pernaEreta;
        deitado = tronco >= this.cfg.quedaTorsoGraus && quadrilBaixo;
      } else deitado = razao <= this.cfg.quedaRazaoMax;
      if (deitado) {
        if (st.quedaCand == null && st.eretoEm != null && t - st.eretoEm <= this.cfg.quedaJanelaMs) st.quedaCand = t;
        if (st.quedaCand != null && (t - st.quedaCand) / 1000 >= this.cfg.quedaMinS) st.caido = true;
      } else { st.quedaCand = null; st.caido = false; }
      if (st.caido) {
        info.caido = true;
        condicoes.push({ chave: `queda:${tr.id}`, grupo: 'queda', nivel: 'critico', titulo: 'QUEDA DETECTADA',
          detalhe: `TGT-${tr.id} caído${tronco != null ? ` (tronco a ${tronco.toFixed(0)}° da vertical)` : ''}`,
          voz: 'Alerta! Pessoa caída detectada. Verifique imediatamente.', alvo: tr.id });
      }

      // ── mãos erguidas ──
      if (lm && maosErguidas(lm)) { if (st.maosDesde == null) st.maosDesde = t; } else st.maosDesde = null;
      if (st.maosDesde != null && (t - st.maosDesde) / 1000 >= this.cfg.maosAltoS) {
        info.maosAlto = true;
        condicoes.push({ chave: `maos:${tr.id}`, grupo: 'maos', nivel: 'aviso', titulo: 'MÃOS ERGUIDAS',
          detalhe: `TGT-${tr.id} com as duas mãos acima da cabeça — possível rendição ou pedido de socorro`,
          voz: 'Atenção, pessoa com as mãos erguidas.', alvo: tr.id });
      }

      // ── anomalia estatística (amostragem ~5 Hz por alvo, só trilhas maduras) ──
      if (tr.hits >= 5 && t - st.amostraEm >= 200) {
        st.amostraEm = t;
        const a = this.normalidade.avaliar(pe.x, pe.y, st.vel);
        if ((a.rara || a.rapida) && t - st.anomaliaEm >= 30000) {
          st.anomaliaEm = t;
          info.atipico = true;
          eventos.push({ chave: `anomalia:${tr.id}`, nivel: 'aviso', titulo: 'COMPORTAMENTO ATÍPICO',
            detalhe: `TGT-${tr.id}: ${a.rara ? `região raramente ocupada (p=${(a.prob * 100).toFixed(2)}%)` : ''}${a.rara && a.rapida ? ' · ' : ''}${a.rapida ? `velocidade fora do padrão do local (z=${a.z.toFixed(1)})` : ''}`,
            alvo: tr.id });
        }
        this.normalidade.aprender(pe.x, pe.y, st.vel, t);
      }
      resumoPessoas.push(info);
    }
    for (const id of this.pessoas.keys()) if (!vivas.has(id)) this.pessoas.delete(id);

    // ── objetos portáteis: abandono, esquecimento, retirada ──
    const resumoObjetos = [];
    const portateis = trilhas.filter(tr => PORT.has(tr.classe) && tr.hits >= 3);
    for (const tr of portateis) {
      let st = this.objetos.get(tr.id);
      if (!st) {
        st = { classe: tr.classe, estado: 'movel', dono: null, semDonoDesde: null, pessoaPertoEm: null,
               estaticoDesde: null, alertado: false, ultimaCaixa: null };
        this.objetos.set(tr.id, st);
      }
      st.classe = tr.classe;
      st.ultimaCaixa = { x: tr.x, y: tr.y, w: tr.w, h: tr.h };
      // pessoa mais próxima (e a distância até o dono, se houver)
      let maisPerto = null, dMin = Infinity, dDono = Infinity, donoVivo = false;
      for (const p of pessoas) {
        const d = distanciaObjetoPessoaM(tr, p, aspecto, this.cfg.alturaPessoaM);
        if (d < dMin) { dMin = d; maisPerto = p; }
        if (p.id === st.dono) { dDono = d; donoVivo = true; }
      }
      if (dMin <= 1.5) st.pessoaPertoEm = t;
      const nome = rotulo(tr.classe);

      if (!tr.estatico) {
        // em movimento = está sendo carregado; quem está junto é o portador
        const antigo = st.estado !== 'movel' && st.estaticoDesde != null && (t - st.estaticoDesde) / 1000 >= this.cfg.remocaoEstaticoMinS;
        if (antigo && maisPerto && dMin <= 1.0) {
          const ehDono = st.dono != null && maisPerto.id === st.dono;
          eventos.push(ehDono
            ? { chave: `recolhido:${tr.id}`, nivel: 'info', titulo: 'OBJETO RECOLHIDO PELO DONO', detalhe: `${nome} TGT-${tr.id} recolhido por TGT-${maisPerto.id}` }
            : { chave: `retirada:${tr.id}`, nivel: 'aviso', titulo: `OBJETO SENDO RETIRADO: ${nome}`, detalhe: `TGT-${maisPerto.id} levando ${nome.toLowerCase()} que não era dele — possível furto`, alvo: maisPerto.id });
        }
        if (maisPerto && dMin <= 0.5) st.dono = maisPerto.id;
        st.estado = 'movel'; st.semDonoDesde = null; st.estaticoDesde = null; st.alertado = false;
      } else {
        if (st.estado === 'movel') {
          st.estado = 'estatico';
          st.estaticoDesde = tr.estaticoDesde ?? t;
          if (st.dono == null && maisPerto && dMin <= 1.5) st.dono = maisPerto.id;
        }
        const acompanhado = st.dono != null
          ? donoVivo && dDono <= this.cfg.raioDonoM
          : dMin <= this.cfg.raioDonoM;
        if (acompanhado) {
          if (st.estado === 'abandonado')
            eventos.push({ chave: `retorno:${tr.id}`, nivel: 'info', titulo: 'OBJETO VOLTOU A SER ACOMPANHADO', detalhe: `${nome} TGT-${tr.id}` });
          st.estado = 'estatico'; st.semDonoDesde = null; st.alertado = false;
        } else {
          if (st.semDonoDesde == null) st.semDonoDesde = t;
          if (st.estado !== 'abandonado') st.estado = 'sem_dono';
          if ((t - st.semDonoDesde) / 1000 >= this.cfg.abandonoS) st.estado = 'abandonado';
        }
      }

      const restanteS = st.estado === 'sem_dono' ? Math.max(0, this.cfg.abandonoS - (t - st.semDonoDesde) / 1000) : null;
      if (st.estado === 'abandonado') {
        const quem = st.dono != null ? (donoVivo ? `dono TGT-${st.dono} a ~${dDono.toFixed(1)} m` : `dono TGT-${st.dono} deixou a cena`) : 'sem dono identificado';
        condicoes.push({ chave: `abandono:${tr.id}`, grupo: 'abandono', nivel: 'critico',
          titulo: st.dono != null ? `OBJETO ESQUECIDO/ABANDONADO: ${nome}` : `OBJETO ABANDONADO: ${nome}`,
          detalhe: `${nome} TGT-${tr.id} sem acompanhamento há ${((t - st.semDonoDesde) / 1000).toFixed(0)} s — ${quem}`,
          voz: `Alerta! ${nome.toLowerCase()} abandonado detectado.`, alvo: tr.id });
      }
      resumoObjetos.push({ id: tr.id, classe: tr.classe, estado: st.estado, restanteS, dono: st.dono });
    }
    // objetos que sumiram: retirada sem detecção do "levar"
    for (const [id, st] of this.objetos) {
      if (vivas.has(id)) continue;
      const parado = st.estaticoDesde != null && (t - st.estaticoDesde) / 1000 >= this.cfg.remocaoEstaticoMinS;
      if (parado && st.pessoaPertoEm != null && t - st.pessoaPertoEm <= 8000) {
        eventos.push(st.estado === 'abandonado'
          ? { chave: `recolhido:${id}`, nivel: 'info', titulo: 'OBJETO ABANDONADO RECOLHIDO', detalhe: `${rotulo(st.classe)} TGT-${id} saiu de cena com alguém por perto` }
          : { chave: `sumiu:${id}`, nivel: 'aviso', titulo: `OBJETO RETIRADO: ${rotulo(st.classe)}`, detalhe: `${rotulo(st.classe)} TGT-${id} desapareceu com uma pessoa por perto — possível furto` });
      }
      this.objetos.delete(id);
    }

    // ── objetos de risco (COCO: faca, taco, tesoura) ──
    for (const tr of trilhas) {
      if (!RISCO.has(tr.classe) || tr.hits < this.cfg.riscoHitsMin || tr.score < 0.5) continue;
      const empunhado = pessoas.some(p => iou(tr, p) > 0 && centro(tr).y < p.y + p.h * 0.75);
      condicoes.push({ chave: `risco:${tr.id}`, grupo: 'risco', nivel: empunhado ? 'critico' : 'aviso',
        titulo: `OBJETO DE RISCO: ${rotulo(tr.classe)}`,
        detalhe: `${empunhado ? 'junto ao corpo de uma pessoa' : 'na cena'} — confiança ${(tr.score * 100).toFixed(0)}%, verifique (detector genérico erra)`,
        voz: empunhado ? `Alerta! Possível ${rotulo(tr.classe).toLowerCase()} na mão de uma pessoa.` : null, alvo: tr.id });
    }

    if (pessoas.length >= this.cfg.aglomeracao) {
      condicoes.push({ chave: 'aglomeracao', grupo: 'aglomeracao', nivel: 'aviso', titulo: 'AGLOMERAÇÃO',
        detalhe: `${pessoas.length} pessoas na cena`, voz: 'Atenção, aglomeração detectada.' });
    }

    return {
      metricas: {
        pessoas: pessoas.length,
        objetos: resumoObjetos.length,
        abandonados: resumoObjetos.filter(o => o.estado === 'abandonado').length,
        semDono: resumoObjetos.filter(o => o.estado === 'sem_dono').length,
        poses: posePorPessoa.size,
        normalidade: { aquecido: this.normalidade.aquecido, amostras: this.normalidade.amostras, alvo: this.normalidade.cfg.aquecimentoAmostras },
      },
      condicoes, eventos, pessoas: resumoPessoas, objetos: resumoObjetos,
    };
  }
}
