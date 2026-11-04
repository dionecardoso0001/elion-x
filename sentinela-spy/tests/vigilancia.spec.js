import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AnalisadorVigilancia, distanciaObjetoPessoaM, anguloTronco, maosErguidas,
} from '../js/vigilancia.js';

const ASPECTO = 16 / 9;
const trilha = (id, classe, x, y, w, h, extra = {}) => ({
  id, classe, score: 0.9, x, y, w, h, vx: 0, vy: 0, hits: 30, nasceu: 0,
  estatico: false, estaticoDesde: null, ...extra,
});

/**
 * Roda o analisador a 15 quadros/s; `cena(t)` devolve { trilhas, poses? }.
 * Devolve o ÚLTIMO quadro, mas com os eventos de TODOS os quadros — evento
 * é pontual e acontece no quadro em que acontece, não necessariamente no último.
 */
function rodar(a, de, ate, cena, zonas = []) {
  let r;
  const eventos = [];
  for (let t = de; t <= ate; t += 66) {
    const c = cena(t);
    r = a.processar({ t, trilhas: c.trilhas, poses: c.poses || [], zonas, aspecto: ASPECTO });
    eventos.push(...r.eventos);
  }
  return { ...r, eventos };
}
const tem = (r, prefixo, nivel) => r.condicoes.some(c => c.chave.startsWith(prefixo) && (!nivel || c.nivel === nivel));
const evento = (r, prefixo) => r.eventos.some(e => e.chave.startsWith(prefixo));

const ZONA = { id: 'z1', nome: 'ALFA', tipo: 'restrita', pontos: [{ x: 0.6, y: 0.5 }, { x: 0.9, y: 0.5 }, { x: 0.9, y: 0.95 }, { x: 0.6, y: 0.95 }] };

test('régua da altura: objeto a 1,78 alturas de quadro de uma pessoa de 0,4 de altura está a ~3,8 m', () => {
  const pessoa = { x: 0.1, y: 0.4, w: 0.06, h: 0.4 };
  const obj = { x: 0.16 + 0.5 - 0.02, y: 0.6, w: 0.04, h: 0.04 };   // 0,5 de largura à direita da pessoa
  const d = distanciaObjetoPessoaM(obj, pessoa, ASPECTO, 1.7);
  assert.ok(Math.abs(d - (0.5 * ASPECTO * 1.7) / 0.4) < 1e-9);
  assert.equal(distanciaObjetoPessoaM({ x: 0.11, y: 0.5, w: 0.02, h: 0.02 }, pessoa), 0, 'dentro da caixa = junto');
});

test('INTRUSÃO: pé dentro da zona restrita por > 0,6 s → crítico; saída gera evento', () => {
  const a = new AnalisadorVigilancia();
  let r = rodar(a, 0, 1000, () => ({ trilhas: [trilha(1, 'person', 0.70, 0.40, 0.06, 0.40)] }), [ZONA]);
  assert.ok(tem(r, 'intrusao:z1:1', 'critico'));
  r = rodar(a, 1066, 1200, () => ({ trilhas: [trilha(1, 'person', 0.20, 0.40, 0.06, 0.40)] }), [ZONA]);
  assert.ok(!tem(r, 'intrusao'));
  // a cabeça dentro da zona com o pé fora NÃO é intrusão
  const b = new AnalisadorVigilancia();
  r = rodar(b, 0, 1000, () => ({ trilhas: [trilha(2, 'person', 0.70, 0.05, 0.06, 0.40)] }), [ZONA]);
  assert.ok(!tem(r, 'intrusao'), 'pé em y=0,45, acima da zona');
});

test('PERMANÊNCIA em zona monitorada após o limiar', () => {
  const a = new AnalisadorVigilancia({ permanenciaS: 2 });
  const zona = { ...ZONA, id: 'z2', tipo: 'monitorada', nome: 'BRAVO' };
  const r = rodar(a, 0, 2500, () => ({ trilhas: [trilha(1, 'person', 0.70, 0.40, 0.06, 0.40)] }), [zona]);
  assert.ok(tem(r, 'permanencia:z2:1', 'aviso'));
});

