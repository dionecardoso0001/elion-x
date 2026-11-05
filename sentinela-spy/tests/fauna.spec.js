import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAPA_IMAGENET, CATEGORIAS, categoriaDe, descreverAnimal, ladrilhosCorredor, recorteDistante,
  fundirDeteccoes, FaunaPista,
} from '../js/fauna.js';
import { AnalisadorTransito } from '../js/transito.js';
import { LIMIARES } from '../js/config.js';

test('todo rótulo mapeado existe no classificador (lista extraída do próprio .tflite)', () => {
  const linhas = readFileSync(new URL('./fixtures/imagenet-rotulos.txt', import.meta.url), 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  assert.equal(linhas.length, 1000);
  const rotulos = new Set(linhas);
  assert.equal(rotulos.size, 998, 'o ImageNet repete "crane" (ave/guindaste) e "maillot"');
  assert.equal(MAPA_IMAGENET.has('crane'), false, 'nome ambíguo não entra no mapa');
  const faltam = [...MAPA_IMAGENET.keys()].filter(k => !rotulos.has(k));
  assert.deepEqual(faltam, [], 'rótulo com grafia diferente nunca casaria em campo');
  for (const c of new Set(MAPA_IMAGENET.values())) assert.ok(CATEGORIAS[c], `categoria ${c} sem nome/porte`);
});

test('cobertura pedida: cães (118 raças), cobras (17), galinha/galo, boi, aves; veado só como provável', () => {
  const por = c => [...MAPA_IMAGENET].filter(([, v]) => v === c).length;
  assert.equal(por('cao'), 118);
  assert.equal(por('cobra'), 17);
  assert.equal(MAPA_IMAGENET.get('hen'), 'galinha'); assert.equal(MAPA_IMAGENET.get('cock'), 'galinha');
  assert.equal(MAPA_IMAGENET.get('ox'), 'bovino');
  assert.ok(por('ave') >= 50);
  assert.equal(MAPA_IMAGENET.get('impala'), 'cervideo');
  assert.match(CATEGORIAS.cervideo.nome, /provável/);
});

test('categoria soma a massa entre raças vizinhas e ignora o que não é animal', () => {
  const c = categoriaDe([{ nome: 'Labrador retriever', score: 0.3 }, { nome: 'golden retriever', score: 0.25 }, { nome: 'tabby', score: 0.2 }, { nome: 'street sign', score: 0.1 }]);
  assert.equal(c.categoria, 'cao'); assert.ok(Math.abs(c.score - 0.55) < 1e-9);
  assert.equal(categoriaDe([{ nome: 'manhole cover', score: 0.9 }]), null);
  assert.equal(categoriaDe([]), null);
});

test('descrição: refino confiável manda; sem refino, a classe do COCO; porte pequeno x grande', () => {
  assert.equal(descreverAnimal('bird', { categoria: 'galinha', score: 0.6 }).nome, 'GALINHA/GALO');
  assert.equal(descreverAnimal('bird', null).nome, 'AVE');
  assert.equal(descreverAnimal('cow', null).porte, 'grande');
  assert.equal(descreverAnimal('bird', null).porte, 'pequeno');
  assert.equal(descreverAnimal('giraffe', null).porte, 'grande');
});

test('ladrilhos: 6 trechos dentro do quadro, quadrados em pixels, cobrindo o corredor do horizonte ao para-choque', () => {
  const roi = LIMIARES.transito.roi, asp = 16 / 9;
  const l = ladrilhosCorredor(roi, asp);
  assert.equal(l.length, 6);
  for (const b of l) {
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1 + 1e-9 && b.y + b.h <= 1 + 1e-9, JSON.stringify(b));
    assert.ok(Math.abs(b.w * asp - b.h) < 1e-9, 'quadrado em pixels');
  }
  assert.ok(Math.min(...l.map(b => b.y)) <= roi.topoY, 'chega ao horizonte');
  assert.ok(Math.max(...l.map(b => b.y + b.h)) >= roi.baseY - 0.01, 'chega perto do veículo');
});

test('recorte distante + fusão: detecção no recorte volta ao quadro e duplicata some (NMS)', () => {
  const roi = LIMIARES.transito.roi;
  const ret = recorteDistante(roi, 16 / 9);
  assert.ok(ret.y <= roi.topoY && ret.y + ret.h >= roi.topoY, 'recorte cobre o horizonte do corredor');
  const principal = [{ classe: 'car', score: 0.8, x: 0.4, y: 0.5, w: 0.1, h: 0.08 }];
  const cao = { classe: 'dog', score: 0.6, x: 0.5, y: 0.5, w: 0.1, h: 0.1 };   // no recorte
  const f = fundirDeteccoes(principal, [cao], ret);
  const d = f.find(x => x.classe === 'dog');
  assert.ok(d.doRecorte);
  assert.ok(Math.abs(d.x - (ret.x + 0.5 * ret.w)) < 1e-9 && Math.abs(d.w - 0.1 * ret.w) < 1e-9);
  // o mesmo carro visto nas duas passadas fica uma vez só, com a maior confiança
  const carroNoRecorte = { classe: 'car', score: 0.9, x: (0.4 - ret.x) / ret.w, y: (0.5 - ret.y) / ret.h, w: 0.1 / ret.w, h: 0.08 / ret.h };
  const g = fundirDeteccoes(principal, [carroNoRecorte], ret);
  assert.equal(g.filter(x => x.classe === 'car').length, 1);
  assert.equal(g[0].score, 0.9);
  // cão CORTADO pela borda do recorte (caixa menor, dentro da do quadro inteiro) não vira segundo alvo,
  // mesmo com confiança maior — falha real vista no teste de ponta a ponta (corgi com dois alvos)
  const caoInteiro = { classe: 'dog', score: 0.7, x: ret.x + 0.5 * ret.w, y: ret.y + 0.6 * ret.h, w: 0.2, h: 0.3 };
  const caoCortado = { classe: 'dog', score: 0.95, x: 0.5, y: 0.6, w: 0.3, h: 0.4 };   // encosta na borda inferior (0,6 + 0,4 = 1)
  const h = fundirDeteccoes([caoInteiro], [caoCortado], ret);
  assert.equal(h.filter(x => x.classe === 'dog').length, 1);
  assert.equal(h[0].score, 0.7, 'fica a caixa inteira do quadro, não a cortada');
});

