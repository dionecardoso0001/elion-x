/**
 * ELION-X · GERAÇÃO DE VÍDEO (SkyReels V4)
 *
 * Documentação: https://www.skyreels.ai/dev/document
 * Gateway: https://api-gateway.skyreels.ai
 *
 * DOIS DETALHES DA API QUE MOLDAM ESTE ARQUIVO:
 *
 * 1) É ASSÍNCRONA. O submit devolve um task_id; o vídeo só existe depois, e
 *    precisa ser buscado por sondagem. Um agente que tratasse o submit como
 *    resposta final diria "pronto, Senhor" com as mãos vazias — que é o modo
 *    de falhar que esta plataforma já conhece bem.
 *
 * 2) A CHAVE VAI NO CORPO, não em cabeçalho. É incomum e fácil de errar; e
 *    como vai no corpo, jamais pode aparecer em URL nem em log.
 */
const GATEWAY = 'https://api-gateway.skyreels.ai';
const t = ms => AbortSignal.timeout(ms);

const chave = () => {
  const k = (process.env.SKYREELS_API_KEY || '').trim();
  if (!k) throw new Error('SKYREELS_API_KEY ausente no .env — o operador precisa colar a chave dele lá (eu nunca vejo o valor)');
  return k;
};

const ASPECTOS = ['16:9', '4:3', '1:1', '9:16', '3:4'];
const RESOLUCOES = ['480p', '720p', '1080p'];

/** Valida e normaliza o pedido antes de gastar crédito do operador. */
function normalizar({ prompt, duracao, aspecto, resolucao, som, modo }) {
  const p = String(prompt || '').trim();
  if (!p) throw new Error('descreva o vídeo que quer gerar');

  const dur = Math.min(Math.max(parseInt(duracao, 10) || 5, 3), 15);
  const asp = ASPECTOS.includes(aspecto) ? aspecto : '16:9';
  const res = RESOLUCOES.includes(resolucao) ? resolucao : '1080p';
  /* "fast" com som é combinação inválida na API. Em vez de deixar o servidor
     recusar (gastando uma ida e volta e confundindo o agente), corrijo aqui e
     devolvo o aviso, para o ELION poder explicar a troca ao operador. */
  let md = modo === 'fast' ? 'fast' : 'std';
  let aviso = '';
  if (md === 'fast' && som) { md = 'std'; aviso = 'O modo rápido ainda não suporta áudio; usei o modo padrão para incluir som.'; }

  return { corpo: { prompt: p, duration: dur, aspect_ratio: asp, resolution: res,
                    sound: !!som, mode: md, prompt_optimizer: true }, aviso };
}

