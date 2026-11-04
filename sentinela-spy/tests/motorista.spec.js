import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AnalisadorMotorista, poseDaCabeca, ear, mar, celularJuntoAoRosto,
  OLHO_DIREITO, OLHO_ESQUERDO,
} from '../js/motorista.js';

const ASPECTO = 16 / 9;
const rad = g => (g * Math.PI) / 180;

/**
 * Rosto sintético: pontos canônicos 3D (unidades de altura de quadro)
 * girados por rolagem → arfagem → guinada e projetados como o MediaPipe
 * entrega (x/aspecto, y, z/aspecto). Só os índices que o analisador lê
 * recebem posição; o resto fica no centro da cabeça.
 */
function rosto({ yaw = 0, pitch = 0, roll = 0, earAlvo = 0.3, marAlvo = 0.1, blink = 0.05, jaw = 0.05 } = {}) {
  const hO = earAlvo / 50;          // EAR = 4h / (2 · 0,04) = 50·h
  const m = (marAlvo * 0.05) / 2;   // MAR = 2m / 0,05
  const P = {
    10: [0, -0.11, -0.01], 152: [0, 0.11, -0.01], 234: [-0.075, 0, 0.03], 454: [0.075, 0, 0.03], 1: [0, 0.01, -0.05],
    // olho direito do sujeito (esquerda da imagem): 33 externo, 133 interno
    33: [-0.065, -0.03, 0], 160: [-0.052, -0.03 - hO, 0], 158: [-0.038, -0.03 - hO, 0],
    133: [-0.025, -0.03, 0], 153: [-0.038, -0.03 + hO, 0], 144: [-0.052, -0.03 + hO, 0],
    // olho esquerdo: 362 interno, 263 externo
    362: [0.025, -0.03, 0], 385: [0.038, -0.03 - hO, 0], 387: [0.052, -0.03 - hO, 0],
    263: [0.065, -0.03, 0], 373: [0.052, -0.03 + hO, 0], 380: [0.038, -0.03 + hO, 0],
    13: [0, 0.06 - m, -0.02], 14: [0, 0.06 + m, -0.02], 61: [-0.025, 0.06, -0.01], 291: [0.025, 0.06, -0.01],
  };
  const gira = ([x, y, z]) => {
    let c = Math.cos(rad(roll)), s = Math.sin(rad(roll));
    [x, y] = [x * c - y * s, x * s + y * c];
    c = Math.cos(rad(pitch)); s = Math.sin(rad(pitch));
    [y, z] = [y * c - z * s, y * s + z * c];
    c = Math.cos(rad(yaw)); s = Math.sin(rad(yaw));
    [x, z] = [x * c - z * s, x * s + z * c];
    return [x, y, z];
  };
  const pontos = Array.from({ length: 478 }, (_, i) => {
    const [x, y, z] = gira(P[i] || [0, 0, 0]);
    return { x: 0.5 + x / ASPECTO, y: 0.5 + y, z: z / ASPECTO };
  });
  return { pontos, blend: { eyeBlinkLeft: blink, eyeBlinkRight: blink, jawOpen: jaw } };
}

