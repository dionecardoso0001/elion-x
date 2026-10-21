/**
 * BOT DE EXEMPLO — implementação de referência do contrato dos bots Grok.
 *
 * Use como molde para adaptar seus bots. Ele:
 *   1. recebe o pedido pago e VERIFICA a assinatura HMAC;
 *   2. responde 202 na hora (a produção é demorada — nunca segure o HTTP);
 *   3. envia progresso e, por fim, a entrega, assinando cada callback.
 *
 * A função produzir() é o ponto onde entra o seu bot Grok de verdade.
 * Aqui ela só simula etapas e devolve arquivos de exemplo.
 *
 * Execução: BOT_SHARED_SECRET=... node scripts/bot-exemplo.mjs
 */
import { createServer } from 'node:http';
import { signBody, verifyBody } from '../lib/crypto.mjs';
import { loadEnv } from '../server.mjs';

loadEnv();
const PORT = Number(process.env.BOT_PORT || 4444);
const SECRET = process.env.BOT_SHARED_SECRET;
if (!SECRET) { console.error('defina BOT_SHARED_SECRET'); process.exit(1); }

const SAMPLE_VIDEO = process.env.SAMPLE_VIDEO_URL || 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const SAMPLE_IMAGE = process.env.SAMPLE_IMAGE_URL || 'https://interactive-examples.mdn.mozilla.net/media/cc0-images/grapefruit-slice-332-332.jpg';

async function callback(url, payload) {
  const body = JSON.stringify(payload);
  const { timestamp, signature } = signBody(SECRET, body);
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Studio-Timestamp': timestamp, 'X-Studio-Signature': signature },
    body,
  });
  console.log(`callback ${payload.status} ${payload.progress ?? ''} → HTTP ${r.status}`);
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/** Substitua pelo seu pipeline Grok (roteiro → geração → edição → upload). */
async function produzir({ order, callbackUrl, revisionNote }) {
  const base = { orderId: order.id };
  await callback(callbackUrl, { ...base, status: 'in_production', progress: 25, message: revisionNote ? 'Aplicando o ajuste pedido' : 'Roteiro aprovado pela IA' });
  await wait(1500);
  await callback(callbackUrl, { ...base, status: 'in_production', progress: 60, message: 'Gerando cenas' });
  await wait(1500);
  await callback(callbackUrl, { ...base, status: 'in_production', progress: 90, message: 'Finalizando trilha e legendas' });
  await wait(1000);

  const assets = [
    ...Array.from({ length: order.deliverables.videos }, (_, i) => ({ type: 'video', url: SAMPLE_VIDEO, label: `Vídeo ${i + 1} · ${order.briefing.format}` })),
    ...Array.from({ length: order.deliverables.images }, (_, i) => ({ type: 'image', url: SAMPLE_IMAGE, label: `Foto ${i + 1}` })),
  ];
  await callback(callbackUrl, { ...base, status: 'delivered', assets, message: 'Material pronto!' });
}

createServer((req, res) => {
  if (req.method !== 'POST') { res.writeHead(405).end(); return; }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!verifyBody(SECRET, raw, req.headers['x-studio-timestamp'], req.headers['x-studio-signature'])) {
      res.writeHead(401).end('assinatura inválida');
      return;
    }
    res.writeHead(202).end('ok');
    const job = JSON.parse(raw);
    console.log(`recebido ${job.event} ${job.order.id} (${job.order.package.name})`);
    produzir(job).catch(e => console.error('falha na produção', e));
  });
}).listen(PORT, () => console.log(`bot de exemplo ouvindo em http://localhost:${PORT}`));
