import test from 'node:test';
import assert from 'node:assert/strict';
import {
  iou, pontoNoPoligono, regressaoLinear, mediana, desvioPadrao,
  trapezio, meiaLarguraEm, caixaDePontos, aparar, cruz3,
} from '../../assets/sentinela/geometria.js';

const perto = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);

test('IoU: idênticas = 1, disjuntas = 0, metade sobreposta = 1/3', () => {
  const a = { x: 0, y: 0, w: 2, h: 2 };
  perto(iou(a, a), 1);
  assert.equal(iou(a, { x: 5, y: 5, w: 1, h: 1 }), 0);
  perto(iou(a, { x: 1, y: 0, w: 2, h: 2 }), 2 / 6);
});

test('ponto no polígono: quadrado e polígono côncavo (L)', () => {
  const q = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  assert.equal(pontoNoPoligono({ x: 0.5, y: 0.5 }, q), true);
  assert.equal(pontoNoPoligono({ x: 1.5, y: 0.5 }, q), false);
  const L = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
  assert.equal(pontoNoPoligono({ x: 0.5, y: 1.5 }, L), true);
  assert.equal(pontoNoPoligono({ x: 1.5, y: 1.5 }, L), false, 'o "vão" do L fica de fora');
  assert.equal(pontoNoPoligono({ x: 0.5, y: 0.5 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }]), false, 'menos de 3 vértices');
});

test('regressão linear: reta exata tem R² = 1 e recupera inclinação', () => {
  const r = regressaoLinear([[0, 1], [1, 3], [2, 5], [3, 7]]);
  perto(r.inclinacao, 2); perto(r.intercepto, 1); perto(r.r2, 1);
  const ruido = regressaoLinear([[0, 1], [1, -1], [2, 1], [3, -1]]);
  assert.ok(ruido.r2 < 0.3, 'ruído alternado não é tendência');
});

test('estatística básica', () => {
  assert.equal(mediana([5, 1, 3]), 3);
  assert.equal(mediana([4, 1, 3, 2]), 2.5);
  perto(desvioPadrao([2, 4, 4, 4, 5, 5, 7, 9]), 2.138089935299395, 1e-12);
});

test('trapézio do corredor: meia-largura interpola do topo à base', () => {
  const roi = { topoY: 0.5, baseY: 1, larguraTopo: 0.2, larguraBase: 1, centroX: 0.5 };
  const poly = trapezio(roi);
  assert.equal(poly.length, 4);
  perto(meiaLarguraEm(roi, 0.5), 0.1);
  perto(meiaLarguraEm(roi, 1), 0.5);
  perto(meiaLarguraEm(roi, 0.75), 0.3);
  assert.equal(pontoNoPoligono({ x: 0.5, y: 0.9 }, poly), true);
  assert.equal(pontoNoPoligono({ x: 0.05, y: 0.55 }, poly), false);
});

test('caixa de pontos ignora pontos invisíveis', () => {
  const c = caixaDePontos([{ x: 0.1, y: 0.2, visibility: 1 }, { x: 0.5, y: 0.6, visibility: 0.9 },
    { x: 0.3, y: 0.4, visibility: 0.8 }, { x: 0.99, y: 0.99, visibility: 0.01 }]);
  perto(c.x, 0.1); perto(c.w, 0.4); perto(c.h, 0.4);
});

test('janela deslizante e produto vetorial', () => {
  const l = [{ t: 0 }, { t: 50 }, { t: 100 }, { t: 150 }];
  aparar(l, 160, 60);
  assert.deepEqual(l.map(x => x.t), [100, 150]);
  assert.deepEqual(cruz3({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), { x: 0, y: 0, z: 1 });
});
