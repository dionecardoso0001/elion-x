import test from 'node:test';
import assert from 'node:assert/strict';
import { RegistroIncidentes } from '../js/spy/incidentes.js';

test('registro em memória: ordem, janela, filtro, parecer, resumo sem imagem e exportação', async () => {
  const r = new RegistroIncidentes({ indexedDB: null });
  assert.equal(await r.abrir(), false, 'sem IndexedDB fica em memória e diz isso');
  let avisos = 0;
  r.aoMudar(() => avisos++);
  const base = Date.parse('2026-11-04T10:00:00Z');
  const a = r.registrar({ em: base, modo: 'sentinela', chave: 'intrusao:3', nivel: 'critico', titulo: 'INTRUSÃO NA ZONA ALFA', foto: 'data:image/jpeg;base64,xxx' });
  r.registrar({ em: base + 60000, modo: 'sentinela', chave: 'abandono:7', nivel: 'aviso', titulo: 'OBJETO SEM DONO' });
  r.registrar({ em: base + 120000, modo: 'sentinela', chave: 'corrida:2', nivel: 'critico', titulo: 'CORRIDA' });
  assert.equal(avisos, 3);
  const agora = base + 130000;
  assert.deepEqual(r.listar({ minutos: 60, agora }).map(x => x.titulo), ['CORRIDA', 'OBJETO SEM DONO', 'INTRUSÃO NA ZONA ALFA']);
  assert.deepEqual(r.listar({ minutos: 1, agora }).map(x => x.titulo), ['CORRIDA'], 'janela de 1 min');
  assert.deepEqual(r.listar({ minutos: 60, nivel: 'aviso', agora }).map(x => x.titulo), ['OBJETO SEM DONO']);
  assert.equal(r.listar({ minutos: 60, limite: 2, agora }).length, 2);
  assert.equal(r.listar({ minutos: 99999, limite: 999, agora }).length, 3, 'limites saneados (1440 min, 50 itens)');

  r.anexarParecer(a.id, { veredito: 'anomalia_confirmada', nivel_risco: 'alto', resumo: 'Pessoa dentro da zona restrita.' });
  const resumo = RegistroIncidentes.resumo(r.itens[0]);
  assert.equal(resumo.parecer_do_agente.veredito, 'anomalia_confirmada');
  assert.equal('foto' in resumo, false, 'imagem nunca vai para o agente pelo histórico');
  assert.match(resumo.hora, /^\d\d:\d\d:\d\d$/);
  assert.equal(r.anexarParecer('nao-existe', {}), null);

  const exp = JSON.parse(r.exportar());
  assert.equal(exp.formato, 'sentinela-spy-incidentes/1');
  assert.equal(exp.incidentes.length, 3);
  assert.equal(exp.incidentes[0].em, '2026-11-04T10:00:00.000Z');
  await r.limpar();
  assert.equal(r.itens.length, 0);
});

test('registro respeita o teto e descarta o mais antigo', () => {
  const r = new RegistroIncidentes({ indexedDB: null, limite: 3 });
  for (let i = 0; i < 5; i++) r.registrar({ em: 1000 + i, modo: 'transito', chave: `k${i}`, nivel: 'aviso', titulo: `T${i}` });
  assert.deepEqual(r.itens.map(x => x.titulo), ['T2', 'T3', 'T4']);
});

test('ouvinte com defeito não derruba o registro', () => {
  const r = new RegistroIncidentes({ indexedDB: null });
  r.aoMudar(() => { throw new Error('quebrei'); });
  assert.doesNotThrow(() => r.registrar({ modo: 'motorista', chave: 'fadiga', nivel: 'aviso', titulo: 'FADIGA' }));
});
