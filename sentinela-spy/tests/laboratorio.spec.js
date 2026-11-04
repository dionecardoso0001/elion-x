import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cosseno, novoConceito, adicionarExemplo, removerExemplo, calibrar, reconhecer, melhorConceito, exportar, importar, CFG_LAB,
} from '../js/laboratorio.js';

/* Vetores sintéticos de 64 dimensões: "fotos" de um mesmo lugar = um centro + ruído;
   lugares diferentes = centros diferentes. Gerador determinístico. */
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r = prng(42);
const unit = v => { const n = Math.hypot(...v); return v.map(x => x / n); };
const centro = () => unit(Array.from({ length: 64 }, () => r() * 2 - 1));
const foto = (c, ruido = 0.1) => unit(c.map(x => x + (r() * 2 - 1) * ruido));
const A = centro(), B = centro();

test('cosseno: idêntico 1, ortogonal 0, oposto −1', () => {
  assert.ok(Math.abs(cosseno([1, 0], [1, 0]) - 1) < 1e-12);
  assert.equal(cosseno([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(cosseno([1, 0], [-1, 0]) + 1) < 1e-12);
  assert.equal(cosseno([0, 0], [1, 0]), 0);
});

test('conceito: nome obrigatório, maiúsculo, tipo validado', () => {
  const c = novoConceito({ nome: '  almoxarifado\n', tipo: 'local' });
  assert.equal(c.nome, 'ALMOXARIFADO'); assert.equal(c.exemplos.length, 0);
  assert.throws(() => novoConceito({ nome: '' }), /nome/);
  assert.throws(() => novoConceito({ nome: 'x', tipo: 'outro' }), /tipo/);
});

test('com menos de 3 fotos a calibração diz "insuficiente" e usa o limiar padrão', () => {
  const c = novoConceito({ nome: 'sala' });
  adicionarExemplo(c, { vetor: foto(A) });
  adicionarExemplo(c, { vetor: foto(A) });
  const k = calibrar(c);
  assert.equal(k.qualidade, 'insuficiente'); assert.equal(k.limiar, CFG_LAB.limiarPadrao);
});

test('calibração: 8 fotos do local + 4 negativas → limiar entre as duas populações; reconhece o local e recusa o outro', () => {
  const c = novoConceito({ nome: 'subestação' });
  for (let i = 0; i < 8; i++) adicionarExemplo(c, { vetor: foto(A) });
  for (let i = 0; i < 4; i++) adicionarExemplo(c, { vetor: foto(B), rotulo: 'negativo' });
  const k = calibrar(c);
  assert.ok(k.simPositivos > k.simNegativos, JSON.stringify(k));
  assert.ok(k.limiar < k.simPositivos && k.limiar > k.simNegativos, JSON.stringify(k));
  assert.ok(['boa', 'otima'].includes(k.qualidade), k.qualidade);
  assert.equal(c.limiar, k.limiar, 'limiar aplicado ao conceito automaticamente');
  assert.equal(reconhecer(c, foto(A)).ok, true, 'foto nova do mesmo local');
  assert.equal(reconhecer(c, foto(B)).ok, false, 'outro local');
  // fotos muito ruidosas (outro ângulo, noite, chuva): a tela diz que a confiança é baixa
  const ruim = novoConceito({ nome: 'ruim' });
  for (let i = 0; i < 6; i++) adicionarExemplo(ruim, { vetor: foto(A, 0.5) });
  for (let i = 0; i < 4; i++) adicionarExemplo(ruim, { vetor: foto(A, 0.5), rotulo: 'negativo' });
  assert.equal(calibrar(ruim).qualidade, 'baixa', 'positivos e negativos indistinguíveis');
});

test('exemplo NEGATIVO veta mesmo acima do limiar (parecido, mas liberado) — é o "refinar" com falso alarme', () => {
  const c = novoConceito({ nome: 'cerca' });
  for (let i = 0; i < 5; i++) adicionarExemplo(c, { vetor: foto(A, 0.1) });
  const quaseA = foto(A, 0.3);
  c.limiar = 0.3; c.limiarManual = true;   // limiar frouxo de propósito
  assert.equal(reconhecer(c, quaseA).ok, true);
  adicionarExemplo(c, { vetor: quaseA, rotulo: 'negativo', origem: 'retorno' });
  assert.equal(reconhecer(c, quaseA).ok, false, 'o próprio falso alarme não dispara de novo');
  assert.equal(c.limiar, 0.3, 'limiar manual não é recalibrado');
  removerExemplo(c, c.exemplos.at(-1).id);
  assert.equal(reconhecer(c, quaseA).ok, true);
});

test('melhor conceito por tipo; teto de exemplos; vetor de tamanho diferente é recusado', () => {
  const l1 = novoConceito({ nome: 'L1', tipo: 'local' }), l2 = novoConceito({ nome: 'L2', tipo: 'local' }), cl = novoConceito({ nome: 'VEADO', tipo: 'classe' });
  for (let i = 0; i < 4; i++) { adicionarExemplo(l1, { vetor: foto(A) }); adicionarExemplo(l2, { vetor: foto(B) }); adicionarExemplo(cl, { vetor: foto(A) }); }
  assert.equal(melhorConceito([l1, l2, cl], foto(B), 'local').conceito.nome, 'L2');
  assert.equal(melhorConceito([l1, l2, cl], foto(A), 'classe').conceito.nome, 'VEADO');
  assert.equal(melhorConceito([l2], foto(A), 'local'), null);
  const t = novoConceito({ nome: 'teto' });
  for (let i = 0; i < CFG_LAB.maxExemplos + 5; i++) adicionarExemplo(t, { vetor: foto(A) });
  assert.equal(t.exemplos.length, CFG_LAB.maxExemplos);
  assert.throws(() => adicionarExemplo(t, { vetor: [1, 2, 3] }), /tamanho diferente/);
});

test('exportar/importar: ida e volta preserva o reconhecimento; arquivo estranho ou de outro modelo é recusado', () => {
  const c = novoConceito({ nome: 'galpão' });
  for (let i = 0; i < 5; i++) adicionarExemplo(c, { vetor: foto(A), miniatura: 'data:image/jpeg;base64,AAAA' });
  const json = JSON.parse(JSON.stringify(exportar([c], 'mobilenet_v3_large')));
  const [volta] = importar(json, 'mobilenet_v3_large');
  assert.equal(volta.nome, 'GALPÃO'); assert.equal(volta.exemplos.length, 5);
  assert.equal(reconhecer(volta, foto(A)).ok, true);
  assert.throws(() => importar({ formato: 'outro' }), /não é um arquivo/);
  assert.throws(() => importar({ ...json, modelo: 'outro_modelo' }, 'mobilenet_v3_large'), /outro modelo/);
  assert.throws(() => importar({ ...json, conceitos: [{ nome: 'x', tipo: 'local', exemplos: [{ vetor: ['a'] }] }] }), /inválido/);
  const sujo = importar({ ...json, conceitos: [{ nome: 'x', tipo: 'local', exemplos: [{ vetor: foto(A), miniatura: 'javascript:alert(1)' }] }] });
  assert.equal(sujo[0].exemplos[0].miniatura, null, 'miniatura que não é imagem base64 é descartada');
});
