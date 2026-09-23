/* ═══════════════════════════════════════════════════════════════════════════
   DESVIO — o ELION continua de pé quando a Anthropic cai.

   A plataforma inteira do modo texto/microfone pendurava numa única API. No dia
   em que a Anthropic devolveu "you have reached your specified API usage
   limits", o operador perdeu o agente: digitar não respondia, o microfone
   transcrevia e morria na hora de pensar. Só o modo AO VIVO sobreviveu, porque
   ele fala com a OpenAI.

   Aqui mora a tradução entre os dois mundos. O laço agêntico continua pensando
   em blocos da Anthropic (`tool_use`, `tool_result`); este módulo converte na
   ida e na volta, de forma que NADA acima precise saber qual provedor
   respondeu.

   O QUE ISTO NÃO É: não é um provedor melhor nem um substituto permanente. É a
   rede de segurança. Quando ela entra em ação, o operador é avisado — um desvio
   silencioso faria ele achar que a conta da Anthropic está boa quando não está.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ────────────────── 1. FERRAMENTAS: Anthropic → OpenAI ────────────────── */

/**
 * A forma é parecida o bastante para enganar: `input_schema` vira `parameters`,
 * e tudo se embrulha em `{type:'function'}`. Errar aqui não dá erro — dá um
 * agente que simplesmente nunca chama ferramenta nenhuma.
 */
export function ferramentasParaOpenAI(tools) {
  return (tools || []).map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: String(t.description || '').slice(0, 4000),
      parameters: t.input_schema || { type: 'object', properties: {} },
    },
  }));
}

/* ────────────────── 2. MENSAGENS: Anthropic → OpenAI ────────────────── */

const textoDoBloco = b => {
  if (typeof b === 'string') return b;
  if (b?.type === 'text') return b.text || '';
  return '';
};

/** Conteúdo de um tool_result achatado para texto: a OpenAI só aceita string. */
function resultadoParaTexto(conteudo) {
  if (typeof conteudo === 'string') return conteudo;
  if (!Array.isArray(conteudo)) return JSON.stringify(conteudo ?? '');
  const partes = [];
  let imagens = 0;
  for (const b of conteudo) {
    if (typeof b === 'string') { partes.push(b); continue; }
    if (b?.type === 'text') { partes.push(b.text || ''); continue; }
    if (b?.type === 'image') { imagens++; continue; }
    partes.push(JSON.stringify(b));
  }
  /* Declarar a imagem descartada em vez de sumir com ela: sem esta linha o
     modelo receberia um resultado mutilado sem saber, e responderia com
     confiança sobre algo que não viu. */
  if (imagens) partes.push(`[${imagens} imagem(ns) neste resultado não puderam ser repassadas no modo de contingência]`);
  return partes.join('\n').trim() || '(sem conteúdo)';
}

/**
 * A diferença estrutural que quebra tudo se ignorada: a Anthropic junta TODOS
 * os resultados de ferramenta numa única mensagem de usuário; a OpenAI exige
 * UMA mensagem `tool` por chamada, na ordem, cada uma amarrada pelo id. Passar
 * o bloco da Anthropic direto devolve 400 e o desvio morre no primeiro uso de
 * ferramenta — justo quando mais importa.
 */
