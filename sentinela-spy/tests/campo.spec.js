import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMIARES, PERFIS, limiaresEfetivos } from '../js/config.js';
import { GravadorCampo, compactar } from '../js/gravador.js';
import { avaliarSessao, formatarRelatorio, wilson, percentil } from '../js/avaliacao.js';

const perto = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);
const BASE = { motorista: 'motorista', transito: 'transito', sentinela: 'vigilancia' };

test('perfis: toda chave sobrescrita existe nos limiares-base (erro de digitação não passa calado)', () => {
  for (const [nome, perfil] of Object.entries(PERFIS))
    for (const [grupo, sobre] of Object.entries(perfil))
      for (const k of Object.keys(sobre))
        assert.ok(k in LIMIARES[grupo], `perfil ${nome}.${grupo}.${k} não existe em LIMIARES.${grupo}`);
});

test('perfis: pisos de segurança valem em todos os perfis', () => {
  for (const perfil of Object.keys(PERFIS)) {
    const t = limiaresEfetivos('transito', perfil), m = limiaresEfetivos('motorista', perfil);
    assert.ok(t.ttcCriticoS >= LIMIARES.transito.ttcCriticoS, `${perfil}: crítico de colisão não pode ficar abaixo do derivado da NHTSA`);
    assert.ok(m.microssonoS <= 1.5, `${perfil}: microssono não pode passar de 1,5 s`);
    assert.ok(m.perclosCritico <= 0.15, `${perfil}: PERCLOS crítico não pode passar de 15%`);
  }
  assert.equal(limiaresEfetivos('transito', 'sensivel').ttcCriticoS, 3.0);
  assert.equal(limiaresEfetivos('motorista', 'sensivel').microssonoS, 0.8);
  assert.equal(limiaresEfetivos('motorista', 'conservador').perclosAviso, 0.10);
  assert.equal(limiaresEfetivos('sentinela', 'padrao', { demo: true }).abandonoS, 8, 'preset de demonstração compõe com o perfil');
  assert.equal(limiaresEfetivos('sentinela', 'padrao').abandonoS, 30);
  for (const modo of Object.keys(BASE)) assert.deepEqual(limiaresEfetivos(modo, 'inexistente'), limiaresEfetivos(modo, 'padrao'));
});

test('Wilson 95%: confere com o valor de referência 5/6 → (0,436; 0,970)', () => {
  const w = wilson(5, 6);
  perto(w.p, 0.8333, 1e-4); perto(w.inf, 0.436, 0.002); perto(w.sup, 0.970, 0.002);
  assert.equal(wilson(0, 0), null);
  assert.ok(wilson(0, 10).inf === 0 && wilson(10, 10).sup === 1);
  assert.equal(percentil([1, 2, 3, 4, 5], 0.5), 3);
  perto(percentil([0, 10], 0.95), 9.5, 1e-9);
});

test('gravador: cabeçalho com limiares, amostragem a 10 Hz e linha final', () => {
  const g = new GravadorCampo();
  const lim = limiaresEfetivos('motorista', 'padrao');
  g.iniciar({ t: 1000, modo: 'motorista', perfil: 'padrao', limiares: lim, dispositivo: { backend: 'CPU' } });
  for (let t = 1000; t < 2000; t += 33) g.amostra(t, { presente: true, calibrando: false, ear: 0.2812345, perclos: 0.01, yaw: -3.21 });
  assert.ok(g.contagem.amostras >= 9 && g.contagem.amostras <= 11, `~10 amostras em 1 s, veio ${g.contagem.amostras}`);
  const linhas = g.parar(2000).trim().split('\n').map(l => JSON.parse(l));
  assert.equal(linhas[0].tipo, 'cabecalho');
  assert.equal(linhas[0].limiares.microssonoS, lim.microssonoS);
  assert.equal(linhas[1].m.ear, 0.281, 'métricas arredondadas a 3 casas');
  assert.equal(linhas[linhas.length - 1].tipo, 'fim');
  assert.equal(g.ativo, false);
});

test('gravador: anotação "falso alarme" aponta o alerta mais recente; privacidade por construção', () => {
  const g = new GravadorCampo();
  g.iniciar({ t: 0, modo: 'motorista', perfil: 'padrao', limiares: {} });
  g.condicao(5000, { chave: 'distracao', nivel: 'aviso', titulo: 'OLHAR FORA DA VIA' }, 'inicio');
  const a = g.anotacao(7000, 'falso_alarme');
  assert.equal(a.alvo, 'distracao'); assert.equal(a.alvo_ha_ms, 2000);
  assert.equal(g.anotacao(7100, 'inventado'), null, 'rótulo fora da lista é recusado');
  // compactar descarta pontos faciais e qualquer campo não previsto
  const c = compactar('motorista', { presente: true, ear: 0.3, pontos: [{ x: 1 }], blend: { a: 1 }, nome: 'Fulano' });
  assert.equal(JSON.stringify(c).includes('pontos'), false);
  assert.equal(JSON.stringify(c).includes('Fulano'), false);
});

