import test from 'node:test';
import assert from 'node:assert/strict';
import { Rastreador } from '../../assets/sentinela/rastreador.js';

const det = (classe, x, y, w = 0.1, h = 0.2, score = 0.9) => ({ classe, score, x, y, w, h });

test('alvo em movimento mantém a mesma identidade e ganha velocidade', () => {
  const r = new Rastreador();
  let id = null;
  for (let k = 0; k < 20; k++) {
    const tr = r.atualizar([det('person', 0.1 + k * 0.01, 0.3)], k * 66);
    assert.equal(tr.length, 1);
    if (id == null) id = tr[0].id; else assert.equal(tr[0].id, id, `quadro ${k}`);
  }
  const t = r.trilhas[0];
  assert.ok(t.vx > 0.1 && t.vx < 0.2, `vx ≈ 0,15/s, veio ${t.vx}`);   // 0,01 a cada 66 ms ≈ 0,15/s
  assert.equal(t.estatico, false);
});

test('dois alvos próximos não trocam de identidade', () => {
  const r = new Rastreador();
  let ids;
  for (let k = 0; k < 15; k++) {
    const tr = r.atualizar([det('person', 0.2 + k * 0.005, 0.3), det('person', 0.6 - k * 0.005, 0.3)], k * 66);
    const ord = [...tr].sort((a, b) => a.x - b.x).map(t => t.id);
    if (!ids) ids = ord; else assert.deepEqual(ord, ids);
  }
});

test('trilha perdida expira após o TTL (cadência de 15 quadros/s); detecção fraca não nasce', () => {
  const r = new Rastreador({ ttlMs: 500 });
  let t = 0;
  for (; t <= 264; t += 66) r.atualizar([det('car', 0.4, 0.5)], t);   // visto pela última vez em 264 ms
  for (; t <= 726; t += 66) r.atualizar([], t);
  assert.equal(r.trilhas.length, 1, '462 ms sem detecção: ainda dentro do TTL de 500 ms');
  for (; t <= 858; t += 66) r.atualizar([], t);
  assert.equal(r.trilhas.length, 0, '594 ms sem detecção: expirou');
  r.atualizar([det('car', 0.4, 0.5, 0.1, 0.1, 0.3)], t);
  assert.equal(r.trilhas.length, 0, 'score 0,3 < limiar de nascimento');
});

test('oscilação carro↔caminhão no mesmo veículo não parte a trilha', () => {
  const r = new Rastreador();
  const classes = ['car', 'truck', 'car', 'bus', 'car'];
  const ids = classes.map((c, k) => r.atualizar([det(c, 0.4, 0.5, 0.2, 0.15)], k * 66)[0].id);
  assert.equal(new Set(ids).size, 1);
});

test('objeto parado vira ESTÁTICO após a janela e ganha sobrevida maior', () => {
  const r = new Rastreador({ estaticoJanelaMs: 2000, ttlMs: 500, ttlEstaticoMs: 4000 });
  let t = 0;
  for (; t <= 3000; t += 100) r.atualizar([det('backpack', 0.5 + (t % 200 ? 0.001 : 0), 0.7, 0.05, 0.06)], t);
  assert.equal(r.trilhas[0].estatico, true);
  assert.ok(r.trilhas[0].estaticoDesde <= 1000 + 100);
  r.atualizar([], t + 2000);   // 2 s sem detecção: um alvo comum já teria expirado
  assert.equal(r.trilhas.length, 1, 'estático sobrevive à "piscada" do detector');
});

test('aparelho lento (1 detecção a cada 1,5 s): UMA falha do detector não troca a identidade', () => {
  // a 30 quadros/s o TTL de 1,2 s tolera ~36 falhas seguidas; a 0,7 quadro/s
  // não tolera nenhuma — o TTL precisa acompanhar a cadência real
  const r = new Rastreador({ ttlMs: 1200 });
  const ids = new Set();
  for (let k = 0; k < 8; k++) {
    const falha = k === 3 || k === 6;
    const tr = r.atualizar(falha ? [] : [det('person', 0.3, 0.3)], k * 1500);
    if (!falha) ids.add(tr[0].id);
  }
  assert.equal(ids.size, 1, 'mesma identidade apesar das falhas isoladas');
  assert.equal(r.trilhas[0].hits, 6);
});

test('TTL adaptativo não prende alvo que realmente saiu da cena', () => {
  const r = new Rastreador({ ttlMs: 1200 });
  for (let k = 0; k < 5; k++) r.atualizar([det('person', 0.3, 0.3)], k * 100);   // cadência rápida
  r.atualizar([], 400 + 1300);
  assert.equal(r.trilhas.length, 0, 'em cadência rápida o TTL continua de 1,2 s');
});

test('alvo rápido que pula a caixa prevista é resgatado pela distância entre centros', () => {
  const r = new Rastreador();
  r.atualizar([det('person', 0.10, 0.3, 0.05, 0.2)], 0);
  // salto de 0,06 com caixa de 0,05 de largura: IoU = 0, mas centro próximo
  const tr = r.atualizar([det('person', 0.16, 0.3, 0.05, 0.2)], 200);
  assert.equal(tr.length, 1);
  assert.equal(tr[0].id, 1);
});
