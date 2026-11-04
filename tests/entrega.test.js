import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {
  escolherCodificacao, etagDe, casaETag, pareceArquivo, destinoEstatico, classificarCaminho,
  criarEntregador, CABECALHOS_SEGURANCA,
} from '../estaticos.mjs';

test('Accept-Encoding: pesos q decidem; empate favorece brotli; q=0 recusa', () => {
  assert.equal(escolherCodificacao('gzip, deflate, br, zstd'), 'br');
  assert.equal(escolherCodificacao('gzip'), 'gzip');
  assert.equal(escolherCodificacao('br;q=0, gzip'), 'gzip');
  assert.equal(escolherCodificacao('gzip;q=1, br;q=0.5'), 'gzip', 'q maior vence a preferência da casa');
  assert.equal(escolherCodificacao('*'), 'br');
  assert.equal(escolherCodificacao('*;q=0'), null);
  assert.equal(escolherCodificacao('br;q=0, *'), 'gzip');
  assert.equal(escolherCodificacao('identity'), null);
  assert.equal(escolherCodificacao(''), null);
  assert.equal(escolherCodificacao(undefined), null);
  assert.equal(escolherCodificacao('GZIP ; Q=0.8'), 'gzip', 'nome e parâmetro sem distinção de caixa');
});

test('ETag: uma por versão E por codificação; If-None-Match com lista, W/ e *', () => {
  const st = { size: 1000, mtimeMs: 1730000000123.7 };
  const e = etagDe(st), b = etagDe(st, 'br'), g = etagDe(st, 'gzip');
  assert.equal(new Set([e, b, g]).size, 3, 'representações diferentes não podem dividir a ETag');
  assert.notEqual(etagDe({ ...st, mtimeMs: st.mtimeMs + 1000 }), e, 'arquivo alterado muda a ETag');
  assert.ok(casaETag(`"x", ${b}`, b));
  assert.ok(casaETag(`W/${b}`, b), 'comparação fraca (RFC 9110 §13.1.2)');
  assert.ok(casaETag('*', b));
  assert.ok(!casaETag(g, b));
  assert.ok(!casaETag(undefined, b));
});

test('404 real para ARQUIVO inexistente; rota sem extensão continua na página principal', () => {
  assert.ok(pareceArquivo('robots.txt') && pareceArquivo('assets/x.min.js') && pareceArquivo('a/b/c.webmanifest'));
  assert.ok(!pareceArquivo('sentinela') && !pareceArquivo('v1.2/rota') && !pareceArquivo('') && !pareceArquivo('assets/'));
  assert.equal(destinoEstatico('robots.txt', 'publico', true), 'servir');
  assert.equal(destinoEstatico('assets/nao-existe.js', 'publico', false), '404', 'antes: index.html com 200');
  assert.equal(destinoEstatico('favicon.ico', 'desconhecido', false), '404');
  assert.equal(destinoEstatico('package.json', 'desconhecido', true), '404', 'fora da lista: mesma resposta exista ou não');
  assert.equal(destinoEstatico('sentinela', 'desconhecido', false), 'principal');
  assert.equal(destinoEstatico('.env', 'negado', true), '404');
  assert.equal(classificarCaminho('/robots.txt'), 'publico');
  assert.equal(CABECALHOS_SEGURANCA['X-Robots-Tag'], 'noindex, nofollow');
  assert.match(fs.readFileSync(new URL('../robots.txt', import.meta.url), 'utf8'), /^User-agent: \*\s*\nDisallow: \/\s*$/m);
});

/* ── integração: servidor HTTP de verdade, cliente cru (sem descompressão automática) ── */
function pedir(porta, caminho, cabecalhos = {}, metodo = 'GET') {
  return new Promise((ok, falha) => {
    const r = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers: cabecalhos }, res => {
      const partes = [];
      res.on('data', c => partes.push(c));
      res.on('end', () => ok({ status: res.statusCode, h: res.headers, corpo: Buffer.concat(partes) }));
    });
    r.on('error', falha); r.end();
  });
}

