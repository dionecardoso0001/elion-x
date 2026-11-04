import test from 'node:test';
import assert from 'node:assert/strict';
import { GestorAlertas } from '../js/alertas.js';
import { ModeloNormalidade } from '../js/anomalia.js';
import { protocoloPara, narrar, relatorioSituacao, montarTelemetria } from '../js/agente.js';

const crit = { chave: 'microssono', nivel: 'critico', titulo: 'OLHOS FECHADOS', voz: 'Acorde!' };
const aviso = { chave: 'distracao', grupo: 'distracao', nivel: 'aviso', titulo: 'OLHAR FORA', voz: 'Olhos na pista.' };

test('condição nova liga a sirene, entra no registro e na fila de voz', () => {
  const g = new GestorAlertas();
  const { novas } = g.sincronizar([crit], 0);
  assert.equal(novas.length, 1);
  assert.equal(g.sireneLigada(0), true);
  assert.equal(g.historico.length, 1);
  assert.equal(g.proximaFala(0).texto, 'Acorde!');
  assert.equal(g.defcon(0), 1);
});

test('histerese: some por 1 s continua ativa; some por 3 s encerra', () => {
  const g = new GestorAlertas({ histereseMs: 2500 });
  g.sincronizar([crit], 0);
  g.sincronizar([], 1000);
  assert.equal(g.ativas.size, 1, 'um quadro ruidoso não desliga a sirene');
  const { encerradas } = g.sincronizar([], 3000);
  assert.equal(encerradas.length, 1);
  assert.equal(g.sireneLigada(3000), false);
  assert.equal(g.defcon(3000), 2, 'crítico no último minuto ainda pesa');
  assert.equal(g.defcon(70000), 5);
});

test('escalada aviso → crítico fala imediatamente, mesmo logo após o aviso', () => {
  const g = new GestorAlertas();
  g.sincronizar([aviso], 0);
  assert.equal(g.proximaFala(0).nivel, 'aviso');
  g.sincronizar([{ ...aviso, nivel: 'critico', voz: 'Olhe para a pista!' }], 1500);
  const f = g.proximaFala(1500);
  assert.ok(f, 'a escalada não pode esperar o cooldown');
  assert.equal(f.nivel, 'critico');
});

test('crítico persistente repete a voz no intervalo configurado; fila prioriza o mais grave', () => {
  const g = new GestorAlertas({ repetirVozCriticoMs: 7000 });
  g.sincronizar([crit, aviso], 0);
  assert.equal(g.proximaFala(0).nivel, 'critico', 'mais grave primeiro');
  assert.equal(g.proximaFala(0).nivel, 'aviso');
  g.sincronizar([crit, aviso], 3000);
  assert.equal(g.proximaFala(3000), null);
  g.sincronizar([crit, aviso], 7100);
  assert.equal(g.proximaFala(7100)?.texto, 'Acorde!');
});

test('silenciar desliga sirene e voz pelo período pedido', () => {
  const g = new GestorAlertas();
  g.sincronizar([crit], 0);
  g.silenciar(0, 30000);
  assert.equal(g.sireneLigada(1000), false);
  assert.equal(g.proximaFala(1000), null);
  g.sincronizar([crit], 31000);
  assert.equal(g.sireneLigada(31000), true);
});

test('evento informativo não eleva o nível de ameaça; aviso recente eleva a 4', () => {
  const g = new GestorAlertas();
  g.evento({ chave: 'calibrado', nivel: 'info', titulo: 'CALIBRAÇÃO CONCLUÍDA' }, 0);
  assert.equal(g.defcon(1000), 5, 'calibração não é ameaça');
  g.evento({ chave: 'anomalia:3', nivel: 'aviso', titulo: 'COMPORTAMENTO ATÍPICO' }, 2000);
  assert.equal(g.defcon(3000), 4);
  assert.equal(g.defcon(63000), 5, 'passado um minuto, volta ao nominal');
});

test('eventos repetidos são suprimidos pelo cooldown do nível', () => {
  const g = new GestorAlertas();
  const e = { chave: 'bocejo', nivel: 'info', titulo: 'BOCEJO' };
  assert.ok(g.evento(e, 0));
  assert.equal(g.evento(e, 5000), null);
  assert.ok(g.evento(e, 31000));
});

test('modelo de normalidade: célula nunca ocupada vira "rara" só depois do aquecimento', () => {
  const m = new ModeloNormalidade({ aquecimentoAmostras: 400 });
  assert.equal(m.avaliar(0.9, 0.1, 0.5).rara, false, 'sem aquecimento não acusa');
  let s = 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);   // PRNG determinístico
  for (let k = 0; k < 500; k++) m.aprender(0.15 + 0.1 * rnd(), 0.75 + 0.1 * rnd(), 0.5 + 0.1 * (rnd() - 0.5), k * 200);
  assert.equal(m.aquecido, true);
  assert.equal(m.avaliar(0.9, 0.1, 0.5).rara, true);
  assert.equal(m.avaliar(0.2, 0.8, 0.5).rara, false);
  assert.equal(m.avaliar(0.2, 0.8, 3.0).rapida, true, 'velocidade muito acima do padrão do local');
  assert.equal(m.mapaDeCalor().length, 12 * 9);
});

test('agente: protocolo, narrativa e relatório por modo', () => {
  assert.match(protocoloPara('abandono:3'), /isolar/);
  assert.match(protocoloPara('queda:1'), /192/);
  assert.equal(protocoloPara('xyz'), null);
  const n = narrar({ chave: 'intrusao:z1:4', nivel: 'critico', titulo: 'INTRUSÃO: ALFA', detalhe: 'TGT-4' });
  assert.match(n.texto, /CRÍTICO INTRUSÃO: ALFA/);
  assert.match(n.protocolo, /^PROTOCOLO:/);
  assert.match(relatorioSituacao('motorista', { presente: true, perclos: 0.031, piscadasMin: 14, bocejos5min: 1, yaw: 2, pitch: 1, indiceFadiga: 18 }, 5), /PERCLOS 3,1%/);
  assert.match(relatorioSituacao('transito', { contagem: { veiculo: 2 }, lider: { id: 3, classe: 'car', z: 22, ttc: Infinity } }, 4), /líder CARRO TGT-3 a ~22 m, TTC ∞/);
  assert.match(relatorioSituacao('sentinela', { pessoas: 2, objetos: 1, semDono: 1, normalidade: { aquecido: false, amostras: 100, alvo: 400 } }, 3), /aprendendo 25%/);
});

test('telemetria da análise profunda é compacta e sem identificação pessoal', () => {
  const tel = montarTelemetria({
    modo: 'sentinela', defcon: 3,
    ativas: [{ titulo: 'INTRUSÃO', nivel: 'critico', detalhe: 'x', voz: 'nao vai' }],
    trilhas: [{ id: 1, classe: 'person', score: 0.913, x: 0.123456, y: 0.2, w: 0.1, h: 0.3, estatico: false }],
    metricas: { pessoas: 1 }, zonas: [{ nome: 'ALFA', tipo: 'restrita', pontos: [] }],
  });
  assert.deepEqual(tel.alvos[0].caixa_xywh, [0.12, 0.2, 0.1, 0.3]);
  assert.equal(tel.alertas_ativos[0].voz, undefined);
  assert.equal(tel.zonas[0].pontos, undefined);
  assert.equal(tel.metricas.pessoas, 1);
});
