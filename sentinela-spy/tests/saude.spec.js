import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretarResposta, normalizar, ChecagemSaude, montarAlerta, pergunta } from '../js/saude.js';

const tipos = acoes => acoes.map(a => a.tipo);

test('normalização: sem acento, sem pontuação, vírgula preservada como separador', () => {
  assert.equal(normalizar('Não, TÔ bem!'), 'nao , to bem');
  assert.equal(normalizar('  Estou   passando mal...  '), 'estou passando mal');
});

test('resposta de quem PRECISA de ajuda (inclusive sintomas e "não" seco)', () => {
  for (const f of ['preciso de ajuda', 'Socorro', 'não estou bem', 'não tô bem', 'estou passando mal', 'tô mal', 'não',
    'estou com dor no peito', 'falta de ar', 'tô tonto', 'vou desmaiar', 'meu braço tá formigando', 'sim, estou com dor no peito',
    'chama o SAMU', 'acho que é infarto', 'estou com a vista embaçada', 'meu coração tá disparado']) {
    assert.equal(interpretarResposta(f), 'mal', f);
  }
});

test('resposta de quem está BEM', () => {
  for (const f of ['estou bem', 'tô bem', 'sim', 'tudo bem', 'Tudo certo', 'beleza', 'não foi nada', 'foi só uma coceira',
    'era só o cinto', 'Não, tô bem', 'tô ótimo', 'ok']) {
    assert.equal(interpretarResposta(f), 'bem', f);
  }
});

test('resposta INCERTA não decide sozinha', () => {
  for (const f of ['hã?', 'o quê', 'espera aí', '']) assert.equal(interpretarResposta(f), 'incerto', f);
});

test('fluxo "estou bem": pergunta, ouve, encerra — e o mesmo gatilho só volta depois da pausa', () => {
  const c = new ChecagemSaude({ pausaAposBemMs: 60000 });
  const a1 = c.iniciar('mao_peito', 0);
  assert.deepEqual(tipos(a1), ['mostrar', 'falar', 'ouvir']);
  assert.match(a1[1].texto, /mão no peito.*Você está bem\?/);
  const a2 = c.aoOuvir('tô bem, foi só o cinto', 3000);
  assert.deepEqual(tipos(a2), ['falar', 'fechar']);
  assert.equal(c.ativa, false);
  assert.deepEqual(c.iniciar('mao_peito', 30000), [], 'pausa de 1 min para o mesmo motivo');
  assert.ok(c.iniciar('mao_olhos', 30000).length, 'outro motivo pergunta normalmente');
  c.encerrar();
  assert.ok(c.iniciar('mao_peito', 64000).length, 'depois da pausa (conta da resposta, em 3 s), pergunta de novo');
});

test('fluxo "preciso de ajuda": escala NA HORA, sem segunda pergunta, e passa a palavra ao agente', () => {
  const c = new ChecagemSaude();
  c.iniciar('mao_peito', 0);
  const a = c.aoOuvir('estou com dor no peito', 2500);
  assert.deepEqual(tipos(a), ['mostrar', 'escalar', 'falar', 'conversar']);
  const esc = a.find(x => x.tipo === 'escalar');
  assert.equal(esc.motivo, 'mao_peito'); assert.equal(esc.semResposta, false); assert.equal(esc.resposta, 'estou com dor no peito');
  assert.match(a.find(x => x.tipo === 'falar').texto, /192/);
  // depois do aviso: fala do motorista vai para o agente; "estou bem" vira atualização ao responsável
  assert.deepEqual(tipos(c.aoOuvir('o peito aperta e o braço formiga', 6000)), ['conversar']);
  const fim = c.aoOuvir('já estou bem', 30000);
  assert.deepEqual(tipos(fim), ['falar', 'atualizar', 'fechar']);
});

test('SILÊNCIO: pergunta de novo, e o silêncio repetido ESCALA (o caso mais grave: desmaio, AVC)', () => {
  const c = new ChecagemSaude();
  c.iniciar('mal_subito', 0);
  const a = c.aoOuvir(null, 8000);
  assert.deepEqual(tipos(a), ['falar', 'ouvir']);
  assert.match(a[0].texto, /está me ouvindo/);
  const b = c.aoOuvir('', 16000);
  const esc = b.find(x => x.tipo === 'escalar');
  assert.ok(esc && esc.semResposta === true && esc.resposta === null, JSON.stringify(b));
  // com a escalada por silêncio desligada nas configurações, só encerra
  const d = new ChecagemSaude({ escalarSemResposta: false });
  d.iniciar('mao_olhos', 0); d.aoOuvir(null, 8000);
  assert.deepEqual(tipos(d.aoOuvir(null, 16000)), ['fechar']);
});

test('resposta confusa duas vezes escala com a transcrição; botões funcionam', () => {
  const c = new ChecagemSaude();
  c.iniciar('ausente', 0); c.aoOuvir('hã?', 4000);
  const esc = c.aoOuvir('o quê', 9000).find(x => x.tipo === 'escalar');
  assert.match(esc.resposta, /não compreendida: "hã\? \/ o quê"/);
  const d = new ChecagemSaude();
  d.iniciar('mao_olhos', 0);
  assert.deepEqual(tipos(d.aoBotao('bem', 1000)), ['falar', 'fechar']);
  const e = new ChecagemSaude();
  assert.deepEqual(tipos(e.aoBotao('ajuda', 0)), ['mostrar', 'escalar', 'falar', 'conversar'], 'botão de ajuda sem gatilho = pedido manual');
  assert.equal(e.motivo, 'manual');
  assert.deepEqual(e.aoBotao('ajuda', 1000), [], 'já avisado: não duplica');
  assert.deepEqual(tipos(e.aoBotao('bem', 5000)), ['falar', 'atualizar', 'fechar']);
});

test('gatilho durante checagem em curso é ignorado (uma conversa por vez)', () => {
  const c = new ChecagemSaude();
  c.iniciar('mao_olhos', 0);
  assert.deepEqual(c.iniciar('mao_peito', 1000), []);
  assert.match(pergunta('mao_olhos', 1), /mão nos olhos/);
});

test('alerta ao responsável: quem, o quê, onde (link de mapa), quando — sem foto e com o aviso de triagem', () => {
  const a = montarAlerta({ motivo: 'mao_peito', semResposta: true, motorista: 'João', veiculo: 'ABC1D23',
    local: { lat: -23.5505, lng: -46.6333, precisao: 12 }, velocidadeKmh: 61.4, quando: new Date('2026-11-04T18:30:00Z') });
  assert.equal(a.tipo, 'alerta_saude'); assert.equal(a.gravidade, 'critica');
  assert.match(a.situacao, /NÃO RESPONDEU/);
  assert.equal(a.local.mapa, 'https://maps.google.com/?q=-23.550500,-46.633300');
  assert.equal(a.velocidadeKmh, 61);
  assert.match(a.quando, /04\/11\/2026.*15:30/);
  assert.match(a.aviso, /não é diagnóstico/);
  assert.equal(JSON.stringify(a).includes('data:image'), false);
  assert.equal(montarAlerta({ motivo: 'manual', resposta: 'pedido de ajuda pelo botão' }).situacao, 'o motorista pediu ajuda pelo botão do aplicativo');
  const sem = montarAlerta({ motivo: 'mao_olhos', resposta: 'tô tonto' });
  assert.equal(sem.local, null); assert.equal(sem.motorista, 'não informado');
  assert.match(sem.situacao, /tô tonto/);
});
