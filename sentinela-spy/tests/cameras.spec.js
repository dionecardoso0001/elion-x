import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nomeCamera, selecionaveis, nomesLiberados, opcoesCameras, resumoCameras,
  diferencaCameras, proximaCamera, explicarErroCamera,
} from '../js/cameras.js';

const cam = (deviceId, label = '') => ({ kind: 'videoinput', deviceId, label, groupId: 'g' });
const integrada = cam('id-int', 'Integrated Webcam (0bda:5634)');
const mx = cam('id-mx', 'MX Brio (046d:0944)');

test('nome: tira o sufixo VID:PID do USB que o Chrome põe no Windows; sem rótulo vira "Câmera N"', () => {
  assert.equal(nomeCamera(mx, 1), 'MX Brio');
  assert.equal(nomeCamera(integrada, 0), 'Integrated Webcam');
  assert.equal(nomeCamera(cam('x'), 2), 'Câmera 3');
  assert.equal(nomeCamera(cam('y', 'OBS Virtual Camera'), 0), 'OBS Virtual Camera', 'sem sufixo, o nome fica intacto');
});

test('selecionáveis: descarta microfone e entrada sem deviceId (Safari/Firefox antes da permissão)', () => {
  const lista = [integrada, { kind: 'audioinput', deviceId: 'mic', label: 'Mic' }, cam(''), mx];
  assert.deepEqual(selecionaveis(lista).map(c => c.deviceId), ['id-int', 'id-mx']);
  assert.equal(nomesLiberados([cam('a'), cam('b')]), false);
  assert.equal(nomesLiberados([integrada, mx]), true);
});

test('opções: a automática diz qual câmera está ativa e a ativa é marcada — as duas câmeras aparecem', () => {
  const ops = opcoesCameras([integrada, mx], { ativaId: 'id-mx' });
  assert.deepEqual(ops.map(o => o.valor), ['', 'id-int', 'id-mx']);
  assert.equal(ops[0].texto, 'automática — MX Brio');
  assert.equal(ops[2].texto, 'MX Brio ● em uso');
  assert.equal(ops[1].texto, 'Integrated Webcam');
  assert.equal(opcoesCameras([], {})[0].texto, 'automática (padrão da missão)');
  const manual = opcoesCameras([integrada, mx], { ativaId: 'id-mx', escolhidaId: 'id-mx' });
  assert.equal(manual[0].texto, 'automática (padrão da missão)', 'escolha manual: a automática não finge ser a câmera ativa');
});

test('resumo: conta e nomeia; avisa quando os nomes ainda não foram liberados; nenhuma câmera', () => {
  assert.equal(resumoCameras([integrada, mx]), '2 câmera(s) detectada(s): Integrated Webcam · MX Brio');
  assert.match(resumoCameras([cam('a'), cam('b')]), /^2 câmera\(s\).*depois que a câmera for liberada/);
  assert.match(resumoCameras([{ kind: 'videoinput', deviceId: '', label: '' }]), /^1 câmera/);
  assert.match(resumoCameras([]), /Nenhuma câmera/);
});

test('diferença: câmera USB plugada e removida entre duas leituras', () => {
  const { entraram, sairam } = diferencaCameras([integrada], [integrada, mx]);
  assert.deepEqual(entraram.map(c => c.deviceId), ['id-mx']);
  assert.equal(sairam.length, 0);
  const d2 = diferencaCameras([integrada, mx], [integrada]);
  assert.deepEqual(d2.sairam.map(c => c.deviceId), ['id-mx']);
  assert.equal(d2.entraram.length, 0);
});

test('próxima câmera: ciclo pela lista; com uma câmera só, não há troca', () => {
  assert.equal(proximaCamera([integrada, mx], 'id-int'), 'id-mx');
  assert.equal(proximaCamera([integrada, mx], 'id-mx'), 'id-int');
  assert.equal(proximaCamera([integrada, mx], 'desconhecida'), 'id-int', 'ativa fora da lista: começa pela primeira');
  assert.equal(proximaCamera([integrada], 'id-int'), null);
});

test('erros de câmera viram instrução: em uso por outro programa, permissão, ausente, desconectada', () => {
  assert.match(explicarErroCamera({ name: 'NotReadableError' }, 'MX Brio'), /"MX Brio" está em uso por outro programa/);
  assert.match(explicarErroCamera({ name: 'NotAllowedError' }), /Permissão de câmera negada/);
  assert.match(explicarErroCamera({ name: 'NotFoundError' }), /Nenhuma câmera encontrada/);
  assert.match(explicarErroCamera({ name: 'OverconstrainedError' }, 'MX Brio'), /não está mais disponível/);
  assert.match(explicarErroCamera({ name: 'Outro', message: 'falhou' }), /não abriu: falhou/);
});