export function mensagensParaOpenAI(msgs, system) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });

  for (const m of msgs || []) {
    const c = m.content;

    if (typeof c === 'string') { out.push({ role: m.role, content: c }); continue; }
    if (!Array.isArray(c)) { out.push({ role: m.role, content: String(c ?? '') }); continue; }

    if (m.role === 'assistant') {
      const texto = c.map(textoDoBloco).join('').trim();
      const chamadas = c.filter(b => b?.type === 'tool_use').map(b => ({
        id: b.id,
        type: 'function',
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
      const msg = { role: 'assistant', content: texto || null };
      if (chamadas.length) msg.tool_calls = chamadas;
      // assistente sem texto e sem chamada não existe para a OpenAI
      if (msg.content || msg.tool_calls) out.push(msg);
      continue;
    }

    // usuário: separa resultados de ferramenta do conteúdo comum
    const resultados = c.filter(b => b?.type === 'tool_result');
    const resto = c.filter(b => b?.type !== 'tool_result');

    for (const r of resultados) {
      out.push({
        role: 'tool',
        tool_call_id: r.tool_use_id,
        content: (r.is_error ? 'ERRO: ' : '') + resultadoParaTexto(r.content),
      });
    }

    if (resto.length) {
      const partes = [];
      for (const b of resto) {
        if (b?.type === 'text' || typeof b === 'string') partes.push({ type: 'text', text: textoDoBloco(b) });
        else if (b?.type === 'image' && b.source?.type === 'base64') {
          partes.push({ type: 'image_url', image_url: { url: `data:${b.source.media_type || 'image/jpeg'};base64,${b.source.data}` } });
        }
      }
      if (partes.length) {
        out.push({ role: 'user', content: partes.every(p => p.type === 'text') ? partes.map(p => p.text).join('\n') : partes });
      }
    }
  }
  return out;
}

/* ────────────────── 3. STREAM, DEVOLVENDO BLOCOS DA ANTHROPIC ────────────────── */

/**
 * Mesma assinatura e mesmo retorno de claudeStream — `{ blocks, stopReason }`
 * em formato Anthropic. É isso que permite ao laço agêntico não saber de nada.
 */
export async function openaiStream(payload, onText, signal, { chave, modelo = 'gpt-5.1' } = {}) {
  if (!chave) throw new Error('OPENAI_API_KEY ausente — sem contingência configurada.');

  const corpo = {
    model: modelo,
    messages: mensagensParaOpenAI(payload.messages, payload.system),
    // a família gpt-5 recusa max_tokens; o nome mudou para max_completion_tokens
    max_completion_tokens: payload.max_tokens || 3000,
    stream: true,
  };
  const tools = ferramentasParaOpenAI(payload.tools);
  if (tools.length) { corpo.tools = tools; corpo.tool_choice = 'auto'; }

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + chave },
    body: JSON.stringify(corpo),
    signal,
  });

  if (!r.ok) {
    const bruto = await r.text().catch(() => '');
    let msg = `OpenAI HTTP ${r.status}`;
    try { msg = JSON.parse(bruto).error?.message || msg; } catch {}
    throw new Error(msg);
  }

  const blocks = [];
  let texto = '';
  const chamadas = new Map();          // índice → { id, name, args }
  let finish = null;
  let buf = '';
  const dec = new TextDecoder();

  for await (const pedaco of r.body) {
    buf += dec.decode(pedaco, { stream: true });
    const linhas = buf.split('\n');
    buf = linhas.pop();
    for (const linha of linhas) {
      if (!linha.startsWith('data: ')) continue;
      const dado = linha.slice(6).trim();
      if (dado === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(dado); } catch { continue; }
      const esc = ev.choices?.[0];
      if (!esc) continue;

      const d = esc.delta || {};
      if (d.content) { texto += d.content; onText?.(d.content); }

      for (const tc of d.tool_calls || []) {
        const i = tc.index ?? 0;
        if (!chamadas.has(i)) chamadas.set(i, { id: tc.id || `call_${i}`, name: '', args: '' });
        const acc = chamadas.get(i);
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name += tc.function.name;
        // os argumentos chegam em fatias e SÓ são JSON válido no fim
        if (tc.function?.arguments) acc.args += tc.function.arguments;
      }
      if (esc.finish_reason) finish = esc.finish_reason;
    }
  }

  if (texto) blocks.push({ type: 'text', text: texto });
  for (const [, c] of [...chamadas.entries()].sort((a, b) => a[0] - b[0])) {
    let input = {};
    try { input = c.args ? JSON.parse(c.args) : {}; }
    catch { input = {}; console.warn('[desvio] argumentos inválidos de', c.name, '—', c.args.slice(0, 120)); }
    blocks.push({ type: 'tool_use', id: c.id, name: c.name, input });
  }

  return {
    blocks,
    stopReason: (finish === 'tool_calls' || chamadas.size) ? 'tool_use' : 'end_turn',
  };
}

/* ────────────────── 4. VISÃO (sem streaming) ────────────────── */

