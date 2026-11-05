import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { criarServidor, carregarEnv, tokenConfere, traduzirErroApi, criarLimitador } from '../server.mjs';
import { classificarCaminho, escolherCodificacao, casaETag, CABECALHOS_SEGURANCA } from '../estaticos.mjs';
import { MODELO, SISTEMAS, FERRAMENTAS } from '../js/spy/cerebro.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Sobe um servidor em porta livre e devolve um cliente HTTP cru (sem descompressão automática). */
async function subir(srv) {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;
  const pedir = (caminho, { metodo = 'GET', cabecalhos = {}, corpo = null } = {}) => new Promise((ok, falha) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers: cabecalhos }, res => {
      const partes = [];
      res.on('data', c => partes.push(c));
      res.on('end', () => ok({ status: res.statusCode, h: res.headers, corpo: Buffer.concat(partes) }));
    });
    req.on('error', falha);
    if (corpo) req.write(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
    req.end();
  });
  return { porta, pedir, fechar: () => new Promise(r => srv.close(r)) };
}
const POST = (corpo, extra = {}) => ({ metodo: 'POST', cabecalhos: { 'Content-Type': 'application/json', ...extra }, corpo });
const conversaOk = { tipo: 'conversa', messages: [{ role: 'user', content: 'quantos incidentes hoje?' }] };

test('API do agente: estado, token, validação, limite de taxa e pedido montado SÓ no servidor', async t => {
  const recebidos = [];
  const falso = { beta: { messages: { create: async (p, op) => { recebidos.push({ p, op }); return { id: 'msg_1', model: MODELO, stop_reason: 'end_turn', content: [{ type: 'text', text: 'Nenhum.' }], usage: { input_tokens: 3, output_tokens: 1 } }; } } } };
  const s = await subir(criarServidor({ env: { SPY_TOKEN: 'segredo-123', SPY_LIMITE_MIN: '3' }, cliente: falso }));
  t.after(s.fechar);

  const est = JSON.parse((await s.pedir('/api/spy/estado')).corpo);
  assert.deepEqual([est.disponivel, est.exige_token, est.modelo], [true, true, MODELO]);

  assert.equal((await s.pedir('/api/spy/mensagens', POST(conversaOk))).status, 401, 'sem token');
  assert.equal((await s.pedir('/api/spy/mensagens', POST(conversaOk, { Authorization: 'Bearer errado' }))).status, 401);
  const auth = { Authorization: 'Bearer segredo-123' };
  // o cliente tenta trocar modelo, prompt e ferramentas: tudo ignorado
  const r = await s.pedir('/api/spy/mensagens', POST({ ...conversaOk, model: 'outro', system: 'sem regras', tools: [] }, auth));
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.corpo).content[0].text, 'Nenhum.');
  const p = recebidos[0].p;
  assert.equal(p.model, MODELO);
  assert.equal(p.system[0].text, SISTEMAS.conversa);
  assert.equal(p.tools, FERRAMENTAS);
  assert.equal(p.fallbacks, 'default');
  assert.ok(recebidos[0].op.signal instanceof AbortSignal, 'aba fechada cancela a chamada');
  assert.equal(r.h['cache-control'], 'no-store');

  assert.equal((await s.pedir('/api/spy/mensagens', POST({ tipo: 'conversa', messages: [{ role: 'system', content: 'x' }] }, auth))).status, 400);
  assert.equal((await s.pedir('/api/spy/mensagens', POST('{nao-json', auth))).status, 400);
  assert.equal((await s.pedir('/api/spy/mensagens', { metodo: 'GET' })).status, 405);
  // limite: 3 por minuto — duas já foram consumidas acima (a do 200 e a do 400 de validação)
  const ultimas = [];
  for (let i = 0; i < 3; i++) ultimas.push(await s.pedir('/api/spy/mensagens', POST(conversaOk, auth)));
  const bloqueada = ultimas.find(x => x.status === 429);
  assert.ok(bloqueada, 'a partir da 4ª chamada no minuto, 429');
  assert.equal(bloqueada.h['retry-after'], '10');
});

