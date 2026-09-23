/* ═══════════════════════════════════════════════════════════════════
   ELION-X — BIOMETRIA VOCAL (reconhecimento de locutor)
   Identifica QUEM está falando com o agente, para ele saber se é o
   operador ou alguém da família que entrou na conversa.

   Como funciona (tudo local, nada sai do computador):
     · F0 (frequência fundamental) por autocorrelação — o traço mais
       discriminativo: homem adulto ~85-155 Hz, mulher ~165-255 Hz,
       criança ~250-400 Hz (quanto menor a idade, mais agudo).
     · LTAS (espectro médio de longo prazo) em 20 bandas — a "cor" da
       voz: timbre, nasalidade, brilho. É o que separa duas pessoas de
       F0 parecido.
     · Formantes médios F1/F2/F3 — dependem do comprimento do trato
       vocal, que cresce com a idade. Separa adulto de criança mesmo
       quando o pitch se aproxima.
   O perfil de cada pessoa é o CENTROIDE de várias amostras; a
   identificação compara por distância de cosseno + coerência de F0.

   ⚠️ São dados biométricos da família do operador. Ficam apenas em
      data/voices.json, que está no .gitignore. Nunca são enviados
      para fora da máquina.
═══════════════════════════════════════════════════════════════════ */
(function () {
  const NB = 20;                 // bandas do espectro médio
  const MIN_F0 = 70, MAX_F0 = 520;
  /* Limiares calibrados por simulação (ver histórico): com correlação de
     Pearson + margem sobre o 2º colocado, 0.90/0.03 reconhece ~93% das falas
     da família e rejeita a maioria das vozes de fora. Subir mais o limiar
     rejeita melhor estranhos, mas passa a falhar com a própria família. */
  const SIM_OK = 0.90;           // similaridade mínima p/ AFIRMAR "é fulano"
  const SIM_DUVIDA = 0.82;       // entre este e SIM_OK → "possivelmente fulano"
  const MARGEM = 0.03;           // vantagem mínima sobre o 2º colocado
  const F0_GATE = 0.38;          // |oitavas| de diferença que já descarta o perfil

  let ctx = null, an = null, srcNode = null, stream = null;
  let timeBuf = null, freqBuf = null;
  let db = [];                   // perfis cadastrados
  let ultimaDesconhecida = null; // {v, at} — voz não reconhecida no último identify()

  /* ── perfis: servidor é a fonte da verdade ── */
  async function loadDB() {
    try {
      const r = await fetch('/api/voices').then(x => x.json());
      db = r.voices || [];
    } catch { db = []; }
    return db;
  }
  async function saveProfile(p) {
    try {
      await fetch('/api/voices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
      });
    } catch {}
    await loadDB();
  }

  /* ── captação do microfone (tap próprio, isolado dos alto-falantes) ── */
  async function ensureMic() {
    if (an && stream && stream.active) return true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
      ctx = ELX.voice?.ensureCtx ? ELX.voice.ensureCtx() : new (window.AudioContext || window.webkitAudioContext)();
      an = ctx.createAnalyser();
      an.fftSize = 4096;                 // ~12 Hz/bin: resolve F0 e formantes
      an.smoothingTimeConstant = 0.0;    // sem suavização: cada janela é independente
      timeBuf = new Float32Array(an.fftSize);
      freqBuf = new Uint8Array(an.frequencyBinCount);
      srcNode = ctx.createMediaStreamSource(stream);
      srcNode.connect(an);               // NÃO conecta ao destino (não ecoa)
      return true;
    } catch (e) {
      ELX.toast?.('Sem acesso ao microfone para reconhecer a voz: ' + e.message, 'red');
      return false;
    }
  }
  function releaseMic() {
    try { srcNode?.disconnect(); } catch {}
    stream?.getTracks().forEach(t => t.stop());
    stream = null; srcNode = null; an = null;
  }

  /* ── F0 por autocorrelação normalizada ──
     Busca em DOIS ESTÁGIOS (grosseira e depois refino). A varredura ingênua
     custava >1 milhão de operações por janela e engasgava o loop de captura,
     fazendo perder a maior parte da fala. Aqui varremos os lags de 4 em 4 e
     só refinamos em volta do melhor — mesmo resultado, ~15x mais rápido. */
  function pitch(buf, sr) {
    const N = Math.min(buf.length, 2048);              // 2048 amostras bastam p/ F0
    let rms = 0;
    for (let i = 0; i < N; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / N);
    if (rms < 0.0045) return { f0: 0, rms };           // silêncio (limiar baixo: voz de criança/longe)

    const lagMin = Math.floor(sr / MAX_F0), lagMax = Math.min(Math.floor(sr / MIN_F0), N - 64);
    const corr = lag => {
      let num = 0, d1 = 0, d2 = 0;
      for (let i = 0; i < N - lag; i += 4) {           // passo 4 no sinal
        const a = buf[i], b = buf[i + lag];
        num += a * b; d1 += a * a; d2 += b * b;
      }
      return num / (Math.sqrt(d1 * d2) + 1e-9);
    };

    /* ERRO DE OITAVA — a armadilha desta técnica: a autocorrelação também
       tem picos nos SUBMÚLTIPLOS do período (metade, um terço da frequência).
       Pegar o máximo global fazia 300 Hz virar 150 e 330 virar 110 — ou seja,
       a voz aguda de uma criança era lida como voz de homem adulto.
       Correção (método de McLeod): calcula a curva inteira e escolhe o PRIMEIRO
       pico que chegue perto do máximo. O fundamental verdadeiro sempre aparece
       antes dos seus submúltiplos. */
    const passo = 2;
    const lags = [], vals = [];
    let maxR = -1;
    for (let lag = lagMin; lag <= lagMax; lag += passo) {
      const r = corr(lag);
      lags.push(lag); vals.push(r);
      if (r > maxR) maxR = r;
    }
    if (maxR < 0.30) return { f0: 0, rms };            // sem periodicidade = não é voz

    const limiar = maxR * 0.86;                        // "perto do máximo"
    let bestLag = 0, best = -1;
    for (let i = 1; i < vals.length - 1; i++) {
      if (vals[i] >= limiar && vals[i] >= vals[i - 1] && vals[i] >= vals[i + 1]) {
        bestLag = lags[i]; best = vals[i]; break;      // primeiro pico local qualificado
      }
    }
    if (!bestLag) {                                    // sem pico local claro: usa o máximo
      const i = vals.indexOf(maxR); bestLag = lags[i]; best = maxR;
    }
    // refino fino em volta do lag escolhido
    for (let lag = Math.max(lagMin, bestLag - passo); lag <= Math.min(lagMax, bestLag + passo); lag++) {
      const r = corr(lag);
      if (r > best) { best = r; bestLag = lag; }
    }
    if (!bestLag) return { f0: 0, rms };
    return { f0: sr / bestLag, rms, clareza: best };
  }

  /* ── espectro médio em NB bandas (escala tipo mel: mais detalhe no grave) ── */
  const BANDAS = (() => {
    const b = [];
    for (let i = 0; i < NB; i++) {
      // 120 Hz → 7 kHz distribuído logaritmicamente
      b.push([120 * Math.pow(7000 / 120, i / NB), 120 * Math.pow(7000 / 120, (i + 1) / NB)]);
    }
    return b;
  })();

  function espectro(sr) {
    an.getByteFrequencyData(freqBuf);
    const binHz = sr / an.fftSize;
    const out = new Array(NB);
    for (let i = 0; i < NB; i++) {
      const [lo, hi] = BANDAS[i];
      const a = Math.max(1, Math.round(lo / binHz)), b = Math.min(freqBuf.length - 1, Math.round(hi / binHz));
      let s = 0, n = 0;
      for (let j = a; j <= b; j++) { s += freqBuf[j]; n++; }
      out[i] = n ? s / (n * 255) : 0;
    }
    return out;
  }

  /* ── formantes médios (picos do envelope) — refletem o tamanho do trato vocal ── */
  function formantes(sr) {
    const binHz = sr / an.fftSize;
    const sm = i => (freqBuf[i - 1] + freqBuf[i] + freqBuf[i + 1]) / 3;
    const pico = (lo, hi) => {
      const a = Math.max(1, Math.round(lo / binHz)), b = Math.min(freqBuf.length - 2, Math.round(hi / binHz));
      let bi = a, bv = -1;
      for (let i = a; i <= b; i++) { const v = sm(i); if (v > bv) { bv = v; bi = i; } }
      return bv > 12 ? bi * binHz : 0;
    };
    const f1 = pico(250, 1100);
    const f2 = pico(Math.max(f1 + 250, 800), 3000);
    const f3 = pico(Math.max(f2 + 300, 2200), 4200);
    return [f1, f2, f3];
  }

  /* ═════════ IMPRESSÃO VOCAL ═════════
     Só conta janelas COM voz. Antes de gravar: espera o agente parar de falar
     (senão gravaria a voz DELE) e depois espera a pessoa começar. A contagem é
     de fala EFETIVA, não de relógio — se a pessoa fizer pausas, continua
     somando até juntar material suficiente. */
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function capture(opts = {}) {
    const {
      falaMs = 3000,          // quanto de fala EFETIVA queremos juntar
      esperaVozMs = 25000,    // até quanto tempo aguardamos a pessoa começar
      minAmostras = 8,
      aviso = null,           // callback de progresso
    } = typeof opts === 'number' ? { falaMs: opts } : opts;

    if (!(await ensureMic())) return { erro: 'mic', msg: 'não consegui acessar o microfone' };
    const sr = ctx.sampleRate;

    // 1) não gravar por cima da própria fala do agente
    const tFala = performance.now();
    while (ELX.voice?.speaking && performance.now() - tFala < 15000) await sleep(120);
    await sleep(250);                                   // respiro após o TTS

    /* 2) SILENCIAR A ESCUTA INTEIRA enquanto grava.
       Parar só o STT não bastava: o detector de barge-in (VAD) continuava
       ouvindo, escutava a PESSOA SENDO CADASTRADA e disparava interrupção —
       o cadastro morria em ~5s com "transmissão interrompida pelo operador".
       O mesmo vale no modo AO VIVO, onde o áudio seguia sendo enviado.
       suspendListening() derruba STT + VAD + envio do microfone da conversa.
       É seguro: a captura usa stream PRÓPRIA (ensureMic), não a da conversa. */
    const suspendeu = !!ELX.voice?.suspendListening;
    if (suspendeu) { try { ELX.voice.suspendListening(); } catch {} }
    else { try { ELX.voice?.stopSTT?.(); } catch {} }      // reserva p/ versão antiga
    const sttEstava = !suspendeu && !!ELX.voice?.conv;

    const f0s = [], specs = [], f1s = [], f2s = [], f3s = [];
    let comecou = false, msComVoz = 0, ultimo = performance.now();
    const tInicio = performance.now();
    let picoRms = 0;

    try {
      while (true) {
        await sleep(45);
        const agora = performance.now();
        const dt = agora - ultimo; ultimo = agora;

        an.getFloatTimeDomainData(timeBuf);
        const p = pitch(timeBuf, sr);
        if (p.rms > picoRms) picoRms = p.rms;

        if (p.f0) {
          if (!comecou) { comecou = true; aviso?.('ouvindo'); }
          msComVoz += dt;
          f0s.push(p.f0);
          specs.push(espectro(sr));
          const [a, b, c] = formantes(sr);
          if (a) f1s.push(a); if (b) f2s.push(b); if (c) f3s.push(c);
        }

        // juntou material suficiente
        if (msComVoz >= falaMs && f0s.length >= minAmostras) break;
        // ninguém começou a falar dentro da janela de espera
        if (!comecou && agora - tInicio > esperaVozMs) {
          return { erro: 'sem-voz', picoRms,
            msg: picoRms < 0.004
              ? 'não chegou som nenhum ao microfone (confira se ele está ligado e é o dispositivo certo)'
              : 'chegou som, mas não reconheci como voz — peça para falar mais perto e mais alto' };
        }
        // teto absoluto: 45s desde o início, para nunca travar
        if (agora - tInicio > 45000) break;
      }
    } finally {
      // devolve a escuta exatamente como estava (conversa ou AO VIVO)
      if (suspendeu) { try { ELX.voice.resumeListening(); } catch {} }
      else if (sttEstava) { try { ELX.voice?.startSTT?.(); } catch {} }
    }

    if (f0s.length < minAmostras) {
      return { erro: 'curto', amostras: f0s.length,
        msg: `só consegui ${f0s.length} trecho(s) de voz — peça para falar continuamente, sem pausas longas` };
    }

    const med = arr => { const s = [...arr].sort((x, y) => x - y); return s[s.length >> 1]; };
    const f0 = med(f0s);
    const desvio = Math.sqrt(f0s.reduce((s, v) => s + (v - f0) ** 2, 0) / f0s.length);
    // espectro médio, normalizado (tira o efeito do volume)
    const ltas = new Array(NB).fill(0);
    for (const s of specs) for (let i = 0; i < NB; i++) ltas[i] += s[i] / specs.length;
    const soma = ltas.reduce((s, v) => s + v, 0) || 1;
    for (let i = 0; i < NB; i++) ltas[i] /= soma;

    return {
      f0, f0dev: desvio,
      f1: f1s.length ? med(f1s) : 0, f2: f2s.length ? med(f2s) : 0, f3: f3s.length ? med(f3s) : 0,
      ltas, amostras: f0s.length,
    };
  }

  /* ── comparação ──
     Usa correlação de PEARSON, não cosseno simples: todo espectro de voz tem a
     mesma forma geral (energia caindo com a frequência), então o cosseno dá
     score alto até para pessoas diferentes. Pearson compara os vetores
     CENTRADOS — ou seja, o desvio de cada um em relação à própria média —,
     realçando a assinatura individual em vez da forma comum. */
  function pearson(a, b) {
    const ma = a.reduce((s, x) => s + x, 0) / a.length;
    const mb = b.reduce((s, x) => s + x, 0) / b.length;
    let d = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i] - ma, y = b[i] - mb;
      d += x * y; na += x * x; nb += y * y;
    }
    return d / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
  }
  function similar(v, perfil) {
    // filtro rígido de pitch: fora da faixa da pessoa, nem compara o resto
    const oct = Math.abs(Math.log2((v.f0 || 1) / (perfil.f0 || 1)));
    if (oct > F0_GATE) return 0;
    const timbre = (pearson(v.ltas, perfil.ltas) + 1) / 2;   // -1..1 → 0..1
    const pit = Math.max(0, 1 - oct * 3.2);
    // trato vocal (F3 é o formante mais estável entre vogais diferentes)
    const tv = perfil.f3 && v.f3 ? Math.max(0, 1 - Math.abs(v.f3 - perfil.f3) / 900) : 0.5;
    return timbre * 0.45 + pit * 0.35 + tv * 0.20;
  }

  /* ── perfil demográfico p/ quem NÃO está cadastrado ── */
  function demografia(v) {
    const f0 = v.f0, f3 = v.f3 || 0;
    // trato vocal curto (F3 alto) + pitch alto ⇒ criança
    if (f0 >= 240 || (f0 >= 200 && f3 > 3300)) {
      const faixa = f0 >= 300 ? 'criança pequena' : 'criança';
      return { tipo: 'criança', desc: `uma ${faixa} (voz aguda, ~${Math.round(f0)} Hz)` };
    }
    if (f0 >= 160) return { tipo: 'mulher', desc: `uma mulher adulta (~${Math.round(f0)} Hz)` };
    if (f0 > 0)    return { tipo: 'homem',  desc: `um homem adulto (~${Math.round(f0)} Hz)` };
    return { tipo: 'indefinido', desc: 'alguém que não consegui caracterizar' };
  }

  /* ═════════ API ═════════ */

  /** cadastra (ou reforça) a voz de uma pessoa */
  async function enroll(nome, relacao, ms = 4000, { usarUltima = false } = {}) {
    if (!nome) return { ok: false, msg: 'informe o nome da pessoa' };

    let v = null, deArquivo = false;
    // aproveita a voz desconhecida recém-ouvida (fluxo "com quem falo?" → "sou a Maria")
    if (usarUltima && ultimaDesconhecida && Date.now() - ultimaDesconhecida.at < 3 * 60000) {
      v = ultimaDesconhecida.v; deArquivo = true;
      ultimaDesconhecida = null;               // uma voz guardada vira UM cadastro, nunca dois
    }
    if (!v) {
      ELX.toast?.(`🎙 Aguardando ${nome} falar… pode começar quando quiser.`, 'green');
      v = await capture({
        falaMs: Math.max(ms, 3500),        // fala EFETIVA (pausas não contam)
        esperaVozMs: 25000,                // dá tempo de a pessoa se organizar
        aviso: fase => { if (fase === 'ouvindo') ELX.toast?.(`🎙 Ouvindo ${nome}… continue falando.`, 'green'); },
      });
    }
    if (v?.erro) return { ok: false, erro: v.erro, msg: v.msg };
    if (!v) return { ok: false, msg: 'não captei voz suficiente' };
    await loadDB();
    const eq = db.find(x => x.nome.toLowerCase() === nome.toLowerCase());

    /* TRAVA CONTRA CONTAMINAÇÃO DO PERFIL.
       Sem isto, QUALQUER voz captada entra na média. Foi o que estragou o
       perfil do operador: 126 Hz (ele) somado a 207 Hz (voz alheia que o
       microfone pegou junto) virou um centroide de 167 Hz — que não
       reconhece nem um nem outro. Uma amostra fora do tom do perfil é
       recusada em vez de diluir o que já estava certo. */
    if (eq && (eq.amostras || []).length) {
      const f0s = eq.amostras.map(a => a.f0).filter(Boolean).sort((x, y) => x - y);
      const mediana = f0s[Math.floor(f0s.length / 2)];
      const oitavas = Math.abs(Math.log2(v.f0 / mediana));
      if (mediana && oitavas > 0.45) {
        return { ok: false, erro: 'voz-diferente',
          msg: `a voz captada (${Math.round(v.f0)} Hz) está muito distante do perfil já gravado de ${nome} (${Math.round(mediana)} Hz). ` +
               `Não juntei, para não estragar o perfil. Se for OUTRA pessoa, cadastre com o nome dela; se for ${nome} mesmo, ` +
               `refaça num ambiente mais silencioso e sem ninguém falando junto.` };
      }
    }

    const amostras = eq ? (eq.amostras || []).concat([v]).slice(-6) : [v];
    // perfil = média das amostras (centroide)
    const centro = {
      f0: amostras.reduce((s, a) => s + a.f0, 0) / amostras.length,
      f0dev: amostras.reduce((s, a) => s + a.f0dev, 0) / amostras.length,
      f1: amostras.reduce((s, a) => s + a.f1, 0) / amostras.length,
      f2: amostras.reduce((s, a) => s + a.f2, 0) / amostras.length,
      f3: amostras.reduce((s, a) => s + a.f3, 0) / amostras.length,
      ltas: Array.from({ length: NB }, (_, i) => amostras.reduce((s, a) => s + a.ltas[i], 0) / amostras.length),
    };
    const perfil = { nome, relacao: relacao || eq?.relacao || '', ...centro, amostras, at: new Date().toISOString() };
    await saveProfile(perfil);
    return { ok: true, deArquivo,
      msg: `voz de ${nome} memorizada${deArquivo ? ' — aproveitei a voz que acabei de ouvir, sem precisar que repetisse' : ''} (${amostras.length} amostra${amostras.length > 1 ? 's' : ''})`,
      f0: Math.round(v.f0) };
  }

  /** identifica quem está falando agora */
  async function identify(ms = 2000) {
    // identificar é passivo: espera pouco pela voz, para não travar a conversa
    const v = await capture({ falaMs: Math.max(ms, 1500), esperaVozMs: 8000, minAmostras: 6 });
    if (v?.erro) return { ok: false, quem: null, erro: v.erro, msg: v.msg };
    if (!v) return { ok: false, quem: null, msg: 'não captei voz' };
    if (!db.length) await loadDB();

    // ranqueia todos os perfis: precisamos do 2º colocado para exigir margem
    const rank = db.map(p => ({ p, s: similar(v, p) })).sort((a, b) => b.s - a.s);
    const melhor = rank[0] || null, segundo = rank[1];
    const score = melhor ? melhor.s : 0;
    const margem = melhor && segundo ? melhor.s - segundo.s : 1;
    const dem = demografia(v);

    /* Só AFIRMA o nome com score alto E vantagem clara sobre o 2º. Sem a
       margem, duas pessoas de voz parecida (irmãos de idade próxima) fariam
       o sistema cravar um nome no cara ou coroa. */
    if (melhor && score >= SIM_OK && margem >= MARGEM) {
      return { ok: true, quem: melhor.p.nome, relacao: melhor.p.relacao, confianca: +score.toFixed(2), f0: Math.round(v.f0), demografia: dem.tipo };
    }
    if (melhor && score >= SIM_DUVIDA) {
      const empate = segundo && margem < MARGEM ? segundo.p.nome : null;
      return {
        ok: true, quem: null, possivel: melhor.p.nome, empateCom: empate,
        confianca: +score.toFixed(2), f0: Math.round(v.f0), demografia: dem.tipo, desc: dem.desc,
      };
    }
    /* Guarda a voz desconhecida que ACABOU de ser ouvida. É o que permite o
       fluxo natural: "não conheço essa voz" → "com quem tenho o prazer?" →
       "sou a Maria" → cadastrar a Maria com a voz JÁ CAPTURADA, sem pedir
       que ela fale de novo. Validade curta: 3 min — depois disso não há
       garantia de que quem falou por último é a mesma pessoa. */
    ultimaDesconhecida = { v, at: Date.now() };
    return { ok: true, quem: null, desconhecido: true, confianca: +score.toFixed(2), f0: Math.round(v.f0), demografia: dem.tipo, desc: dem.desc };
  }

  /** frase pronta para o agente saber com quem está falando */
  function descrever(r) {
    if (!r || !r.ok) return '';
    if (r.quem) return `Quem está falando: ${r.quem}${r.relacao ? ' (' + r.relacao + ')' : ''} — reconhecido pela voz, confiança ${Math.round(r.confianca * 100)}%.`;
    if (r.possivel) {
      return r.empateCom
        ? `Quem está falando: pode ser ${r.possivel} OU ${r.empateCom} — as vozes ficaram muito próximas (${Math.round(r.confianca * 100)}%), não dá para cravar. Pela voz é ${r.desc}. NÃO chute o nome: pergunte com naturalidade e simpatia com quem você está falando.`
        : `Quem está falando: possivelmente ${r.possivel}, mas sem certeza (${Math.round(r.confianca * 100)}%). Pela voz parece ${r.desc}. Se precisar ter certeza, pergunte com naturalidade quem é.`;
    }
    return `Quem está falando: NÃO é ninguém cadastrado. Pela voz é ${r.desc}. Trate com cordialidade e, se fizer sentido, pergunte quem é.`;
  }

  loadDB();

  ELX.voiceid = {
    enroll, identify, capture, descrever, demografia,
    get perfis() { return db.map(p => ({ nome: p.nome, relacao: p.relacao, f0: Math.round(p.f0), amostras: (p.amostras || []).length })); },
    reload: loadDB, release: releaseMic,
  };
})();