test('OBJETO ESQUECIDO: dono se afasta > 3 m e o tempo de abandono vence', () => {
  const a = new AnalisadorVigilancia({ abandonoS: 3 });
  const mochila = t => trilha(2, 'backpack', 0.30, 0.75, 0.04, 0.05, { estatico: true, estaticoDesde: 0 });
  const pessoaX = t => (t < 1000 ? 0.28 : Math.min(0.8, 0.28 + ((t - 1000) / 2000) * 0.52));
  const cena = t => ({ trilhas: [trilha(1, 'person', pessoaX(t), 0.40, 0.06, 0.40), mochila(t)] });
  let r = rodar(a, 0, 4000, cena);
  const obj = r.objetos.find(o => o.id === 2);
  assert.equal(obj.dono, 1, 'quem estava junto quando a mochila parou é o dono');
  assert.equal(obj.estado, 'sem_dono');
  assert.ok(obj.restanteS > 0 && obj.restanteS < 3, 'contagem regressiva visível no HUD');
  r = rodar(a, 4066, 8000, cena);
  assert.ok(tem(r, 'abandono:2', 'critico'), JSON.stringify(r.condicoes));
  assert.match(r.condicoes.find(c => c.chave === 'abandono:2').titulo, /ESQUECIDO/);
  // o dono volta → objeto volta a ser acompanhado
  r = rodar(a, 8066, 8600, () => ({ trilhas: [trilha(1, 'person', 0.29, 0.40, 0.06, 0.40), mochila()] }));
  assert.ok(!tem(r, 'abandono'));
  assert.ok(evento(r, 'retorno:2') || r.objetos.find(o => o.id === 2).estado === 'estatico');
});

test('OBJETO ABANDONADO: dono sai da cena', () => {
  const a = new AnalisadorVigilancia({ abandonoS: 2 });
  const mala = () => trilha(3, 'suitcase', 0.5, 0.7, 0.06, 0.1, { estatico: true, estaticoDesde: 0 });
  rodar(a, 0, 800, () => ({ trilhas: [trilha(1, 'person', 0.48, 0.4, 0.08, 0.45), mala()] }));
  const r = rodar(a, 866, 4000, () => ({ trilhas: [mala()] }));
  const c = r.condicoes.find(x => x.chave === 'abandono:3');
  assert.ok(c && c.nivel === 'critico');
  assert.match(c.detalhe, /deixou a cena/);
});

test('RETIRADA: objeto parado levado por quem não é o dono', () => {
  const a = new AnalisadorVigilancia({ remocaoEstaticoMinS: 2 });
  // bolsa parada sozinha por 3 s (sem dono); depois o alvo 5 chega e sai com ela
  let r = rodar(a, 0, 3000, () => ({ trilhas: [trilha(4, 'handbag', 0.5, 0.7, 0.04, 0.05, { estatico: true, estaticoDesde: 0 })] }));
  r = rodar(a, 3066, 3400, t => ({ trilhas: [
    trilha(5, 'person', 0.49, 0.4, 0.06, 0.4),
    trilha(4, 'handbag', 0.5 + (t - 3066) / 20000, 0.7, 0.04, 0.05, { estatico: false }),
  ] }));
  assert.ok(evento(r, 'retirada:4'), JSON.stringify(r.eventos));
});

test('QUEDA: transição brusca para deitado → crítico; deitar devagar → nada', () => {
  const de_pe = trilha(1, 'person', 0.40, 0.20, 0.08, 0.50);   // altura/largura física ≈ 3,5
  const deitado = trilha(1, 'person', 0.35, 0.62, 0.30, 0.10);  // ≈ 0,19
  const sentado = trilha(1, 'person', 0.40, 0.45, 0.12, 0.28);  // ≈ 1,3 (nem ereto, nem deitado)
  let a = new AnalisadorVigilancia();
  let r = rodar(a, 0, 3000, t => ({ trilhas: [t < 1000 ? de_pe : deitado] }));
  assert.ok(tem(r, 'queda:1', 'critico'));
  a = new AnalisadorVigilancia();
  r = rodar(a, 0, 7000, t => ({ trilhas: [t < 1000 ? de_pe : t < 4000 ? sentado : deitado] }));
  assert.ok(!tem(r, 'queda'), 'transição de 3 s é deitar, não cair');
});

