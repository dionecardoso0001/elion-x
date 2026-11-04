import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lerConfiguracao, validarAlerta, parametrosWhatsApp, textoAlerta, htmlAlerta, mensagemMime, despachar, criarRele,
  mascararTelefone, mascararEmail,
} from '../notificacao.mjs';

const TOKEN = 'tok-carro1-0123456789abcdef';
const BASE = {
  RELE_TOKENS: `carro1:${TOKEN}`, RELE_ORIGENS: 'https://dionecardoso0001.github.io',
  WHATSAPP_TOKEN: 'EAAG-segredo', WHATSAPP_PHONE_ID: '1234567890', WHATSAPP_TEMPLATE: 'alerta_saude_motorista',
  WHATSAPP_DESTINOS: '+55 11 99999-8888', EMAIL_DESTINOS: 'chefe@empresa.com', EMAIL_REMETENTE: 'Sentinela <alertas@empresa.com>',
  RESEND_API_KEY: 're_segredo',
};
const ALERTA = { tipo: 'alerta_saude', gravidade: 'critica', motorista: 'João', veiculo: 'ABC1D23',
  situacao: 'mão no peito e o motorista NÃO RESPONDEU à checagem por voz', quando: '04/11/2026, 15:30:00',
  local: { lat: -23.5505, lng: -46.6333, precisaoM: 12, mapa: 'https://malicioso.example/phish' }, velocidadeKmh: 61 };

/** fetch simulado: registra as chamadas e responde por URL. */
function fetchFalso(respostas = {}) {
  const chamadas = [];
  const f = async (url, init = {}) => {
    chamadas.push({ url, init });
    const r = Object.entries(respostas).find(([k]) => url.includes(k))?.[1] ?? { status: 200, corpo: {} };
    if (r.erro) throw r.erro;
    return new Response(JSON.stringify(r.corpo ?? {}), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  };
  f.chamadas = chamadas;
  return f;
}
const pedido = (corpo, { token = TOKEN, origem = 'https://dionecardoso0001.github.io', metodo = 'POST', caminho = '/alerta' } = {}) =>
  new Request(`https://rele.exemplo.workers.dev${caminho}`, {
    method: metodo, body: metodo === 'POST' ? (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) : undefined,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origem ? { Origin: origem } : {}), 'Content-Type': 'application/json' },
  });

test('configuração: canal só liga completo; token curto é descartado; destinos normalizados', () => {
  const c = lerConfiguracao({ ...BASE, RELE_TOKENS: `carro1:${TOKEN},curto:abc` });
  assert.deepEqual(c.tokens.map(t => t.nome), ['carro1'], 'token com menos de 16 caracteres não vale');
  assert.deepEqual(c.whatsapp.destinos, ['5511999998888']);
  assert.equal(c.email.provedor, 'resend');
  assert.equal(lerConfiguracao({ ...BASE, WHATSAPP_TEMPLATE: '' }).whatsapp, null);
  const gm = lerConfiguracao({ ...BASE, RESEND_API_KEY: '', GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 's', GMAIL_REFRESH_TOKEN: 'r' });
  assert.equal(gm.email.provedor, 'gmail');
  assert.equal(lerConfiguracao({ WEBHOOK_URL: 'http://inseguro' }).webhook, null, 'webhook só em HTTPS');
});

test('validação: link do mapa é refeito no relé (o do cliente é ignorado), controle e excesso cortados', () => {
  const a = validarAlerta({ ...ALERTA, motorista: 'João\n\u0007<script>', extra: 'ignorado', aviso: 'texto do cliente' });
  assert.equal(a.local.mapa, 'https://maps.google.com/?q=-23.550500,-46.633300');
  assert.equal(a.motorista, 'João <script>');
  assert.equal('extra' in a, false);
  assert.match(a.aviso, /não é diagnóstico/, 'o aviso é fixo do relé');
  assert.equal(validarAlerta({ ...ALERTA, situacao: 'x'.repeat(5000) }).situacao.length, 400);
  assert.equal(validarAlerta({ ...ALERTA, local: { lat: 200, lng: 0 } }).local, null);
  assert.equal(validarAlerta({ ...ALERTA, velocidadeKmh: null }).velocidadeKmh, null);
  assert.throws(() => validarAlerta({ tipo: 'spam' }), /tipo/);
  assert.throws(() => validarAlerta([1]), /corpo/);
});

