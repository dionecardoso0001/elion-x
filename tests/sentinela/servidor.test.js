import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import { devoDesviar } from '../../fallback.mjs';
import {
  montarCorpo, analisarCena, validarPedido, criarLimitador, normalizarAnalise,
  interpretarBruto, servirMediapipe, statusSentinela, ESQUEMA, MODELO,
} from '../../sentinela.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IMG = 'A'.repeat(400);
const PEDIDO = { imagem: IMG, mediaType: 'image/jpeg', modo: 'sentinela', telemetria: { alvos: [] } };
const ANALISE = { resumo: 'Cena tranquila.', nivel_risco: 'baixo', comportamentos: [], recomendacoes: ['manter vigilância'], divergencias: [], confianca: 'alta' };

/** fetch falso que registra a chamada e devolve o que o teste mandar. */
function fetchFalso(resposta, status = 200) {
  const chamadas = [];
  const f = async (url, init) => {
    chamadas.push({ url, init, corpo: JSON.parse(init.body) });
    return {
      ok: status >= 200 && status < 300, status,
      json: async () => resposta, text: async () => JSON.stringify(resposta),
    };
  };
  f.chamadas = chamadas;
  return f;
}

test('corpo da requisição segue o contrato atual da API', () => {
  const c = montarCorpo(PEDIDO);
  assert.equal(c.model, 'claude-opus-5-5');
  assert.equal(c.output_config.format.type, 'json_schema');
  assert.equal(c.output_config.effort, 'low');
  assert.equal(c.fallbacks, 'default');
  assert.equal(c.temperature, undefined, 'a versão 2026-10-21 rejeita temperature');
  assert.equal(c.thinking, undefined, 'Opus 5.5: thinking sempre ligado, controle pelo esforço');
  assert.deepEqual(c.system[0].cache_control, { type: 'ephemeral' });
  assert.equal(c.messages[0].content[0].type, 'image');
  assert.match(c.messages[0].content[1].text, /⟦DADO⟧[\s\S]*⟦\/DADO⟧/, 'telemetria cercada como dado');
});

test('modelos sem suporte não recebem fallbacks nem esforço', () => {
  assert.equal(montarCorpo(PEDIDO, 'claude-haiku-4-5').fallbacks, undefined);
  assert.equal(montarCorpo(PEDIDO, 'claude-haiku-4-5').output_config.effort, undefined);
  assert.equal(montarCorpo(PEDIDO, 'claude-sonnet-4-6').fallbacks, undefined);
  assert.equal(montarCorpo(PEDIDO, 'claude-sonnet-4-6').output_config.effort, 'low');
});

test('esquema de saída obedece às restrições de structured outputs', () => {
  const visita = (s, caminho) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false, `${caminho}: additionalProperties precisa ser false`);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), `${caminho}: todos os campos obrigatórios`);
      for (const [k, v] of Object.entries(s.properties)) visita(v, `${caminho}.${k}`);
    }
    if (s.type === 'array') visita(s.items, `${caminho}[]`);
    for (const proibido of ['minimum', 'maximum', 'minLength', 'maxLength'])
      assert.equal(s[proibido], undefined, `${caminho}: ${proibido} não é suportado`);
  };
  visita(ESQUEMA, 'raiz');
});