test('varredura: cobra só é achado depois de 2 leituras seguidas do mesmo trecho; leitura fraca zera', () => {
  const f = new FaunaPista();
  const caixa = { x: 0.4, y: 0.6, w: 0.2, h: 0.3 };
  const cobra = [{ nome: 'king snake', score: 0.3 }, { nome: 'garter snake', score: 0.25 }];
  assert.equal(f.registrarLadrilho(3, caixa, cobra, 0), null, '1 leitura não basta');
  assert.equal(f.achados(100).length, 0);
  const ok = f.registrarLadrilho(3, caixa, cobra, 400);
  assert.equal(ok.categoria, 'cobra');
  const a = f.achados(500);
  assert.equal(a.length, 1); assert.equal(a[0].nome, 'COBRA'); assert.equal(a[0].porte, 'pequeno');
  f.registrarLadrilho(3, caixa, [{ nome: 'manhole cover', score: 0.8 }], 800);
  assert.equal(f.achados(900).length, 0, 'asfalto de novo: achado some');
  // leituras separadas por mais que a janela não confirmam
  const g = new FaunaPista();
  g.registrarLadrilho(1, caixa, cobra, 0);
  assert.equal(g.registrarLadrilho(1, caixa, cobra, 4000), null);
});

test('refino: categoria estável (não pisca para outra mais fraca) e expira com o alvo', () => {
  const f = new FaunaPista();
  f.registrarRefino(7, [{ nome: 'hen', score: 0.7 }], 0);
  assert.equal(f.refino(7).categoria, 'galinha');
  assert.equal(f.precisaRefino(7, 300), false); assert.equal(f.precisaRefino(7, 800), true);
  f.registrarRefino(7, [{ nome: 'goose', score: 0.35 }], 800);
  assert.equal(f.refino(7).categoria, 'galinha', 'leitura mais fraca de outra categoria não troca');
  f.esquecer(new Set());
  assert.equal(f.refino(7), null);
});

test('trânsito: ave refinada como GALINHA no corredor é AVISO (pequeno); vaca refinada como BOI é CRÍTICO', () => {
  const rodar = (classe, refino) => {
    const a = new AnalisadorTransito();
    let r;
    for (let t = 0; t <= 900; t += 50) {
      const tr = { id: 4, classe, score: 0.9, x: 0.45, y: 0.6, w: 0.1, h: 0.15, vx: 0, vy: 0, hits: 20, nasceu: 0, historico: [] };
      r = a.processar({ t, trilhas: [tr], fauna: { refino: () => refino, achados: [] } });
    }
    return r.condicoes.find(c => c.grupo === 'animal');
  };
  const gal = rodar('bird', { categoria: 'galinha', score: 0.7 });
  assert.equal(gal.nivel, 'aviso'); assert.match(gal.titulo, /GALINHA/); assert.match(gal.detalhe, /não desvie bruscamente/);
  const boi = rodar('cow', { categoria: 'bovino', score: 0.6 });
  assert.equal(boi.nivel, 'critico'); assert.match(boi.titulo, /BOI\/VACA/);
});

test('trânsito: achado da varredura (cobra) vira POSSÍVEL COBRA NA PISTA e conta como animal', () => {
  const a = new AnalisadorTransito();
  const achado = { indice: 2, categoria: 'cobra', score: 0.6, seguidas: 2, em: 0, caixa: { x: 0.4, y: 0.6, w: 0.2, h: 0.3 }, nome: 'COBRA', fala: 'cobra', porte: 'pequeno' };
  const r = a.processar({ t: 0, trilhas: [], fauna: { refino: () => null, achados: [achado] } });
  const c = r.condicoes.find(x => x.grupo === 'fauna');
  assert.equal(c.titulo, 'POSSÍVEL COBRA NA PISTA'); assert.equal(c.nivel, 'aviso');
  assert.equal(r.metricas.contagem.animal, 1);
  assert.equal(r.achados.length, 1);
});

test('classe do LABORATÓRIO: refino vence o ImageNet (foi o operador quem ensinou) e ladrilho confirma em 2 leituras', () => {
  const f = new FaunaPista();
  const veado = { conceito: { id: 'v1', nome: 'VEADO', porte: 'grande' }, similaridade: 0.81 };
  f.registrarRefino(3, [{ nome: 'impala', score: 0.5 }], 0);
  f.registrarRefinoPersonalizado(3, veado, 100);
  const d = descreverAnimal('horse', f.refino(3));
  assert.equal(d.nome, 'VEADO'); assert.equal(d.porte, 'grande'); assert.equal(d.refinado, true);
  const caixa = { x: 0.4, y: 0.6, w: 0.2, h: 0.3 };
  assert.equal(f.registrarLadrilhoPersonalizado(1, caixa, veado, 0), null);
  assert.ok(f.registrarLadrilhoPersonalizado(1, caixa, veado, 300));
  const a = f.achados(400);
  assert.equal(a[0].nome, 'VEADO'); assert.equal(a[0].porte, 'grande'); assert.equal(a[0].fala, 'veado');
});