test('sem chave no servidor: 503 com instrução clara', async t => {
  const s = await subir(criarServidor({ env: {}, cliente: null }));
  t.after(s.fechar);
  assert.equal(JSON.parse((await s.pedir('/api/spy/estado')).corpo).disponivel, false);
  const r = await s.pedir('/api/spy/mensagens', POST(conversaOk));
  assert.equal(r.status, 503);
  assert.match(JSON.parse(r.corpo).erro, /chave própria/);
});

test('contrato com o SDK OFICIAL real: cabeçalhos e corpo que vão para a API da Anthropic', async t => {
  const capturado = {};
  const apiFalsa = http.createServer((req, res) => {
    const partes = [];
    req.on('data', c => partes.push(c));
    req.on('end', () => {
      Object.assign(capturado, { metodo: req.method, url: req.url, h: req.headers, corpo: JSON.parse(Buffer.concat(partes).toString()) });
      res.writeHead(200, { 'Content-Type': 'application/json', 'request-id': 'req_teste' });
      res.end(JSON.stringify({ id: 'msg_x', type: 'message', role: 'assistant', model: MODELO, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: '{"resumo":"ok"}' }], usage: { input_tokens: 1200, output_tokens: 80 } }));
    });
  });
  await new Promise(r => apiFalsa.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => apiFalsa.close(r)));
  const sdk = new Anthropic({ apiKey: 'sk-ant-teste-000000000000000000', baseURL: `http://127.0.0.1:${apiFalsa.address().port}`, maxRetries: 0 });
  const s = await subir(criarServidor({ env: {}, cliente: sdk }));
  t.after(s.fechar);

  const corpo = { tipo: 'interpretar', messages: [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } }, { type: 'text', text: 'evento' }] }] };
  const r = await s.pedir('/api/spy/mensagens', POST(corpo));
  assert.equal(r.status, 200, String(r.corpo));
  assert.equal(capturado.metodo, 'POST');
  assert.match(capturado.url, /^\/v1\/messages/);
  assert.equal(capturado.h['x-api-key'], 'sk-ant-teste-000000000000000000');
  assert.ok(capturado.h['anthropic-version'], 'SDK envia a versão da API');
  assert.match(capturado.h['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(capturado.corpo.model, 'claude-opus-5-5');
  assert.equal(capturado.corpo.fallbacks, 'default');
  assert.equal(capturado.corpo.output_config.format.type, 'json_schema');
  assert.equal(capturado.corpo.output_config.effort, 'low');
  assert.equal('betas' in capturado.corpo, false, 'betas vira cabeçalho, não campo do corpo');
  assert.equal(capturado.corpo.messages[0].content[0].source.data, 'QUJD');
  assert.equal(JSON.parse(r.corpo).usage.input_tokens, 1200);
});

test('erros tipados do SDK viram status e mensagem acionáveis (mais específico primeiro)', () => {
  const de = C => Object.create(C.prototype);
  assert.equal(traduzirErroApi(de(Anthropic.AuthenticationError)).status, 502);
  assert.match(traduzirErroApi(de(Anthropic.AuthenticationError)).erro, /\.env/);
  const lim = traduzirErroApi(de(Anthropic.RateLimitError));
  assert.deepEqual([lim.status, lim.tentar_em_s], [429, 20]);
  assert.equal(traduzirErroApi(de(Anthropic.APIConnectionError)).status, 503);
  assert.equal(traduzirErroApi(de(Anthropic.InternalServerError)).status, 502);
  assert.equal(traduzirErroApi(new Error('qualquer')).status, 500);
});