/**
 * Chamada única com imagem — usada pela análise de câmera e pela transcrição de
 * foto/print de documento. Devolve só o texto, que é tudo que esses caminhos
 * consomem.
 *
 * O PDF nativo NÃO passa por aqui: a Anthropic aceita um PDF inteiro como
 * documento, a OpenAI não. Fingir que aceita devolveria transcrição vazia com
 * cara de sucesso — o pior desfecho possível para um contrato digitalizado.
 * Quem chama precisa tratar essa lacuna explicitamente.
 */
export async function openaiVisao({ chave, modelo = 'gpt-5.1', system, texto, imagemB64, mediaType = 'image/jpeg', maxTokens = 4096, signal }) {
  if (!chave) throw new Error('OPENAI_API_KEY ausente — sem contingência para visão.');
  const conteudo = [];
  if (imagemB64) conteudo.push({ type: 'image_url', image_url: { url: `data:${mediaType};base64,${imagemB64}` } });
  if (texto) conteudo.push({ type: 'text', text: texto });

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + chave },
    body: JSON.stringify({
      model: modelo,
      messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: conteudo }],
      max_completion_tokens: maxTokens,
    }),
    signal,
  });
  if (!r.ok) {
    const bruto = await r.text().catch(() => '');
    let msg = `OpenAI HTTP ${r.status}`;
    try { msg = JSON.parse(bruto).error?.message || msg; } catch {}
    throw new Error(msg);
  }
  const j = await r.json();
  return j.choices?.[0]?.message?.content || '';
}

/* ────────────────── 5. TEXTO SIMPLES (sem ferramenta, sem streaming) ────────────────── */

/**
 * O ajudante genérico. Parece o menos importante e é o que sustenta mais coisa:
 * o Conselho de Decisão inteiro passa por aqui — cinco conselheiros, o advogado
 * do diabo, três juízes e o síntese. Sem contingência aqui, aquele recurso
 * morre por completo quando a Anthropic sai do ar.
 */
export async function openaiTexto({ chave, modelo = 'gpt-5.1', system, user, max = 900, temperature, signal }) {
  if (!chave) throw new Error('OPENAI_API_KEY ausente — sem contingência configurada.');
  const corpo = {
    model: modelo,
    messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }],
    max_completion_tokens: max,
  };
  /* A família gpt-5 só aceita temperature = 1 e recusa a requisição inteira com
     qualquer outro valor. Omitir é mais seguro que mandar o número do Claude e
     derrubar a chamada por um detalhe de compatibilidade. */
  if (temperature != null && !/^gpt-5/.test(modelo)) corpo.temperature = temperature;

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + chave },
    body: JSON.stringify(corpo),
    signal,
  });
  if (!r.ok) {
    const bruto = await r.text().catch(() => '');
    let msg = `OpenAI HTTP ${r.status}`;
    try { msg = JSON.parse(bruto).error?.message || msg; } catch {}
    throw new Error(msg);
  }
  const j = await r.json();
  return (j.choices?.[0]?.message?.content || '').trim();
}

/* ────────────────── 6. QUANDO DESVIAR ────────────────── */

/**
 * Só erro do PROVEDOR aciona a contingência. Um erro de programação meu
 * (payload malformado, ferramenta quebrada) não deve empurrar a conversa para
 * o outro provedor — ali o mesmo defeito reapareceria mascarado, e eu perderia
 * o sintoma que aponta para a causa.
 */
export function devoDesviar(erro) {
  const m = String(erro?.message || erro || '').toLowerCase();
  return /usage limit|quota|insufficient|credit|billing|429|rate.?limit|overload|529|503|502|500|temporarily unavailable|capacity/.test(m);
}

/** Motivo em português, para o operador saber POR QUE está no plano B. */
export function motivoDoDesvio(erro) {
  const m = String(erro?.message || erro || '').toLowerCase();
  if (/usage limit|quota|insufficient|credit|billing/.test(m)) return 'o limite de uso da Anthropic foi atingido';
  if (/429|rate.?limit/.test(m)) return 'a Anthropic está limitando a taxa de chamadas';
  if (/overload|529|capacity/.test(m)) return 'a Anthropic está sobrecarregada';
  if (/50[023]|unavailable/.test(m)) return 'a Anthropic está fora do ar';
  return 'a Anthropic falhou';
}