test('WhatsApp: modelo aprovado com 5 variáveis, sem quebra de linha (a Meta recusa), token só no cabeçalho', async () => {
  const f = fetchFalso({ 'graph.facebook.com': { corpo: { messages: [{ id: 'wamid.X' }] } }, 'api.resend.com': { corpo: { id: 'em_1' } } });
  const r = await despachar(lerConfiguracao(BASE), validarAlerta(ALERTA), f);
  assert.equal(r.ok, true);
  const w = f.chamadas.find(c => c.url.includes('graph.facebook.com'));
  assert.equal(w.url, 'https://graph.facebook.com/v24.0/1234567890/messages');
  assert.equal(w.init.headers.Authorization, 'Bearer EAAG-segredo');
  const corpo = JSON.parse(w.init.body);
  assert.equal(corpo.messaging_product, 'whatsapp'); assert.equal(corpo.to, '5511999998888'); assert.equal(corpo.type, 'template');
  assert.equal(corpo.template.name, 'alerta_saude_motorista'); assert.equal(corpo.template.language.code, 'pt_BR');
  const params = corpo.template.components[0].parameters;
  assert.equal(params.length, 5);
  assert.ok(params.every(p => p.type === 'text' && !/[\n\t]| {5,}/.test(p.text)));
  assert.equal(params[3].text, 'https://maps.google.com/?q=-23.550500,-46.633300');
  assert.deepEqual(r.canais.whatsapp, [{ destino: '+55 •••• 8888', ok: true, id: 'wamid.X' }], 'número mascarado na resposta');
  assert.match(parametrosWhatsApp(validarAlerta({ ...ALERTA, tipo: 'teste' }))[2], /^TESTE — /);
});

test('e-mail Resend: remetente, destinos, assunto, texto e HTML escapado', async () => {
  const f = fetchFalso({ 'api.resend.com': { corpo: { id: 'em_1' } } });
  const r = await despachar(lerConfiguracao({ ...BASE, WHATSAPP_TOKEN: '' }), validarAlerta({ ...ALERTA, motorista: 'Zé <b>' }), f);
  assert.equal(r.canais.email.ok, true);
  const c = JSON.parse(f.chamadas[0].init.body);
  assert.equal(c.from, 'Sentinela <alertas@empresa.com>'); assert.deepEqual(c.to, ['chefe@empresa.com']);
  assert.match(c.subject, /ALERTA DE SAÚDE.*Zé <b> \(ABC1D23\)/);
  assert.match(c.text, /Local: https:\/\/maps\.google\.com/);
  assert.ok(c.html.includes('Zé &lt;b&gt;') && !c.html.includes('Zé <b>'), 'HTML escapado');
  assert.deepEqual(r.canais.email.destinos, ['ch•••@empresa.com']);
});

test('e-mail Gmail API: troca o refresh token e envia MIME UTF-8 em base64url; refresh expirado vira instrução', async () => {
  const env = { ...BASE, WHATSAPP_TOKEN: '', RESEND_API_KEY: '', GMAIL_CLIENT_ID: 'cid', GMAIL_CLIENT_SECRET: 'cs', GMAIL_REFRESH_TOKEN: 'rt' };
  const f = fetchFalso({ 'oauth2.googleapis.com': { corpo: { access_token: 'ya29.x' } }, 'gmail.googleapis.com': { corpo: { id: 'g1' } } });
  const r = await despachar(lerConfiguracao(env), validarAlerta(ALERTA), f);
  assert.equal(r.ok, true);
  assert.match(f.chamadas[0].init.body, /grant_type=refresh_token/);
  const envio = f.chamadas[1];
  assert.equal(envio.url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  assert.equal(envio.init.headers.Authorization, 'Bearer ya29.x');
  const raw = JSON.parse(envio.init.body).raw;
  assert.ok(!/[+/=]/.test(raw), 'base64url sem + / =');
  const mime = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert.match(mime, /^From: Sentinela <alertas@empresa\.com>\r\nTo: chefe@empresa\.com\r\nSubject: =\?UTF-8\?B\?/);
  const corpoTexto = mime.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, '');
  assert.match(Buffer.from(corpoTexto, 'base64').toString('utf8'), /Motorista: João/);
  const g = fetchFalso({ 'oauth2.googleapis.com': { status: 400, corpo: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } } });
  const r2 = await despachar(lerConfiguracao(env), validarAlerta(ALERTA), g);
  assert.equal(r2.ok, false);
  assert.match(r2.canais.email.erro, /expired or revoked.*GMAIL_REFRESH_TOKEN de novo/);
  assert.ok(mensagemMime(lerConfiguracao(env).email, validarAlerta(ALERTA)).includes('multipart/alternative'));
});