const perto = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a.toFixed(3)} ≉ ${b} (±${tol})`);

test('pose da cabeça: cada eixo isolado é recuperado com sinal correto', () => {
  const f = poseDaCabeca(rosto().pontos, ASPECTO);
  perto(f.yaw, 0, 1e-6); perto(f.pitch, 0, 1e-6); perto(f.roll, 0, 1e-6);
  perto(poseDaCabeca(rosto({ yaw: 25 }).pontos, ASPECTO).yaw, 25, 0.5);
  perto(poseDaCabeca(rosto({ yaw: -35 }).pontos, ASPECTO).yaw, -35, 0.5);
  perto(poseDaCabeca(rosto({ pitch: 15 }).pontos, ASPECTO).pitch, 15, 0.5);   // positivo = olhando para BAIXO
  perto(poseDaCabeca(rosto({ pitch: -12 }).pontos, ASPECTO).pitch, -12, 0.5);
  perto(poseDaCabeca(rosto({ roll: 10 }).pontos, ASPECTO).roll, 10, 0.5);
});

test('pose da cabeça: eixos combinados continuam dentro de ±1,5°', () => {
  const p = poseDaCabeca(rosto({ yaw: 20, pitch: 10, roll: 5 }).pontos, ASPECTO);
  perto(p.yaw, 20, 1.5); perto(p.pitch, 10, 1.5); perto(p.roll, 5, 1.5);
});

test('EAR e MAR do rosto sintético batem com o valor construído', () => {
  const { pontos } = rosto({ earAlvo: 0.3, marAlvo: 0.4 });
  perto(ear(pontos, OLHO_DIREITO, ASPECTO), 0.3, 1e-6);
  perto(ear(pontos, OLHO_ESQUERDO, ASPECTO), 0.3, 1e-6);
  perto(mar(pontos, ASPECTO), 0.4, 1e-6);
});

/** Roda o analisador a 30 quadros/s e devolve a última saída e o instante final. */
function rodar(a, t0, ms, gerar, extra = {}) {
  let r, t = t0;
  for (const fim = t0 + ms; t < fim; t += 33) r = a.processar({ t, rosto: gerar(t), aspecto: ASPECTO, ...extra });
  return { r, t };
}
function calibrado(extra) {
  const a = new AnalisadorMotorista();
  const { t, r } = rodar(a, 0, 6000, () => rosto(), extra);
  assert.equal(r.metricas.calibrando, false, 'calibração deveria ter concluído em 6 s');
  return { a, t };
}
const tem = (r, chave, nivel) => r.condicoes.some(c => c.chave === chave && (!nivel || c.nivel === nivel));

test('calibração: nenhuma condição é levantada antes da linha de base', () => {
  const a = new AnalisadorMotorista();
  const { r } = rodar(a, 0, 3000, () => rosto({ earAlvo: 0.03, blink: 0.98 }));
  assert.equal(r.metricas.calibrando, true);
  assert.equal(r.condicoes.length, 0);
});

test('microssono: olhos fechados por 1,5 s → CRÍTICO; com GPS parado → só aviso', () => {
  let { a, t } = calibrado();
  let { r } = rodar(a, t, 1500, () => rosto({ earAlvo: 0.05, blink: 0.95 }));
  assert.ok(tem(r, 'microssono', 'critico'), JSON.stringify(r.condicoes));

  ({ a, t } = calibrado({ velocidade: 0 }));
  ({ r } = rodar(a, t, 1500, () => rosto({ earAlvo: 0.05, blink: 0.95 }), { velocidade: 0 }));
  assert.ok(tem(r, 'microssono', 'aviso'), 'parado não dispara sirene');
});

test('PERCLOS P80 conta fechamentos lentos e IGNORA piscadas', () => {
  const { a, t } = calibrado();
  // ciclo de 6 s: 0,6 s fechado (lento) + 0,2 s de piscada no meio → PERCLOS ≈ 0,6/6 = 10%
  const gerar = tt => {
    const fase = (tt - t) % 6000;
    const fechado = fase < 600 || (fase >= 3000 && fase < 3200);
    return fechado ? rosto({ earAlvo: 0.04, blink: 0.95 }) : rosto();
  };
  const { r } = rodar(a, t, 66000, gerar);
  perto(r.metricas.perclos, 0.10, 0.015);
  assert.ok(tem(r, 'fadiga', 'aviso'), 'PERCLOS 10% ≥ 8% → aviso');
  assert.ok(!tem(r, 'fadiga', 'critico'), 'abaixo de 12% não é crítico');
  assert.ok(r.metricas.piscadasMin >= 9, `as piscadas de 0,2 s foram contadas como piscadas (${r.metricas.piscadasMin})`);
});

test('distração: guinada de 40° → aviso aos 2 s e crítico aos 4 s', () => {
  let { a, t } = calibrado();
  let { r, t: t2 } = rodar(a, t, 2500, () => rosto({ yaw: 40 }));
  assert.ok(tem(r, 'distracao', 'aviso'));
  ({ r } = rodar(a, t2, 2000, () => rosto({ yaw: 40 })));
  assert.ok(tem(r, 'distracao', 'critico'));
});

test('cabeça pendendo com olhos fechando → crítico', () => {
  const { a, t } = calibrado();
  const { r } = rodar(a, t, 1600, () => rosto({ pitch: 28, earAlvo: 0.08, blink: 0.7 }));
  assert.ok(tem(r, 'pendendo', 'critico'), JSON.stringify(r.condicoes.map(c => c.chave)));
});

test('postura anormal imóvel (cabeça tombada 40°) → possível mal súbito', () => {
  const { a, t } = calibrado();
  const { r } = rodar(a, t, 3500, () => rosto({ roll: 40 }));
  assert.ok(tem(r, 'mal_subito', 'critico'));
});

test('motorista some do quadro depois de estar presente → crítico', () => {
  const { a, t } = calibrado();
  let r;
  for (let tt = t; tt < t + 3600; tt += 33) r = a.processar({ t: tt, rosto: null, aspecto: ASPECTO });
  assert.ok(tem(r, 'ausente', 'critico'));
});

test('bocejos: 3 bocejos de 1,5 s em 5 min → aviso', () => {
  const { a, t } = calibrado();
  const gerar = tt => ((tt - t) % 10000 < 1500 ? rosto({ jaw: 0.8, marAlvo: 0.8 }) : rosto());
  const { r } = rodar(a, t, 30000, gerar);
  assert.equal(r.metricas.bocejos5min, 3);
  assert.ok(tem(r, 'bocejos', 'aviso'));
});

test('celular só conta perto do rosto', () => {
  const { pontos } = rosto();
  assert.equal(celularJuntoAoRosto([{ classe: 'cell phone', score: 0.8, x: 0.58, y: 0.55, w: 0.04, h: 0.08 }], pontos), true);
  assert.equal(celularJuntoAoRosto([{ classe: 'cell phone', score: 0.8, x: 0.02, y: 0.05, w: 0.04, h: 0.08 }], pontos), false);
  assert.equal(celularJuntoAoRosto([{ classe: 'cup', score: 0.9, x: 0.58, y: 0.55, w: 0.04, h: 0.08 }], pontos), false);
});

/* ── mãos pelo esqueleto: gatilhos da checagem de saúde ── */
import { maoNosOlhos, maoNoPeito, pontosDasMaos } from '../js/motorista.js';

/** Esqueleto de 33 pontos de um condutor de frente: olhos, ombros, quadris e as duas mãos. */
function esqueleto({ maoE = { x: 0.38, y: 0.97 }, maoD = { x: 0.62, y: 0.97 } } = {}) {
  const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.05 }));
  const por = (i, x, y, v = 0.95) => { p[i] = { x, y, z: 0, visibility: v }; };
  por(0, 0.5, 0.31); por(2, 0.47, 0.28); por(5, 0.53, 0.28);
  por(11, 0.40, 0.50); por(12, 0.60, 0.50); por(23, 0.42, 0.90); por(24, 0.58, 0.90);
  const mao = (base, c) => { por(base[0], c.x, c.y); por(base[1], c.x + 0.012, c.y + 0.012); por(base[2], c.x + 0.01, c.y - 0.015); por(base[3], c.x - 0.012, c.y - 0.01); };
  mao([15, 17, 19, 21], maoE); mao([16, 18, 20, 22], maoD);
  return p;
}
const ASP = 16 / 9;

test('mão no PEITO: centro do peito sim; volante, lateral (cinto) e ombro não', () => {
  assert.equal(maoNoPeito(esqueleto({ maoD: { x: 0.50, y: 0.64 } }), ASP), true);
  assert.equal(maoNoPeito(esqueleto(), ASP), false, 'mãos no volante (abaixo do peito)');
  assert.equal(maoNoPeito(esqueleto({ maoD: { x: 0.41, y: 0.64 } }), ASP), false, 'na lateral, onde passa o cinto');
  assert.equal(maoNoPeito(esqueleto({ maoD: { x: 0.50, y: 0.51 } }), ASP), false, 'na linha dos ombros (coçando o pescoço)');
  const semOmbro = esqueleto({ maoD: { x: 0.50, y: 0.64 } }); semOmbro[11].visibility = 0.1;
  assert.equal(maoNoPeito(semOmbro, ASP), false, 'sem ombros visíveis não há régua');
});

test('mão nos OLHOS: sobre o olho sim; no queixo/boca e no volante não; funciona sem malha facial (olhos da pose)', () => {
  assert.equal(maoNosOlhos(esqueleto({ maoD: { x: 0.47, y: 0.285 } }), null, ASP), true);
  assert.equal(maoNosOlhos(esqueleto({ maoD: { x: 0.50, y: 0.37 } }), null, ASP), false, 'mão no queixo');
  assert.equal(maoNosOlhos(esqueleto(), null, ASP), false);
  assert.equal(pontosDasMaos(esqueleto(), ASP).length, 2);
});

test('analisador: mão no peito 2,5 s → MÃO NO PEITO crítico em movimento + gatilho da checagem; piscada da pose não zera', () => {
  const a = new AnalisadorMotorista();
  let r;
  for (let t = 0; t <= 3200; t += 100) {
    const piscou = t >= 1500 && t < 1800;   // pose perdeu a mão por 0,3 s
    r = a.processar({ t, rosto: null, aspecto: ASP, esqueleto: esqueleto(piscou ? {} : { maoD: { x: 0.50, y: 0.64 } }) });
  }
  const c = r.condicoes.find(x => x.chave === 'mao_peito');
  assert.ok(c, JSON.stringify(r.condicoes));
  assert.equal(c.nivel, 'critico');
  assert.equal(r.metricas.checagem, 'mao_peito');
  assert.ok(r.metricas.maoPeitoS >= 3);
  // mão sai por 1 s → zera
  for (let t = 3300; t <= 4400; t += 100) r = a.processar({ t, rosto: null, aspecto: ASP, esqueleto: esqueleto() });
  assert.equal(r.metricas.maoPeitoS, 0);
  assert.ok(!r.condicoes.some(x => x.chave === 'mao_peito'));
});

test('analisador: mão nos olhos > 3 s → aviso + gatilho; > 5 s em movimento → crítico; parado (GPS) fica aviso', () => {
  const rodar = (ate, velocidade = null) => {
    const a = new AnalisadorMotorista();
    let r;
    for (let t = 0; t <= ate; t += 100) r = a.processar({ t, rosto: null, aspecto: ASP, velocidade, esqueleto: esqueleto({ maoD: { x: 0.47, y: 0.285 } }) });
    return r;
  };
  let r = rodar(2800);
  assert.ok(!r.condicoes.some(x => x.chave === 'mao_olhos'), 'menos de 3 s não conta');
  r = rodar(3300);
  assert.equal(r.condicoes.find(x => x.chave === 'mao_olhos').nivel, 'aviso');
  assert.equal(r.metricas.checagem, 'mao_olhos');
  r = rodar(5300);
  assert.equal(r.condicoes.find(x => x.chave === 'mao_olhos').nivel, 'critico');
  r = rodar(5300, 0);   // GPS diz parado
  assert.equal(r.condicoes.find(x => x.chave === 'mao_olhos').nivel, 'aviso');
});

test('sem rosto no escuro: o alerta explica a pouca luz e NÃO dispara checagem de saúde (limite do sensor)', () => {
  const a = new AnalisadorMotorista();
  a.calib.pronta = true; a.tempoPresente = 5000; a.ultimaPresenca = 0;
  const r = a.processar({ t: 4000, rosto: null, aspecto: ASP, escuro: true });
  const c = r.condicoes.find(x => x.chave === 'ausente');
  assert.match(c.detalhe, /pouca luz/);
  assert.equal(r.metricas.checagem, null);
  const b = new AnalisadorMotorista();
  b.calib.pronta = true; b.tempoPresente = 5000; b.ultimaPresenca = 0;
  assert.equal(b.processar({ t: 4000, rosto: null, aspecto: ASP, escuro: false }).metricas.checagem, 'ausente');
});