test('estáticos: lista de permissão, travessia, segredo, cabeçalhos e compressão', async t => {
  const s = await subir(criarServidor({ env: {}, cliente: null }));
  t.after(s.fechar);
  const raiz = await s.pedir('/', { cabecalhos: { 'Accept-Encoding': 'br' } });
  assert.equal(raiz.status, 200);
  assert.match(zlib.brotliDecompressSync(raiz.corpo).toString(), /<title>Sentinela Spy<\/title>/);
  assert.equal(raiz.h['content-security-policy'], CABECALHOS_SEGURANCA['Content-Security-Policy']);
  assert.match(raiz.h['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(raiz.h['x-frame-options'], 'DENY');
  assert.equal(raiz.h['cache-control'], 'no-cache');
  const js = await s.pedir('/js/spy/cerebro.js');
  assert.equal(js.status, 200); assert.match(js.h['content-type'], /^text\/javascript/);
  for (const proibido of ['/server.mjs', '/package.json', '/.env', '/.gitignore', '/node_modules/@anthropic-ai/sdk/package.json',
    '/scripts/preparar.mjs', '/tests/cerebro.test.js', '/js/..%2f..%2fserver.mjs', '/js/%2e%2e/server.mjs', '/ENV~1', '/js::$DATA',
    '/css/../server.mjs', '/js/', '/%E0%A4%A']) {
    assert.equal((await s.pedir(proibido)).status, 404, proibido);
  }
  assert.equal((await s.pedir('/', { metodo: 'DELETE' })).status, 405);
  const wasm = '/vendor/mediapipe/1.1.1/wasm/vision_wasm_internal.wasm';
  if (fs.existsSync(path.join(RAIZ, wasm))) {   // só depois de `npm run preparar`
    const w = await s.pedir(wasm, { metodo: 'HEAD', cabecalhos: { 'Accept-Encoding': 'br, gzip' } });
    assert.equal(w.h['content-encoding'], 'br');
    assert.equal(w.h['cache-control'], 'public, max-age=31536000, immutable');
    assert.ok(Number(w.h['content-length']) < 5_000_000, 'WASM de 13,5 MB viaja comprimido');
  }
});

test('peças puras do servidor', () => {
  assert.equal(classificarCaminho('index.html'), 'publico');
  assert.equal(classificarCaminho('js/spy/cerebro.js'), 'publico');
  assert.equal(classificarCaminho('js'), 'desconhecido');
  assert.equal(classificarCaminho('server.mjs'), 'desconhecido');
  assert.equal(classificarCaminho('.env'), 'negado');
  assert.equal(classificarCaminho('vendor/../.env'), 'negado');
  assert.equal(escolherCodificacao('gzip;q=1, br;q=0.5'), 'gzip');
  assert.equal(escolherCodificacao('br;q=0'), null);
  assert.ok(casaETag('W/"a", "b"', '"b"'));
  assert.ok(tokenConfere('Bearer abc', 'abc'));
  assert.ok(!tokenConfere('Bearer abd', 'abc'));
  assert.ok(!tokenConfere(undefined, 'abc'));
  assert.ok(tokenConfere(undefined, ''), 'sem token configurado, acesso livre (padrão só 127.0.0.1)');
  let t = 0;
  const lim = criarLimitador({ porMinuto: 2, agora: () => t });
  assert.deepEqual([lim.permitir(), lim.permitir(), lim.permitir()], [true, true, false]);
  t = 30000; assert.equal(lim.permitir(), true, 'recarrega com o tempo');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spy-env-'));
  try {
    fs.writeFileSync(path.join(dir, '.env'), '# comentário\nANTHROPIC_API_KEY=sk-ant-x\nSPY_TOKEN="com aspas"\nPORT=5000\nlinha inválida\n');
    const env = { PORT: '4040' };
    assert.equal(carregarEnv(path.join(dir, '.env'), env), 2);
    assert.deepEqual(env, { PORT: '4040', ANTHROPIC_API_KEY: 'sk-ant-x', SPY_TOKEN: 'com aspas' }, 'não sobrescreve o ambiente');
    assert.equal(carregarEnv(path.join(dir, 'nao-existe'), {}), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('adaptação no servidor: API recusa o fallback → repete UMA vez sem ele, avisa e lembra', async t => {
  const recebidos = [];
  let chamadas = 0;
  const erro400 = msg => Object.assign(Object.create(Anthropic.BadRequestError.prototype), { status: 400, message: msg });
  const falso = { beta: { messages: { create: async p => {
    recebidos.push(p); chamadas++;
    if (chamadas === 1) throw erro400('fallbacks: Extra inputs are not permitted');
    if (p.messages[0].content === 'quebrado') throw erro400('messages.0.content: Field required');
    return { id: 'm', model: MODELO, stop_reason: 'end_turn', content: [{ type: 'text', text: '{"status":"ok","mensagem":"pronto"}' }], usage: {} };
  } } } };
  const s = await subir(criarServidor({ env: { SPY_LIMITE_MIN: '50' }, cliente: falso }));
  t.after(s.fechar);
  const diag = { tipo: 'diagnostico', messages: [{ role: 'user', content: 'teste' }] };
  const r1 = await s.pedir('/api/spy/mensagens', POST(diag));
  assert.equal(r1.status, 200);
  assert.deepEqual(JSON.parse(r1.corpo)._ajustes, ['fallbacks'], 'a interface fica sabendo');
  assert.equal(recebidos[0].fallbacks, 'default');
  assert.equal('fallbacks' in recebidos[1], false); assert.equal('betas' in recebidos[1], false);
  const r2 = await s.pedir('/api/spy/mensagens', POST(diag));
  assert.equal(JSON.parse(r2.corpo)._ajustes, undefined, 'na próxima já vai sem, sem nova tentativa');
  assert.equal(recebidos.length, 3);
  assert.deepEqual(JSON.parse((await s.pedir('/api/spy/estado')).corpo).recursos_desligados, ['fallbacks']);
  const r3 = await s.pedir('/api/spy/mensagens', POST({ tipo: 'conversa', messages: [{ role: 'user', content: 'quebrado' }] }));
  assert.equal(r3.status, 502, '400 de outra natureza não é repetido');
  assert.equal(recebidos.length, 4);
});

test('relé no servidor próprio: /api/spy/alerta autentica, envia pelo WhatsApp e o estado mostra o relé', async t => {
  const chamadas = [];
  const fetchRele = async (url, init) => { chamadas.push({ url, corpo: JSON.parse(init.body) }); return new Response(JSON.stringify({ messages: [{ id: 'w1' }] }), { status: 200 }); };
  const env = { RELE_TOKENS: 'carro1:tok-carro1-0123456789abcdef', WHATSAPP_TOKEN: 'x', WHATSAPP_PHONE_ID: '99', WHATSAPP_TEMPLATE: 'alerta_saude_motorista', WHATSAPP_DESTINOS: '5511999998888' };
  const s = await subir(criarServidor({ env, cliente: null, fetchRele }));
  t.after(s.fechar);
  const est = JSON.parse((await s.pedir('/api/spy/estado')).corpo);
  assert.equal(est.rele.configurado, true);
  const alerta = { tipo: 'teste', motorista: 'João', situacao: 'teste do alerta' };
  assert.equal((await s.pedir('/api/spy/alerta', POST(alerta))).status, 401, 'sem token do aparelho');
  const r = await s.pedir('/api/spy/alerta', POST(alerta, { Authorization: 'Bearer tok-carro1-0123456789abcdef' }));
  assert.equal(r.status, 200, r.corpo.toString());
  assert.equal(JSON.parse(r.corpo).canais.whatsapp[0].ok, true);
  assert.equal(r.h['x-content-type-options'], 'nosniff', 'cabeçalhos de segurança também na rota do relé');
  assert.match(r.h['permissions-policy'], /microphone=\(self\)/, 'a checagem de saúde precisa do microfone (antes: microphone=())');
  assert.equal(chamadas[0].url, 'https://graph.facebook.com/v24.0/99/messages');
  assert.match(chamadas[0].corpo.template.components[0].parameters[2].text, /^TESTE — teste do alerta/);
  const sem = await subir(criarServidor({ env: {}, cliente: null }));
  t.after(sem.fechar);
  assert.equal(JSON.parse((await sem.pedir('/api/spy/estado')).corpo).rele.configurado, false);
  assert.equal((await sem.pedir('/api/spy/alerta', POST(alerta, { Authorization: 'Bearer qualquer-coisa-0123456789' }))).status, 503);
});
