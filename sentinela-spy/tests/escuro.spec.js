import test from 'node:test';
import assert from 'node:assert/strict';
import {
  paraCinza, estatisticasLuz, curvaRealce, aplicarCurvaCinza, MonitorLuz, DetectorMovimento,
} from '../js/escuro.js';

/* Quadros sintéticos 160×90 com ruído gaussiano de sensor — gerador
   determinístico (mulberry32) para o teste não oscilar. */
const W = 160, H = 90, N = W * H;
function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gerador(seed) {
  const r = prng(seed);
  return () => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
}
function quadro({ base = 30, sigma = 6, quadrados = [], gauss }) {
  const q = new Uint8Array(N);
  for (let i = 0; i < N; i++) q[i] = Math.max(0, Math.min(255, Math.round(base + sigma * gauss())));
  for (const s of quadrados) {
    for (let y = s.y; y < s.y + s.lado; y++) for (let x = s.x; x < s.x + s.lado; x++) {
      if (x >= 0 && x < W && y >= 0 && y < H) q[y * W + x] = Math.max(0, Math.min(255, Math.round(s.v + sigma * gauss())));
    }
  }
  return q;
}

test('cinza BT.601 e estatística de luz por histograma', () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
  assert.deepEqual([...paraCinza(rgba, 3)], [255, 0, 76]);
  const est = estatisticasLuz(new Uint8Array(1000).fill(51));
  assert.ok(Math.abs(est.media - 0.2) < 1e-9);
  assert.equal(est.p02, 51); assert.equal(est.p50, 51); assert.equal(est.p98, 51);
});

test('realce: imagem escura vai para mediana ~45%, e o ganho tem teto (escuro total não vira textura)', () => {
  const { lut, ganho, gama } = curvaRealce({ p02: 5, p50: 20, p98: 45 });
  assert.equal(lut[5], 0); assert.equal(lut[45], 255);
  assert.ok(Math.abs(lut[20] - 0.45 * 255) <= 3, `mediana realçada ${lut[20]}`);
  assert.ok(gama < 1 && gama >= 0.3);
  assert.ok(ganho > 6 && ganho <= 8.01);
  const quase = curvaRealce({ p02: 2, p50: 3, p98: 4 });   // escuro total: faixa de 2 níveis
  assert.ok(quase.ganho <= 8.0001, `ganho limitado a 8×, foi ${quase.ganho}`);
  for (let v = 1; v < 256; v++) assert.ok(quase.lut[v] >= quase.lut[v - 1], 'curva monotônica');
  const img = new Uint8Array([5, 20, 45]);
  assert.deepEqual([...aplicarCurvaCinza(img, lut)], [lut[5], lut[20], lut[45]]);
});

test('monitor de luz: entra no modo noturno abaixo de 20% e só sai acima de 27% (histerese)', () => {
  const m = new MonitorLuz({ suavizacao: 1 });   // sem suavização: testa só a histerese
  const est = media => ({ media, p02: 0, p50: Math.round(media * 255), p98: Math.round(media * 255) + 20 });
  assert.equal(m.atualizar(est(0.35)).escuro, false);
  assert.equal(m.atualizar(est(0.12)).escuro, true);
  assert.ok(m.curva, 'curva de realce disponível no escuro');
  assert.equal(m.atualizar(est(0.24)).escuro, true, 'na faixa da histerese continua noturno');
  assert.equal(m.atualizar(est(0.30)).escuro, false);
  assert.equal(m.curva, null);
});

test('movimento: ruído de sensor no escuro NÃO gera alarme; quadrado em movimento é detectado onde está', () => {
  const g = gerador(7), det = new DetectorMovimento();
  let t = 0, falsos = 0;
  for (let k = 0; k < 120; k++, t += 100) {   // 12 s só ruído (σ = 6 níveis)
    const r = det.processar(quadro({ gauss: g }), W, H, t);
    if (!r.estabilizando) falsos += r.movimento.length;
  }
  assert.equal(falsos, 0, 'nenhum falso movimento com ruído puro');
  assert.ok(det.ultimo.sigma > 3 && det.ultimo.sigma < 10, `σ estimado ${det.ultimo.sigma.toFixed(1)} ≈ 6`);
  let achou = null;
  for (let k = 0; k < 10; k++, t += 100) {   // alvo de 20×20 px atravessando a cena
    const r = det.processar(quadro({ gauss: g, quadrados: [{ x: 20 + 8 * k, y: 35, lado: 20, v: 150 }] }), W, H, t);
    if (k === 6) achou = r.movimento[0];
  }
  assert.ok(achou, 'movimento detectado');
  const cx = achou.x + achou.w / 2, cy = achou.y + achou.h / 2;
  assert.ok(Math.abs(cx - (20 + 8 * 6 + 10) / W) < 0.12, `centro x ${cx.toFixed(2)}`);
  assert.ok(Math.abs(cy - (35 + 10) / H) < 0.15, `centro y ${cy.toFixed(2)}`);
});

test('troca brusca de luz não é movimento: refaz o fundo e estabiliza', () => {
  const g = gerador(11), det = new DetectorMovimento();
  let t = 0;
  for (let k = 0; k < 40; k++, t += 100) det.processar(quadro({ gauss: g }), W, H, t);
  const r = det.processar(quadro({ base: 120, gauss: g }), W, H, t);   // luz acesa
  assert.equal(r.trocaDeLuz, true);
  assert.equal(r.movimento.length, 0);
  let depois = 0;
  for (let k = 0; k < 40; k++) { t += 100; const q = det.processar(quadro({ base: 120, gauss: g }), W, H, t); if (!q.estabilizando) depois += q.movimento.length + q.estaticos.length; }
  assert.equal(depois, 0, 'cena estável depois da troca de luz');
});

test('fundo duplo: objeto deixado na cena vira ESTÁTICO (não movimento) e a deriva de exposição não', () => {
  const g = gerador(23), det = new DetectorMovimento();
  let t = 0;
  for (let k = 0; k < 60; k++, t += 100) det.processar(quadro({ base: 40, gauss: g }), W, H, t);
  const obj = { x: 100, y: 50, lado: 14, v: 160 };
  let estatico = null, movimentoNoFim = 0;
  for (let k = 0; k < 120; k++, t += 100) {   // 12 s com o objeto parado no lugar
    const r = det.processar(quadro({ base: 40, gauss: g, quadrados: [obj] }), W, H, t);
    if (k === 119) { estatico = r.estaticos[0]; movimentoNoFim = r.movimento.length; }
  }
  assert.ok(estatico, 'objeto parado aparece como estático');
  assert.equal(movimentoNoFim, 0, 'depois de absorvido pelo fundo curto, não é mais movimento');
  assert.ok(Math.abs(estatico.x - obj.x / W) < 0.03 && Math.abs(estatico.y - obj.y / H) < 0.05);
  det.absorver(estatico);
  const r = det.processar(quadro({ base: 40, gauss: g, quadrados: [obj] }), W, H, t);
  assert.equal(r.estaticos.length, 0, 'região absorvida (objeto tratado) sai da lista');

  // deriva lenta de exposição (+1 nível por quadro) em cena vazia
  const det2 = new DetectorMovimento();
  let t2 = 0, est2 = 0;
  for (let k = 0; k < 60; k++, t2 += 100) det2.processar(quadro({ base: 40, gauss: g }), W, H, t2);
  for (let k = 0; k < 60; k++, t2 += 100) { const q = det2.processar(quadro({ base: 40 + k, gauss: g }), W, H, t2); est2 += q.estaticos.length; }
  assert.equal(est2, 0, 'entardecer/exposição automática não vira objeto');
});
