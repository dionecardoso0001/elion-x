import test from 'node:test';
import assert from 'node:assert/strict';
import { enviarAlerta, resumoEnvio, criarFila, releLiberado } from '../js/spy/alerta.js';

const resp = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
const semEspera = async () => {};

test('envio: token no cabeçalho, corpo JSON; sucesso na 1ª tentativa', async () => {
  const chamadas = [];
  const r = await enviarAlerta({ url: 'https://rele/alerta', token: 'tok', alerta: { tipo: 'teste' }, esperar: semEspera,
    fetchFn: async (u, i) => { chamadas.push({ u, i }); return resp(200, { ok: true, canais: { email: { ok: true } } }); } });
  assert.equal(r.ok, true); assert.equal(r.tentativas, 1);
  assert.equal(chamadas[0].i.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(chamadas[0].i.body), { tipo: 'teste' });
});

test('envio: sem rede e 5xx são repetidos (3 tentativas); 401/400 não são', async () => {
  let n = 0;
  const r = await enviarAlerta({ url: 'u', token: 't', alerta: {}, esperar: semEspera, fetchFn: async () => { n++; if (n < 3) throw new TypeError('Failed to fetch'); return resp(200, { ok: true }); } });
  assert.equal(r.ok, true); assert.equal(r.tentativas, 3);
  let m = 0;
  const falhou = await enviarAlerta({ url: 'u', token: 't', alerta: {}, esperar: semEspera, fetchFn: async () => { m++; throw new TypeError('Failed to fetch'); } });
  assert.equal(falhou.ok, false); assert.equal(falhou.rede, true); assert.equal(m, 3);
  let k = 0;
  const negado = await enviarAlerta({ url: 'u', token: 't', alerta: {}, esperar: semEspera, fetchFn: async () => { k++; return resp(401, { erro: 'token do aparelho inválido ou ausente' }); } });
  assert.equal(k, 1, '401 não repete'); assert.match(negado.erro, /token/);
  // 502 = o relé respondeu, mas nenhum canal entregou: devolve o detalhe por canal, sem repetir
  let j = 0;
  const canal = await enviarAlerta({ url: 'u', token: 't', alerta: {}, esperar: semEspera, fetchFn: async () => { j++; return resp(502, { ok: false, canais: { whatsapp: [{ destino: '+55 •••• 8888', ok: false, erro: 'Template name does not exist' }] } }); } });
  assert.equal(j, 1); assert.equal(canal.ok, false);
  assert.match(resumoEnvio(canal), /WhatsApp \+55 •••• 8888 ✗ \(Template name does not exist\)/);
});

test('resumo por canal', () => {
  assert.equal(resumoEnvio({ ok: true, canais: { whatsapp: [{ destino: '+55 •••• 8888', ok: true }], email: { ok: true, provedor: 'resend', destinos: ['ch•••@e.com'] } } }),
    'WhatsApp +55 •••• 8888 ✓ · e-mail (resend) ✓ ch•••@e.com');
  assert.equal(resumoEnvio(null), 'não enviado');
  assert.equal(resumoEnvio({ ok: false, erro: 'sem conexão com o relé', canais: {} }), 'sem conexão com o relé');
});

test('fila: sem rede o alerta espera; ao voltar a conexão ("online") ele sai', async () => {
  const alvo = new EventTarget();
  let rede = false; const entregues = [];
  const fila = criarFila({ alvo, enviar: async item => (rede ? { ok: true } : { ok: false, rede: true }), aoResultado: (item, r) => entregues.push({ item, r }) });
  await fila.adicionar({ id: 1 });
  assert.equal(fila.tamanho, 1); assert.equal(entregues.length, 0);
  rede = true;
  alvo.dispatchEvent(new Event('online'));
  await new Promise(r => setTimeout(r, 10));
  assert.equal(fila.tamanho, 0); assert.equal(entregues[0].item.id, 1);
});

test('CSP: relé de outra origem só se a publicação liberou a origem', () => {
  assert.equal(releLiberado('https://rele.conta.workers.dev/alerta', ['https://rele.conta.workers.dev']), true);
  assert.equal(releLiberado('https://outro.workers.dev/alerta', ['https://rele.conta.workers.dev']), false);
  assert.equal(releLiberado('http://rele.conta.workers.dev/alerta', ['http://rele.conta.workers.dev']), false, 'só HTTPS');
  assert.equal(releLiberado('não é url'), false);
});