test('webhook assinado com HMAC-SHA256; falha de um canal não derruba o outro', async () => {
  const env = { ...BASE, RESEND_API_KEY: '', WEBHOOK_URL: 'https://n8n.exemplo/webhook', WEBHOOK_SEGREDO: 'k' };
  const f = fetchFalso({ 'graph.facebook.com': { status: 400, corpo: { error: { message: 'Template name does not exist', code: 132001 } } }, 'n8n.exemplo': { corpo: {} } });
  const r = await despachar(lerConfiguracao(env), validarAlerta(ALERTA), f);
  assert.equal(r.ok, true, 'o webhook entregou');
  assert.equal(r.canais.whatsapp[0].ok, false);
  assert.match(r.canais.whatsapp[0].erro, /Template name does not exist \(código 132001\)/);
  const h = f.chamadas.find(c => c.url.includes('n8n')).init.headers['X-Sentinela-Assinatura'];
  const { createHmac } = await import('node:crypto');
  const esperado = 'sha256=' + createHmac('sha256', 'k').update(f.chamadas.find(c => c.url.includes('n8n')).init.body).digest('hex');
  assert.equal(h, esperado);
  const nenhum = await despachar(lerConfiguracao({ RELE_TOKENS: BASE.RELE_TOKENS }), validarAlerta(ALERTA), f);
  assert.equal(nenhum.ok, false); assert.match(nenhum.erro, /nenhum canal/);
});

test('relé HTTP: sem token 401, token errado 401, sem RELE_TOKENS 503, origem estranha 403, preflight CORS 204', async () => {
  const f = fetchFalso();
  const rele = criarRele({ env: BASE, fetchFn: f });
  assert.equal((await rele.tratar(pedido(ALERTA, { token: '' }))).status, 401);
  assert.equal((await rele.tratar(pedido(ALERTA, { token: 'tok-errado-0123456789abcdef' }))).status, 401);
  assert.equal((await criarRele({ env: { ...BASE, RELE_TOKENS: '' } }).tratar(pedido(ALERTA))).status, 503);
  assert.equal((await rele.tratar(pedido(ALERTA, { origem: 'https://atacante.example' }))).status, 403);
  const pre = await rele.tratar(new Request('https://r/alerta', { method: 'OPTIONS', headers: { Origin: 'https://dionecardoso0001.github.io' } }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://dionecardoso0001.github.io');
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
  assert.equal(f.chamadas.length, 0, 'nada foi enviado');
});

test('relé HTTP: alerta válido → 200 com canais mascarados; JSON ruim 400; grande 413; limite por aparelho 429', async () => {
  const f = fetchFalso({ 'graph.facebook.com': { corpo: { messages: [{ id: 'w1' }] } }, 'api.resend.com': { corpo: { id: 'e1' } } });
  let t = 0;
  const rele = criarRele({ env: { ...BASE, RELE_LIMITE_10MIN: '2' }, fetchFn: f, agora: () => t });
  const r = await rele.tratar(pedido(ALERTA));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.aparelho, 'carro1');
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://dionecardoso0001.github.io');
  assert.ok(!JSON.stringify(j).includes('99999-8888') && !JSON.stringify(j).includes('chefe@'), 'sem contato em claro');
  assert.equal((await rele.tratar(pedido('{ruim'))).status, 400);
  assert.equal((await rele.tratar(pedido(JSON.stringify({ ...ALERTA, situacao: 'x'.repeat(9000) })))).status, 413);
  assert.equal((await rele.tratar(pedido(ALERTA))).status, 200);
  assert.equal((await rele.tratar(pedido(ALERTA))).status, 429, '3º alerta em 10 min com limite 2');
  t = 600001;
  assert.equal((await rele.tratar(pedido(ALERTA))).status, 200, 'janela de 10 min passou');
  const est = await (await rele.tratar(pedido(null, { metodo: 'GET', caminho: '/estado' }))).json();
  assert.deepEqual(est.canais.whatsapp.destinos, ['+55 •••• 8888']);
  assert.equal(est.canais.email.provedor, 'resend');
});

test('máscaras e textos: telefone, e-mail, texto puro com mapa e aviso de triagem', () => {
  assert.equal(mascararTelefone('5511999998888'), '+55 •••• 8888');
  assert.equal(mascararEmail('chefe@empresa.com'), 'ch•••@empresa.com');
  const a = validarAlerta(ALERTA);
  assert.match(textoAlerta(a), /Velocidade: 61 km\/h[\s\S]*SAMU 192/);
  assert.match(htmlAlerta(a), /href="https:\/\/maps\.google\.com\/\?q=-23\.550500,-46\.633300"/);
});