test('QUEDA: braços abertos (caixa larga) com tronco VERTICAL no esqueleto não é queda', () => {
  // falso positivo real encontrado no E2E (pose de ioga "guerreiro II"):
  // caixa 0,54 × 0,62 → altura/largura física ≈ 0,77, mas o tronco está a 1°
  const a = new AnalisadorVigilancia();
  const lm = esqueleto();
  lm[15] = { x: 0.25, y: 0.33, z: 0, visibility: 0.95 }; lm[16] = { x: 0.75, y: 0.33, z: 0, visibility: 0.95 };
  const r = rodar(a, 0, 4000, () => ({ trilhas: [trilha(1, 'person', 0.24, 0.20, 0.54, 0.62)], poses: [lm] }));
  assert.ok(!tem(r, 'queda'), JSON.stringify(r.condicoes.map(c => c.detalhe)));
});

test('QUEDA pelo esqueleto: tronco vai de vertical a horizontal com quadril no chão → crítico', () => {
  const a = new AnalisadorVigilancia();
  const r = rodar(a, 0, 3500, t => (t < 1000
    ? { trilhas: [trilha(1, 'person', 0.44, 0.18, 0.12, 0.60)], poses: [esqueleto()] }
    : { trilhas: [trilha(1, 'person', 0.19, 0.66, 0.58, 0.08)], poses: [esqueleto({ deitado: true })] }));
  const c = r.condicoes.find(x => x.chave === 'queda:1');
  assert.ok(c && c.nivel === 'critico', JSON.stringify(r.condicoes));
  assert.match(c.detalhe, /tronco a (8|9)\d° da vertical/);
});

test('CORRIDA: ~3 alturas de corpo por segundo por mais de 0,7 s', () => {
  const a = new AnalisadorVigilancia();
  const r = rodar(a, 0, 1500, t => ({ trilhas: [trilha(1, 'person', 0.1 + t / 2000, 0.4, 0.05, 0.3, { vx: 0.5 })] }));
  assert.ok(tem(r, 'corrida:1', 'aviso'));
  assert.ok(r.pessoas[0].correndo);
});

/** Esqueleto de 33 pontos dentro da caixa (0,44..0,56 × 0,18..0,78). */
function esqueleto({ maosAlto = false, deitado = false } = {}) {
  // pontos não posicionados ficam com visibilidade baixa, como o MediaPipe entrega
  // ponto não visto — senão inflariam a caixa da pose e quebrariam a associação
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }));
  const set = (i, x, y) => { lm[i] = { x, y, z: 0, visibility: 0.95 }; };
  if (!deitado) {
    set(0, 0.5, 0.25); set(11, 0.47, 0.32); set(12, 0.53, 0.32);
    set(23, 0.48, 0.5); set(24, 0.52, 0.5); set(27, 0.48, 0.75); set(28, 0.52, 0.75);
    if (maosAlto) { set(15, 0.46, 0.2); set(16, 0.54, 0.2); } else { set(15, 0.45, 0.48); set(16, 0.55, 0.48); }
  } else {
    set(0, 0.2, 0.7); set(11, 0.28, 0.69); set(12, 0.28, 0.71); set(23, 0.5, 0.69); set(24, 0.5, 0.71);
    set(27, 0.75, 0.69); set(28, 0.75, 0.71); set(15, 0.35, 0.72); set(16, 0.35, 0.68);
  }
  return lm;
}

test('esqueleto: ângulo do tronco e mãos erguidas', () => {
  assert.ok(anguloTronco(esqueleto(), ASPECTO) < 5);
  assert.ok(anguloTronco(esqueleto({ deitado: true }), ASPECTO) > 80);
  assert.equal(maosErguidas(esqueleto({ maosAlto: true })), true);
  assert.equal(maosErguidas(esqueleto()), false);
});

test('MÃOS ERGUIDAS por 2 s (pose associada à pessoa certa) → aviso', () => {
  const a = new AnalisadorVigilancia();
  const r = rodar(a, 0, 2300, () => ({
    trilhas: [trilha(1, 'person', 0.44, 0.18, 0.12, 0.60)],
    poses: [esqueleto({ maosAlto: true })],
  }));
  assert.ok(tem(r, 'maos:1', 'aviso'));
});

