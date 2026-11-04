import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AnalisadorTransito, estimarTTC, distanciaEstimada, fatorFocal, tipoDe,
} from '../js/transito.js';
import { Rastreador } from '../js/rastreador.js';

const ASPECTO = 16 / 9;
const FOV = 70;
const perto = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);

test('modelo pinhole: carro de 1,8 m ocupando 10% da largura com FOV 70° está a ~12,9 m', () => {
  perto(fatorFocal(90), 0.5, 1e-12);                       // tan(45°) = 1
  const z = distanciaEstimada('car', { w: 0.1, h: 0.08 }, FOV, ASPECTO);
  perto(z, (0.5 / Math.tan((35 * Math.PI) / 180)) * 1.8 / 0.1, 1e-9);
  perto(z, 12.85, 0.01);
  assert.equal(distanciaEstimada('suitcase', { w: 0.1, h: 0.1 }), null, 'classe sem dimensão de projeto');
});

/** Histórico de um carro se aproximando a velocidade constante, visto a 15 quadros/s. */
function aproximacao({ z0, v, duracaoMs, larguraReal = 1.8 }) {
  const fw = fatorFocal(FOV);
  const hist = [];
  for (let t = 0; t <= duracaoMs; t += 66) {
    const z = z0 - (v * t) / 1000;
    const w = (fw * larguraReal) / z;
    hist.push({ t, cx: 0.5, cy: 0.6, w, h: w * 0.8 * ASPECTO / 2 });
  }
  return hist;
}

test('TTC por escala: 30 m a 10 m/s, após 0,9 s o TTC verdadeiro é 2,1 s', () => {
  const hist = aproximacao({ z0: 30, v: 10, duracaoMs: 924 });
  const t = hist[hist.length - 1].t;
  const zAgora = 30 - (10 * t) / 1000;
  const r = estimarTTC(hist, t);
  assert.ok(r && r.confiavel);
  perto(r.ttc, zAgora / 10, 0.12);      // com a correção de meia-janela
  assert.ok(r.r2 > 0.99);
});

test('TTC: alvo estável ou se afastando dá infinito; histórico curto dá null', () => {
  const estavel = Array.from({ length: 14 }, (_, k) => ({ t: k * 66, cx: 0.5, cy: 0.5, w: 0.1, h: 0.1 }));
  assert.equal(estimarTTC(estavel, 858).ttc, Infinity);
  const afastando = aproximacao({ z0: 20, v: -8, duracaoMs: 900 });
  assert.equal(estimarTTC(afastando, 858).ttc, Infinity);
  assert.equal(estimarTTC(estavel.slice(0, 3), 132), null);
});

test('TTC ignora a altura cortada pela borda inferior do quadro', () => {
  // largura crescendo (aproximação) mas a caixa encostada no fundo: a altura "encolhe"
  const hist = aproximacao({ z0: 12, v: 6, duracaoMs: 900 }).map(p => ({ ...p, cy: 0.9, h: 0.25 }));
  const r = estimarTTC(hist, hist[hist.length - 1].t);
  assert.ok(isFinite(r.ttc), 'a dimensão válida (largura) ainda acusa aproximação');
});

test('classificação de tipo', () => {
  assert.equal(tipoDe('person'), 'pedestre');
  assert.equal(tipoDe('truck'), 'veiculo');
  assert.equal(tipoDe('cow'), 'animal');
  assert.equal(tipoDe('suitcase'), 'obstaculo');
  assert.equal(tipoDe('laptop'), null);
});

/** Cena ponta a ponta: detecções sintéticas → rastreador → analisador. */
function cena(gerarDeteccoes, ms, opts = {}) {
  const r = new Rastreador({ aspecto: ASPECTO });
  const a = new AnalisadorTransito({ fovHorizontalGraus: FOV });
  let saida;
  for (let t = 0; t <= ms; t += 66) {
    const trilhas = r.atualizar(gerarDeteccoes(t), t);
    saida = a.processar({ t, trilhas, aspecto: ASPECTO, velocidade: opts.velocidade ?? null });
  }
  return saida;
}

test('veículo-líder no corredor fechando rápido → RISCO DE COLISÃO crítico', () => {
  const fw = fatorFocal(FOV);
  const s = cena(t => {
    const z = 30 - (14 * t) / 1000;                 // 14 m/s de fechamento
    const w = (fw * 1.8) / z, h = w * 0.7;
    return [{ classe: 'car', score: 0.9, x: 0.5 - w / 2, y: 0.85 - h, w, h }];
  }, 1300);
  assert.ok(s.metricas.lider, 'líder identificado');
  assert.ok(s.condicoes.some(c => c.chave === 'colisao' && c.nivel === 'critico'), JSON.stringify(s.condicoes));
  assert.ok(s.alvos.find(x => x.lider).risco === 'critico');
});

test('veículo à frente em distância constante não gera alerta de colisão', () => {
  const s = cena(() => [{ classe: 'car', score: 0.9, x: 0.45, y: 0.7, w: 0.1, h: 0.08 }], 1500);
  assert.ok(!s.condicoes.some(c => c.grupo === 'colisao'));
});

test('distância temporal < 1 s com GPS → DISTÂNCIA INSEGURA', () => {
  // carro a ~12,9 m (w = 0,1) e nós a 20 m/s (72 km/h) → headway 0,64 s
  const s = cena(() => [{ classe: 'car', score: 0.9, x: 0.45, y: 0.7, w: 0.1, h: 0.08 }], 1500, { velocidade: 20 });
  assert.ok(s.condicoes.some(c => c.chave === 'distancia'), JSON.stringify(s.condicoes));
  perto(s.metricas.lider.thw, 12.85 / 20, 0.05);
});

test('pedestre dentro do corredor e perto → crítico; fora e parado → nada', () => {
  const dentro = cena(() => [{ classe: 'person', score: 0.9, x: 0.47, y: 0.45, w: 0.06, h: 0.4 }], 900);
  assert.ok(dentro.condicoes.some(c => c.grupo === 'pedestre' && c.nivel === 'critico'));
  const fora = cena(() => [{ classe: 'person', score: 0.9, x: 0.02, y: 0.3, w: 0.04, h: 0.25 }], 900);
  assert.equal(fora.condicoes.length, 0);
});

test('obstáculo colado à frente (caixa cortada pela borda inferior) CONTA como no corredor', () => {
  // falha real do E2E: patas em y≈1,0 ficavam abaixo da base do trapézio (0,98)
  // e o animal mais perigoso — colado ao para-choque — era ignorado
  const s = cena(() => [{ classe: 'dog', score: 0.9, x: 0.42, y: 0.55, w: 0.16, h: 0.45 }], 900);
  assert.ok(s.condicoes.some(c => c.grupo === 'animal' && c.nivel === 'critico'), JSON.stringify(s.condicoes));
});

test('pedestre na calçada caminhando rumo ao corredor → PEDESTRE ATRAVESSANDO', () => {
  const s = cena(t => [{ classe: 'person', score: 0.9, x: 0.12 + (0.1 * t) / 1000, y: 0.4, w: 0.04, h: 0.3 }], 1000);
  assert.ok(s.condicoes.some(c => c.grupo === 'travessia'), JSON.stringify(s.condicoes));
});