test('entrega: brotli/gzip corretos, 304 por ETag, HEAD sem corpo, binário e arquivo pequeno sem compressão', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elx-entrega-'));
  const js = path.join(dir, 'app.js'), mini = path.join(dir, 'mini.css'), bin = path.join(dir, 'modelo.tflite');
  const texto = Buffer.from('export const linha = "ELION-X SENTINELA";\n'.repeat(2000));
  fs.writeFileSync(js, texto);
  fs.writeFileSync(mini, 'a{b:c}');
  fs.writeFileSync(bin, Buffer.alloc(8192, 7));
  const ent = criarEntregador();
  const mapa = { '/app.js': [js, 'application/javascript'], '/mini.css': [mini, 'text/css'], '/modelo.tflite': [bin, 'application/octet-stream'] };
  const srv = http.createServer((req, res) => {
    const [arq, tipo] = mapa[req.url];
    ent.servir(req, res, arq, { tipo, cacheControl: 'no-cache', cabecalhos: { 'X-Content-Type-Options': 'nosniff' } });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const porta = srv.address().port;

  const br = await pedir(porta, '/app.js', { 'Accept-Encoding': 'gzip, br' });
  assert.equal(br.status, 200);
  assert.equal(br.h['content-encoding'], 'br');
  assert.equal(br.h.vary, 'Accept-Encoding');
  assert.equal(Number(br.h['content-length']), br.corpo.length);
  assert.ok(br.corpo.length < texto.length / 10, `brotli deveria encolher texto repetitivo (${br.corpo.length} B)`);
  assert.deepEqual(zlib.brotliDecompressSync(br.corpo), texto, 'descomprime byte a byte no original');
  assert.match(br.h.etag, /-br"$/);
  assert.equal(br.h['x-content-type-options'], 'nosniff');

  const gz = await pedir(porta, '/app.js', { 'Accept-Encoding': 'gzip' });
  assert.equal(gz.h['content-encoding'], 'gzip');
  assert.deepEqual(zlib.gunzipSync(gz.corpo), texto);

  const cru = await pedir(porta, '/app.js');
  assert.equal(cru.h['content-encoding'], undefined);
  assert.equal(Number(cru.h['content-length']), texto.length);
  assert.deepEqual(cru.corpo, texto);

  const nm = await pedir(porta, '/app.js', { 'Accept-Encoding': 'br', 'If-None-Match': br.h.etag });
  assert.equal(nm.status, 304);
  assert.equal(nm.corpo.length, 0);
  assert.equal(nm.h.etag, br.h.etag);
  const outra = await pedir(porta, '/app.js', { 'Accept-Encoding': 'gzip', 'If-None-Match': br.h.etag });
  assert.equal(outra.status, 200, 'ETag do brotli não valida a cópia gzip');

  const head = await pedir(porta, '/app.js', { 'Accept-Encoding': 'br' }, 'HEAD');
  assert.equal(head.status, 200); assert.equal(head.corpo.length, 0);
  assert.equal(head.h['content-length'], br.h['content-length']);

  const p = await pedir(porta, '/mini.css', { 'Accept-Encoding': 'br' });
  assert.equal(p.h['content-encoding'], undefined, 'abaixo de 1 KiB não compensa');
  const m = await pedir(porta, '/modelo.tflite', { 'Accept-Encoding': 'br' });
  assert.equal(m.h['content-encoding'], undefined, 'pesos de modelo não entram (encolhem ~12%)');
  assert.equal(m.h.vary, undefined);

  // cache: duas codificações do mesmo arquivo = 2 entradas, por mais pedidos que venham
  assert.equal(ent.entradas, 2);
  // arquivo alterado: ETag nova e conteúdo novo (nada de corpo velho do cache)
  const novo = Buffer.from('export const v = 2;\n'.repeat(500));
  fs.writeFileSync(js, novo);
  fs.utimesSync(js, new Date(), new Date(Date.now() + 5000));
  const depois = await pedir(porta, '/app.js', { 'Accept-Encoding': 'br', 'If-None-Match': br.h.etag });
  assert.equal(depois.status, 200);
  assert.notEqual(depois.h.etag, br.h.etag);
  assert.deepEqual(zlib.brotliDecompressSync(depois.corpo), novo);
});

test('entrega: pedidos simultâneos comprimem uma vez só e o teto de memória é respeitado', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elx-entrega-'));
  try {
    // base64 de bytes aleatórios: comprime pouco (~75%), então 3 arquivos estouram o teto de 40 kB
    const arqs = [1, 2, 3].map(i => {
      const f = path.join(dir, `f${i}.js`);
      fs.writeFileSync(f, crypto.randomBytes(22500).toString('base64'));
      return f;
    });
    const ent = criarEntregador({ maxBytes: 40000 });
    const st = fs.statSync(arqs[0]);
    const [a, b] = await Promise.all([ent.comprimido(arqs[0], st, 'br'), ent.comprimido(arqs[0], st, 'br')]);
    assert.equal(a, b, 'mesma promessa: compressão deduplicada');
    for (const f of arqs) await ent.comprimido(f, fs.statSync(f), 'gzip');
    assert.ok(ent.bytesEmCache <= 40000, `cache passou do teto: ${ent.bytesEmCache} B`);
    assert.ok(ent.entradas < 4, 'entradas antigas foram despejadas');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