async function postar(caminho, corpo) {
  const r = await fetch(`${GATEWAY}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: chave(), ...corpo }),
    signal: t(45000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.code && j.code !== 200)) {
    /* A SkyReels devolve o motivo em `detail`, não em `msg` — e usa códigos
       fora do comum (480 para saldo). Sem traduzir, o agente repassaria
       "HTTP 480" ao operador, que não diz nada. Cada caso abaixo aponta a
       AÇÃO que resolve, porque erro sem saída é o mesmo que erro mudo. */
    const detalhe = j.detail || j.msg || '';
    if (r.status === 480 || /insufficient credit/i.test(detalhe))
      throw new Error('a conta SkyReels está SEM CRÉDITOS DE API. A carteira da API é separada da do editor web: ' +
        'ter saldo no site não dá saldo aqui. O operador precisa recarregar em skyreels.ai (área de API/billing). ' +
        'A chave dele está correta — foi aceita e autenticada.');
    if (r.status === 401 || /AK.*不存在|not exist/i.test(detalhe))
      throw new Error('a SkyReels não reconheceu a chave (SKYREELS_API_KEY). Confira se foi copiada inteira e sem espaços, ' +
        'ou gere outra em skyreels.ai/dev/api-keys — a chave só aparece uma vez, no momento da criação.');
    if (r.status === 429) throw new Error('limite de requisições da SkyReels atingido. Aguarde alguns minutos.');
    throw new Error(`SkyReels recusou (HTTP ${r.status}): ${detalhe || 'sem detalhe'}`);
  }
  if (!j.task_id) throw new Error(`SkyReels não devolveu task_id: ${JSON.stringify(j).slice(0, 200)}`);
  return j.task_id;
}

/** Texto → vídeo. Devolve o task_id; o vídeo vem depois, por sondagem. */
export async function gerarDeTexto(opts) {
  const { corpo, aviso } = normalizar(opts);
  const task_id = await postar('/api/v1/video/text2video/submit', corpo);
  return { task_id, aviso, pedido: corpo };
}

/** Imagem → vídeo. Aceita primeiro e/ou último quadro, por URL pública. */
export async function gerarDeImagem(opts) {
  const { corpo, aviso } = normalizar(opts);
  const primeiro = String(opts.imagem || opts.first_frame_image || '').trim();
  const ultimo = String(opts.imagemFinal || opts.end_frame_image || '').trim();
  if (!primeiro && !ultimo)
    throw new Error('informe ao menos uma imagem (URL pública) como primeiro ou último quadro');
  // a API exige URL: arquivo local não serve, e dizer isso agora evita
  // o agente prometer algo que vai falhar lá na frente
  for (const [rot, u] of [['primeiro quadro', primeiro], ['último quadro', ultimo]]) {
    if (!u) continue;
    if (!/^https?:\/\//i.test(u)) throw new Error(`o ${rot} precisa ser uma URL pública (http/https), não um arquivo local`);
  }
  if (primeiro) corpo.first_frame_image = primeiro;
  if (ultimo) corpo.end_frame_image = ultimo;
  const task_id = await postar('/api/v1/video/image2video/submit', corpo);
  return { task_id, aviso, pedido: corpo };
}

/** Consulta uma tarefa. tipo: 'texto' | 'imagem'. */
export async function consultar(task_id, tipo = 'texto') {
  const id = String(task_id || '').trim();
  if (!id) throw new Error('informe o task_id');
  const rota = tipo === 'imagem' ? 'image2video' : 'text2video';
  const r = await fetch(`${GATEWAY}/api/v1/video/${rota}/task/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' }, signal: t(30000),
  });
  const j = await r.json().catch(() => ({}));
  const st = String(j.status || '').toLowerCase();
  /* "success" traz o vídeo em data; os demais estados são intermediários.
     Devolvo 'pronto' explícito para o chamador não ter de adivinhar o
     vocabulário da API. */
  return {
    status: st || 'unknown',
    pronto: st === 'success' && !!j.data?.video_url,
    falhou: st === 'failed',
    url: j.data?.video_url || '',
    duracao: j.data?.duration,
    resolucao: j.data?.resolution,
    msg: j.msg || '',
  };
}

/** Sonda até ficar pronto. Usado quando o operador quer esperar o vídeo. */
export async function aguardar(task_id, tipo = 'texto', { tetoMs = 240000, intervaloMs = 6000 } = {}) {
  const limite = Date.now() + tetoMs;
  let ultimo = 'submitted';
  while (Date.now() < limite) {
    const s = await consultar(task_id, tipo);
    ultimo = s.status;
    if (s.pronto) return s;
    if (s.falhou) throw new Error(`geração falhou: ${s.msg || 'sem detalhe'}`);
    await new Promise(r => setTimeout(r, intervaloMs));
  }
  // tempo esgotado NÃO é falha: a tarefa segue viva no servidor deles
  return { status: ultimo, pronto: false, falhou: false, url: '',
           msg: `ainda processando após ${Math.round(tetoMs / 1000)}s — consulte de novo com o task_id ${task_id}` };
}

export const configurado = () => !!(process.env.SKYREELS_API_KEY || '').trim();
