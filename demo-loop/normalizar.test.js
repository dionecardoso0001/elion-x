import test from 'node:test';
import assert from 'node:assert';
import { normalizarNumero } from './normalizar.js';

test('AC1: remove tudo que nao e digito', () => {
  assert.strictEqual(normalizarNumero('(13) 99999-8888'), '13999998888');
});

test('AC2: preserva o codigo do pais', () => {
  assert.strictEqual(normalizarNumero('+55 13 99999-8888'), '5513999998888');
});

test('AC3: vazio ou null vira string vazia', () => {
  assert.strictEqual(normalizarNumero(''), '');
  assert.strictEqual(normalizarNumero(null), '');
});