test('chamada bem-sucedida: cabeçalhos corretos e análise normalizada', async () => {
  const f = fetchFalso({ model: MODELO, stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(ANALISE) }],
    usage: { input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 700 } });
  const r = await analisarCena({ apiKey: 'sk-teste', ...PEDIDO, fetchImpl: f });
  const h = f.chamadas[0].init.headers;
  assert.equal(f.chamadas[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(h['anthropic-version'], '2026-10-21');
  assert.equal(h['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(h['x-api-key'], 'sk-teste');
  assert.equal(r.analise.nivel_risco, 'baixo');
  assert.deepEqual(r.uso, { entrada: 900, saida: 120, cache: 700 });
  assert.equal(r.provedor, 'anthropic');
});

test('recusa e truncamento são tratados antes de ler o conteúdo', async () => {
  const recusa = await analisarCena({ apiKey: 'k', ...PEDIDO, fetchImpl: fetchFalso({ model: MODELO, stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }) });
  assert.equal(recusa.recusa, true); assert.equal(recusa.categoria, 'cyber');
  await assert.rejects(analisarCena({ apiKey: 'k', ...PEDIDO, fetchImpl: fetchFalso({ stop_reason: 'max_tokens', content: [] }) }), /truncada/);
});

test('erro HTTP carrega o status — e só erro de PROVEDOR aciona a contingência', async () => {
  const sobrecarga = await analisarCena({ apiKey: 'k', ...PEDIDO, fetchImpl: fetchFalso({ error: { message: 'Overloaded' } }, 529) }).catch(e => e);
  assert.match(sobrecarga.message, /HTTP 529/);
  assert.equal(devoDesviar(sobrecarga), true);
  const pedidoRuim = await analisarCena({ apiKey: 'k', ...PEDIDO, fetchImpl: fetchFalso({ error: { message: 'invalid image' } }, 400) }).catch(e => e);
  assert.equal(devoDesviar(pedidoRuim), false, 'defeito de pedido não pode virar desvio de provedor');
});

test('validação do pedido recusa entrada malformada ou abusiva', () => {
  assert.throws(() => validarPedido({ ...PEDIDO, imagem: 'x' }), /ausente/);
  assert.throws(() => validarPedido({ ...PEDIDO, imagem: '<script>' + IMG }), /base64/);
  assert.throws(() => validarPedido({ ...PEDIDO, imagem: 'A'.repeat(3_000_001) }), /grande demais/);
  assert.throws(() => validarPedido({ ...PEDIDO, modo: 'espionar' }), /modo/);
  assert.throws(() => validarPedido({ ...PEDIDO, mediaType: 'image/svg+xml' }), /tipo/);
  assert.throws(() => validarPedido({ ...PEDIDO, telemetria: { x: 'y'.repeat(20001) } }), /telemetria/);
  assert.equal(validarPedido(PEDIDO).modo, 'sentinela');
});

test('limitador: 8 por minuto, recarrega com o tempo', () => {
  let agora = 0;
  const l = criarLimitador({ porMinuto: 8, agora: () => agora });
  for (let k = 0; k < 8; k++) assert.equal(l.permitir(), true);
  assert.equal(l.permitir(), false);
  agora = 7500;   // 7,5 s → 1 ficha nova
  assert.equal(l.permitir(), true);
  assert.equal(l.permitir(), false);
});

test('normalização defende tipos, enums e tamanhos mesmo com saída estranha', () => {
  const n = normalizarAnalise({ resumo: 'x'.repeat(5000), nivel_risco: 'apocalíptico', comportamentos: [{ risco: 'x' }], confianca: 99 });
  assert.equal(n.resumo.length, 600);
  assert.equal(n.nivel_risco, 'baixo');
  assert.equal(n.comportamentos[0].risco, 'baixo');
  assert.equal(n.confianca, 'baixa');
  assert.deepEqual(interpretarBruto('Claro! Aqui está: {"resumo":"ok","nivel_risco":"alto"} fim').analise.nivel_risco, 'alto');
  assert.equal(interpretarBruto('sem json nenhum').analise.confianca, 'baixa');
});

test('rota do runtime: lista branca, versão exata e nada de travessia', () => {
  const res = () => { const r = { code: null, headers: {}, writeHead(c, h) { r.code = c; r.headers = h || {}; }, end() {}, on() {}, once() {}, emit() {}, write() {} }; return r; };
  const url = p => new URL(p, 'http://localhost');
  assert.equal(servirMediapipe(url('/assets/app.css'), res(), RAIZ), false, 'rota alheia não é tratada');
  for (const p of ['/vendor/mediapipe/0.0.1/vision_bundle.mjs', '/vendor/mediapipe/1.1.1/package.json',
    '/vendor/mediapipe/1.1.1/wasm/..%2f..%2fpackage.json', '/vendor/mediapipe/1.1.1/vision.d.ts']) {
    const r = res();
    assert.equal(servirMediapipe(url(p), r, RAIZ), true);
    assert.equal(r.code, 404, p);
  }
});

test('status informa runtime local e disponibilidade do agente sem mentir', () => {
  const s = statusSentinela({ raiz: RAIZ, temClaude: false, temContingencia: false });
  assert.equal(s.agente.disponivel, false);
  assert.equal(s.agente.modelo, null);
  assert.equal(statusSentinela({ raiz: RAIZ, temClaude: true }).agente.modelo, MODELO);
  assert.ok('objetos' in s.modelos && 'rosto' in s.modelos && 'pose' in s.modelos);
});