test('OBJETO DE RISCO: faca junto ao corpo → crítico; sozinha na mesa → aviso', () => {
  const a = new AnalisadorVigilancia();
  let r = rodar(a, 0, 500, () => ({ trilhas: [trilha(1, 'person', 0.4, 0.2, 0.12, 0.6), trilha(9, 'knife', 0.45, 0.4, 0.03, 0.08)] }));
  assert.ok(tem(r, 'risco:9', 'critico'));
  r = rodar(new AnalisadorVigilancia(), 0, 500, () => ({ trilhas: [trilha(9, 'knife', 0.8, 0.8, 0.03, 0.08)] }));
  assert.ok(tem(r, 'risco:9', 'aviso'));
});

test('AGLOMERAÇÃO a partir de 6 pessoas', () => {
  const a = new AnalisadorVigilancia();
  const r = rodar(a, 0, 200, () => ({ trilhas: Array.from({ length: 6 }, (_, k) => trilha(k + 1, 'person', 0.1 * k, 0.3, 0.05, 0.3)) }));
  assert.ok(tem(r, 'aglomeracao', 'aviso'));
});

/* ── objeto da cena, movimento no escuro e alteração parada (fundo duplo) ── */
const rodarCena = (a, de, ate, cena, zonas = []) => {
  let r; const eventos = [];
  for (let t = de; t <= ate; t += 100) {
    const c = cena(t);
    r = a.processar({ t, trilhas: c.trilhas || [], zonas, aspecto: ASPECTO, cena: c.cena || null });
    eventos.push(...r.eventos);
  }
  return { ...r, eventos };
};

test('CENÁRIO: notebook parado desde o início numa sala vazia NÃO é objeto esquecido', () => {
  const a = new AnalisadorVigilancia({ abandonoS: 2 });
  const r = rodar(a, 0, 6000, () => ({ trilhas: [trilha(7, 'laptop', 0.4, 0.6, 0.08, 0.06, { estatico: true, estaticoDesde: 0 })] }));
  assert.ok(!tem(r, 'abandono'), JSON.stringify(r.condicoes));
  assert.equal(r.objetos.find(o => o.id === 7).estado, 'cenario');
});

test('MOVIMENTO NO ESCURO: mancha persistente sem pessoa → aviso; em zona restrita → crítico; de dia, nada', () => {
  const blob = { x: 0.2, y: 0.3, w: 0.05, h: 0.2, area: 0.01 };
  let a = new AnalisadorVigilancia();
  let r = rodarCena(a, 0, 1500, () => ({ cena: { escuro: true, movimento: [blob], estaticos: [] } }));
  assert.ok(tem(r, 'movimento:', 'aviso'), JSON.stringify(r.condicoes));
  a = new AnalisadorVigilancia();
  r = rodarCena(a, 0, 1500, () => ({ cena: { escuro: true, movimento: [{ ...blob, x: 0.7, y: 0.6 }], estaticos: [] } }), [ZONA]);
  assert.ok(tem(r, 'movzona:z1', 'critico'), JSON.stringify(r.condicoes));
  a = new AnalisadorVigilancia();
  r = rodarCena(a, 0, 1500, () => ({ cena: { escuro: false, movimento: [blob], estaticos: [] } }));
  assert.ok(!tem(r, 'mov'), 'de dia o detector de pessoas é quem decide');
  // pessoa detectada explica o movimento
  a = new AnalisadorVigilancia();
  r = rodarCena(a, 0, 1500, () => ({ trilhas: [trilha(1, 'person', 0.19, 0.28, 0.07, 0.25)], cena: { escuro: true, movimento: [blob], estaticos: [] } }));
  assert.ok(!tem(r, 'movimento:'), JSON.stringify(r.condicoes));
  assert.equal(r.movimentos[0].explicado, true);
});