test('gravador: alerta já ativo ao iniciar entra marcado e recebe anotação', () => {
  const g = new GravadorCampo();
  g.iniciar({ t: 100, modo: 'transito', perfil: 'padrao', limiares: {} });
  g.condicao(100, { chave: 'animal:4', grupo: 'animal', nivel: 'critico', titulo: 'ANIMAL NA PISTA' }, 'inicio', { pre_existente: true });
  g.anotacao(2100, 'falso_alarme');
  const rel = avaliarSessao(g.parar(4100));
  assert.equal(rel.alertas.total, 1);
  assert.equal(rel.rotulos.fp, 1, 'o falso alarme se vincula ao alerta que já soava');
  assert.match(g.exportar(), /"pre_existente":true/);
});

test('gravador: teto de linhas trunca e registra que truncou', () => {
  const g = new GravadorCampo({ maxLinhas: 5 });
  g.iniciar({ t: 0, modo: 'sentinela', perfil: 'padrao', limiares: {} });
  for (let t = 0; t < 2000; t += 100) g.amostra(t, { pessoas: 1 });
  assert.equal(g.cheio, true);
  const ult = JSON.parse(g.parar(2000).trim().split('\n').pop());
  assert.equal(ult.tipo, 'fim'); assert.equal(ult.truncado, true);
});

/** Sessão sintética de 10 min com rótulos conhecidos. */
function sessaoSintetica() {
  const g = new GravadorCampo();
  g.iniciar({ t: 0, modo: 'motorista', perfil: 'padrao', limiares: limiaresEfetivos('motorista') });
  const c = (t, chave, nivel, fase) => g.condicao(t, { chave, nivel, titulo: chave.toUpperCase() }, fase);
  for (let t = 0; t <= 600000; t += 100) {
    if (t === 60000) c(t, 'distracao', 'aviso', 'inicio');
    if (t === 62000) c(t, 'distracao', 'critico', 'inicio');   // escalada do MESMO alerta
    if (t === 65000) c(t, 'distracao', 'critico', 'fim');
    if (t === 66000) g.anotacao(t, 'falso_alarme');
    if (t === 120000) c(t, 'fadiga', 'aviso', 'inicio');
    if (t === 125000) g.anotacao(t, 'verdadeiro');
    if (t === 180000) c(t, 'fadiga', 'aviso', 'fim');
    if (t === 299000) g.anotacao(t, 'marca');                  // teste dirigido: fechar os olhos
    if (t === 300000) c(t, 'microssono', 'critico', 'inicio');
    if (t === 302000) c(t, 'microssono', 'critico', 'fim');
    if (t === 400000) c(t, 'celular', 'aviso', 'inicio');
    if (t === 405000) c(t, 'celular', 'aviso', 'fim');
    if (t === 500000) g.anotacao(t, 'perdeu', 'bocejo não detectado');
    if (t === 550000) g.anotacao(t, 'marca');                  // marca sem alerta = evento perdido
    const presente = !(t >= 200000 && t < 260000);             // 1 min fora de quadro
    g.amostra(t, { presente, calibrando: false, ear: 0.28, fechamento: 0.1, perclos: 0.02, yaw: 0, pitch: 0, roll: 0 });
  }
  return g.parar(600000);
}

test('avaliação: alarmes/hora, escalada, precisão, revocação, latência e cobertura', () => {
  const rel = avaliarSessao(sessaoSintetica());
  perto(rel.sessao.duracaoMin, 10, 1e-9);
  assert.equal(rel.alertas.total, 4, 'a escalada não conta como alerta novo');
  assert.equal(rel.alertas.criticos, 2);
  perto(rel.alertas.porHora, 24, 1e-9);
  assert.equal(rel.alertas.porTipo.distracao.critico, 1);
  assert.equal(rel.alertas.porTipo.distracao.fp, 1);
  assert.deepEqual([rel.rotulos.vp, rel.rotulos.fp, rel.rotulos.fn], [2, 1, 2]);
  perto(rel.rotulos.precisao.p, 2 / 3, 1e-9);
  perto(rel.rotulos.revocacao.p, 2 / 4, 1e-9);
  assert.equal(rel.latencia.n, 1); perto(rel.latencia.medianaS, 1.0, 1e-9);
  perto(rel.sessao.cobertura, 1 - 600 / 6001, 1e-3);
  assert.ok(rel.recomendacoes.some(r => /fadiga de alarme/.test(r)), '12 críticos/h em 10 min devem acender o alerta');
  assert.ok(rel.recomendacoes.some(r => /evento\(s\) perdido/.test(r)));
  assert.ok(rel.recomendacoes.some(r => /Poucos alertas rotulados/.test(r)));
  const txt = formatarRelatorio(rel);
  assert.match(txt, /precisão +67% \(IC95%/);
  assert.match(txt, /LATÊNCIA \(testes dirigidos, n=1\): mediana 1\.00 s/);
});

test('avaliação tolera linha corrompida e sessão vazia', () => {
  const rel = avaliarSessao('{"tipo":"cabecalho","modo":"transito"}\nisto não é json\n');
  assert.equal(rel.sessao.corrompidas, 1);
  assert.equal(rel.alertas.total, 0);
  assert.ok(rel.recomendacoes.length >= 1);
});