test('ALTERAÇÃO PARADA: objeto de qualquer tipo deixado onde alguém passou → POSSÍVEL OBJETO ESQUECIDO quando a pessoa se afasta', () => {
  const a = new AnalisadorVigilancia({ abandonoS: 2 });
  const caixa = { x: 0.32, y: 0.78, w: 0.05, h: 0.06, area: 0.003 };
  // a pessoa passa junto ao local (0–2 s), a alteração aparece (2 s) e a pessoa vai embora
  const pessoaX = t => (t < 2000 ? 0.30 : Math.min(0.9, 0.30 + ((t - 2000) / 2000) * 0.6));
  const cena = t => ({
    trilhas: t < 4500 ? [trilha(1, 'person', pessoaX(t), 0.45, 0.06, 0.40)] : [],
    cena: { escuro: false, movimento: [], estaticos: t >= 2000 ? [caixa] : [] },
  });
  const r = rodarCena(a, 0, 11000, cena);
  const c = r.condicoes.find(x => x.chave.startsWith('esquecido:'));
  assert.ok(c && c.nivel === 'aviso', JSON.stringify(r.condicoes));
  assert.match(c.detalhe, /TGT-1/);
  assert.equal(r.novos[0].dono, 1);
});

test('ALTERAÇÃO PARADA sem ninguém por perto → aviso de alteração; pessoa parada no lugar não conta', () => {
  let a = new AnalisadorVigilancia({ abandonoS: 2 });
  const caixa = { x: 0.6, y: 0.2, w: 0.05, h: 0.05, area: 0.0025 };
  let r = rodarCena(a, 0, 7000, () => ({ cena: { escuro: true, movimento: [], estaticos: [caixa] } }));
  assert.ok(tem(r, 'alteracao:', 'aviso'), JSON.stringify(r.condicoes));
  a = new AnalisadorVigilancia({ abandonoS: 2 });
  r = rodarCena(a, 0, 7000, () => ({ trilhas: [trilha(3, 'person', 0.58, 0.15, 0.08, 0.4)], cena: { escuro: false, movimento: [], estaticos: [caixa] } }));
  assert.ok(!tem(r, 'alteracao') && !tem(r, 'esquecido'), 'a pessoa parada é que "mudou" a cena');
});

test('ALTERAÇÃO PARADA: depois do teto de alerta, a região é devolvida para o fundo (absorver)', () => {
  const a = new AnalisadorVigilancia({ abandonoS: 1, alteracaoMaxS: 2 });
  const caixa = { x: 0.6, y: 0.2, w: 0.05, h: 0.05, area: 0.0025 };
  const pedidos = [];
  for (let t = 0; t <= 8000; t += 100) {
    const r = a.processar({ t, trilhas: [], zonas: [], aspecto: ASPECTO, cena: { escuro: false, movimento: [], estaticos: [caixa] } });
    for (const b of r.absorver) pedidos.push({ t, b });
  }
  // confirma em 3 s, vira alerta em 4 s (abandono 1 s) e é devolvida após 2 s de alerta
  assert.ok(pedidos.length >= 1, 'pediu para absorver a região');
  assert.ok(pedidos[0].t >= 6000 && pedidos[0].t <= 6300, `pedido em ${pedidos[0].t} ms`);
  assert.deepEqual(pedidos[0].b, { x: caixa.x, y: caixa.y, w: caixa.w, h: caixa.h });
});

test('LOCAL RESTRITO ensinado com fotos: cena reconhecida + pessoa → intrusão crítica; cena vazia → nada', () => {
  const local = { conceito: { id: 'c1', nome: 'SUBESTAÇÃO' }, similaridade: 0.87 };
  const a = new AnalisadorVigilancia();
  let r = rodar(a, 0, 500, () => ({ trilhas: [trilha(1, 'person', 0.4, 0.3, 0.06, 0.4)] }));
  r = a.processar({ t: 600, trilhas: [trilha(1, 'person', 0.4, 0.3, 0.06, 0.4)], zonas: [], aspecto: ASPECTO, local });
  const c = r.condicoes.find(x => x.chave === 'local:c1');
  assert.ok(c && c.nivel === 'critico'); assert.match(c.titulo, /SUBESTAÇÃO/); assert.match(c.detalhe, /87%/);
  const vazio = new AnalisadorVigilancia().processar({ t: 0, trilhas: [], zonas: [], aspecto: ASPECTO, local });
  assert.ok(!vazio.condicoes.some(x => x.chave.startsWith('local:')));
});
