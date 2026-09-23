/* ═══════════════════════════════════════════════════════════════════
   ELION-X v3 — Orquestrador do Agente
   · Loop agêntico via SSE (/api/chat) com ferramentas
   · Continuação com frame da câmera quando o agente decide VER
   · Console de comunicação · Boot · Relógio · LEDs · Quick actions
═══════════════════════════════════════════════════════════════════ */
(function () {
  const $ = id => document.getElementById(id);
  const consoleMsgs = $('consoleMsgs');
  const cmd = $('cmd');

  /* ── histórico no formato da API (content pode ser string ou blocos) ── */
  const history = [];
  let busy = false;

  function compactHistory() {
    const MAX = 26;
    if (history.length <= MAX) return;
    let cut = -1;
    for (let i = history.length - MAX; i < history.length; i++) {
      if (history[i].role === 'user' && typeof history[i].content === 'string') { cut = i; break; }
    }
    if (cut > 0) history.splice(0, cut);
    // remove frames antigos p/ economizar tokens
    history.forEach((m, idx) => {
      if (idx >= history.length - 4 || !Array.isArray(m.content)) return;
      m.content.forEach(b => {
        if (b.type === 'tool_result' && Array.isArray(b.content)) {
          b.content = b.content.map(c => c.type === 'image' ? { type: 'text', text: '[frame da câmera analisado anteriormente]' } : c);
        }
      });
    });
  }

  /* ── render do console ── */
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function md(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/^###?\s?(.+)$/gm, '<b>$1</b>')
      .replace(/^[-•]\s/gm, '&nbsp;• ')
      .replace(/\n/g, '<br>');
  }
  function scrollDown() { consoleMsgs.scrollTop = consoleMsgs.scrollHeight; }

  function addUser(text) {
    const el = document.createElement('div');
    el.className = 'msg user';
    el.innerHTML = `<div class="who">OPERADOR</div><div class="body"></div>`;
    el.querySelector('.body').textContent = text;
    consoleMsgs.appendChild(el); scrollDown();
  }
  function addSys(text) {
    const el = document.createElement('div');
    el.className = 'msg sys';
    el.textContent = text;
    consoleMsgs.appendChild(el); scrollDown();
  }
  let openTools = [];
  function addTool(label) {
    const el = document.createElement('div');
    el.className = 'msg tool';
    el.textContent = label;
    consoleMsgs.appendChild(el);
    openTools.push(el);
    scrollDown();
  }
  function settleTools() { openTools.forEach(t => t.classList.add('done')); openTools = []; }

  function newAiBubble() {
    const el = document.createElement('div');
    el.className = 'msg ai';
    el.innerHTML = `<div class="who">ELION-X</div><div class="body"><span class="cursor-blink"></span></div>`;
    consoleMsgs.appendChild(el); scrollDown();
    const body = el.querySelector('.body');
    let raw = '';
    return {
      push(t) { raw += t; settleTools(); body.innerHTML = md(raw) + '<span class="cursor-blink"></span>'; scrollDown(); },
      finish() { body.innerHTML = raw ? md(raw) : '<i style="opacity:.5">— ação concluída —</i>'; scrollDown(); },
      get text() { return raw; },
      get empty() { return !raw.trim(); },
    };
  }

  /* ── stream SSE de /api/chat ── */
  async function streamChat(onEvent, signal) {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history }),
      signal,
    });
    if (!r.ok || !r.body) {
      let msg = 'HTTP ' + r.status;
      try { msg = (await r.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let ev; try { ev = JSON.parse(line.slice(6)); } catch { continue; }
        onEvent(ev);
      }
    }
  }

  /* ── ciclo de conversa (com continuação p/ câmera) ── */
  async function runTurn(bubble, speaker, signal) {
    let cameraReq = null;
    let errored = null;

    await streamChat(ev => {
      if (ev.text) { bubble.push(ev.text); speaker.feed(ev.text); }
      if (ev.tool) addTool(ev.tool.label || ev.tool.name);
      /* Contingência de provedor. Aparece na tela DE PROPÓSITO: se o desvio
         fosse silencioso, o Senhor veria o ELION funcionando e concluiria que
         a conta da Anthropic está boa — justamente quando ela não está. */
      if (ev.aviso) { addSys('⚠ ' + ev.aviso); ELX.toast('Operando em contingência — veja o canal', 'amber'); }
      if (ev.ui) {
        // automação visível: o quadrante alvo pulsa quando o agente o preenche
        const pulse = id => {
          const q = document.getElementById(id);
          if (!q) return;
          q.classList.remove('autopulse'); void q.offsetWidth;
          q.classList.add('autopulse');
          setTimeout(() => q.classList.remove('autopulse'), 2400);
        };
        if (ev.ui.type === 'weather') { ELX.clima.render(ev.ui.payload); pulse('qClima'); }
        if (ev.ui.type === 'news')    { ELX.news.render(ev.ui.payload); pulse('qNews'); }
        if (ev.ui.type === 'agenda')  { ELX.agenda.render(ev.ui.payload, ev.ui.added); pulse('qAgenda'); }
        if (ev.ui.type === 'browser') ELX.web?.open(ev.ui.url, ev.ui.title);
        if (ev.ui.type === 'email')   ELX.email?.render(ev.ui.payload);
        if (ev.ui.type === 'switch_camera') { ELX.cam?.switchByHint?.(ev.ui.hint); pulse('qCam'); }
        if (ev.ui.type === 'enroll_face') { ELX.cam?.enroll?.(ev.ui.name, ev.ui.relation); pulse('qCam'); }
        // ── biometria vocal: roda no cliente (é onde está o microfone) e o
        //    resultado volta ao agente como mensagem de sistema ──
        if (ev.ui.type === 'enroll_voice') {
          ELX.voiceid?.enroll(ev.ui.name, ev.ui.relation, (ev.ui.seconds || 3) * 1000, { usarUltima: !!ev.ui.useLast })
            .then(r => {
              ELX.toast?.(r.ok ? `✓ ${r.msg}` : '✕ ' + r.msg, r.ok ? 'green' : 'red');
              sendWhenIdle(`SISTEMA (biometria vocal): ${r.ok
                ? `voz de ${ev.ui.name} cadastrada com sucesso (${r.msg}). Confirme ao operador com naturalidade.`
                : `não consegui cadastrar a voz de ${ev.ui.name}: ${r.msg}. Peça para tentar de novo falando mais e mais perto do microfone.`}`);
            }).catch(() => {});
        }
        if (ev.ui.type === 'identify_voice') {
          ELX.voiceid?.identify((ev.ui.seconds || 2) * 1000)
            .then(r => {
              const txt = ELX.voiceid.descrever(r);
              if (r?.quem) ELX.toast?.(`🎙 ${r.quem} está falando`, 'green');
              sendWhenIdle(`SISTEMA (biometria vocal): ${txt || 'não consegui identificar a voz — peça para a pessoa falar um pouco mais.'}`);
            }).catch(() => {});
        }
        if (ev.ui.type === 'council') ELX.council?.render(ev.ui.payload);
        if (ev.ui.type === 'market')  { ELX.market?.set(ev.ui.symbol); if (ev.ui.note) ELX.market?.note(ev.ui.note); pulse('qMarket'); }
        if (ev.ui.type === 'portfolio') ELX.portfolio?.render(ev.ui.payload);
        if (ev.ui.type === 'lottery') ELX.lottery?.render(ev.ui.payload);
        if (ev.ui.type === 'lottery_sim') ELX.lotterySim?.render(ev.ui.payload);
        if (ev.ui.type === 'cyber')   ELX.cyber?.render(ev.ui.payload);
        if (ev.ui.type === 'nasa')    ELX.nasa?.open(ev.ui.payload);
        if (ev.ui.type === 'monitor') ELX.monitor?.open(ev.ui.video, ev.ui.lista);
        if (ev.ui.type === 'monitor_play') ELX.monitor?.play();
        // WhatsApp: o painel vive em whatsapp.html (iframe do visor) — aqui só damos
        // o retorno visível de que o agente mexeu nele
        if (ev.ui.type === 'whatsapp') {
          const n = (ev.ui.payload || []).length;
          ELX.toast?.(`WhatsApp: ${n} conversa(s) lida(s).`, 'green');
        }
        if (ev.ui.type === 'whatsapp_auto') {
          ELX.toast?.(`Resposta automática do WhatsApp ${ev.ui.on ? 'LIGADA — só responde os contatos liberados' : 'desligada'}.`, ev.ui.on ? 'green' : '');
        }
        if (ev.ui.type === 'open_screen') {
          ELX.screens?.open(ev.ui.screen, ev.ui);
          const qmap = { camera: 'qCam', market: 'qMarket' };
          if (qmap[ev.ui.screen]) pulse(qmap[ev.ui.screen]);
        }
        if (ev.ui.type === 'close_screen') ELX.screens?.close(ev.ui.screen);
      }
      if (ev.camera) cameraReq = ev;
      if (ev.error) errored = ev.error;
    }, signal);
    settleTools();
    if (errored) throw new Error(errored);

    /* o agente pediu para VER — visão computacional com overlay analítico */
    if (cameraReq) {
      speaker.flush(); // fala o preâmbulo já gerado enquanto escaneia
      addTool('Sensor óptico ativo — visão computacional em varredura');

      let resultContent, isErr = false;
      try {
        // analyze desenha o overlay (boxes/idade/emoção) e devolve dados estruturados; não fala (o loop fala)
        const d = await ELX.cam.analyze({ prompt: cameraReq.camera.focus || '', speak: false });
        const subs = (d.subjects || []).map(s =>
          s.type === 'pessoa'
            ? `${s.label || 'pessoa'}: idade ~${s.age || '?'}, EMOÇÃO ${s.emotion || '?'}, ${s.gender || ''}${s.clothing ? `, vestindo ${s.clothing}` : ''} — ${s.behavior || ''}${s.attributes?.length ? ' (' + s.attributes.join(', ') + ')' : ''}`
            : `${s.label || s.type} (${s.type})${s.emotion ? ', ' + s.emotion : ''}${s.behavior ? ' — ' + s.behavior : ''}`
        ).join('; ');
        resultContent =
          `Análise de visão computacional (algoritmos IoT) concluída e exibida no monitor óptico ampliado com overlay de pontos analíticos. ` +
          `Pessoas: ${d.scene?.peopleCount ?? 0}, animais: ${d.scene?.animalCount ?? 0}. ` +
          (d.scene?.mood ? `Clima da cena: ${d.scene.mood}. ` : '') +
          (subs ? `Detecções: ${subs}. ` : '') +
          (d.scene?.environment ? `Ambiente: ${d.scene.environment}. ` : '') +
          (d.scene?.interaction ? `Interação: ${d.scene.interaction}. ` : '') +
          `Narração para transmitir ao operador: "${d.narration}". ` +
          `Repasse essa leitura ao operador de forma natural, SEMPRE mencionando a EMOÇÃO percebida (feliz, triste, com raiva, cansado…) e a ROUPA que ele veste quando houver uma pessoa.`;
      } catch (e) {
        resultContent = `ERRO ao acessar a visão: ${e.message}`;
        isErr = true;
      }

      const toolResults = [...(cameraReq.pending?.toolResults || [])];
      toolResults.push({ type: 'tool_result', tool_use_id: cameraReq.camera.tool_use_id, content: resultContent, ...(isErr ? { is_error: true } : {}) });

      history.push({ role: 'assistant', content: cameraReq.pending.assistant });
      history.push({ role: 'user', content: toolResults });
      settleTools();

      let bubble2 = bubble;
      if (!bubble.empty) { bubble.finish(); bubble2 = newAiBubble(); }
      return runTurn(bubble2, speaker, signal); // continua o loop com a análise
    }
    return bubble;
  }

  let currentCtl = null;   // AbortController do turno em curso
  let pendingSend = null;  // mensagem que chegou durante uma interrupção

  /* Resultado assíncrono (biometria vocal etc.) chega segundos depois da
     ferramenta ser chamada — se o turno ainda estiver gerando, send() faria
     barge-in e ABORTARIA a resposta em andamento. Aqui esperamos a vez. */
  async function sendWhenIdle(text, ms = 20000) {
    const t0 = Date.now();
    while (busy && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 220));
    send(text, { silent: true });
  }

  async function send(text, { silent = false } = {}) {
    text = (text || '').trim();
    if (!text) return;
    if (busy) { pendingSend = text; currentCtl?.abort(); return; } // barge-in com fala nova
    busy = true;
    ELX.voice.stop();
    if (!silent) addUser(text);
    history.push({ role: 'user', content: text });
    compactHistory();
    ELX.setState('thinking');
    const bubble = newAiBubble();
    const ctl = new AbortController();
    currentCtl = ctl;

    /* locutor incremental — fala cada frase assim que ela termina de ser gerada */
    let sentBuf = '';
    let spokeFirst = false;
    const speaker = {
      feed(t) {
        sentBuf += t;
        let idx = -1;
        const re = /[.!?…]["')\]]?(?=\s|$)/g;
        let m; while ((m = re.exec(sentBuf))) idx = m.index + m[0].length;
        const minLen = spokeFirst ? 30 : 12; // primeira frase sai o quanto antes
        if ((idx >= minLen) || (idx > 0 && sentBuf.length > 110) || sentBuf.length > 340) {
          const cut = idx > 0 ? idx : sentBuf.length;
          const part = sentBuf.slice(0, cut).trim();
          sentBuf = sentBuf.slice(cut);
          if (part) { ELX.voice.speak(part); spokeFirst = true; }
        }
      },
      flush() {
        const part = sentBuf.trim();
        sentBuf = '';
        if (part) ELX.voice.speak(part);
      },
    };
    ELX.voice.hold(true); // mantém o estado de fala aberto até o fim da geração

    try {
      const finalBubble = await runTurn(bubble, speaker, ctl.signal);
      speaker.flush();
      finalBubble.finish();
      if (finalBubble.text) {
        history.push({ role: 'assistant', content: finalBubble.text });
      } else {
        history.push({ role: 'assistant', content: '(ação concluída)' });
        if (ELX.state === 'thinking') ELX.setState('idle');
      }
      // mantém análise visível no quadrante da câmera
      if (ELX.cam.on && finalBubble.text && finalBubble.text.length > 60 &&
          /vej|vest|ambient|câmera|camera|cena|segur/i.test(finalBubble.text)) {
        ELX.cam.setOut(finalBubble.text.replace(/\*\*/g, ''));
      }
    } catch (e) {
      const aborted = e.name === 'AbortError' || ctl.signal.aborted;
      bubble.finish();
      if (aborted) {
        addSys('— transmissão interrompida pelo operador —');
        history.push({
          role: 'assistant',
          content: (bubble.text ? bubble.text + '\n' : '') + '[fala interrompida pelo operador no meio — responda à próxima mensagem com prioridade]',
        });
      } else if (/RATE_LIMIT|rate limit|429/i.test(e.message)) {
        addSys('⏳ Limite de uso da API atingido — aguarde alguns segundos e repita, Senhor.');
        ELX.toast('Limite de tokens por minuto atingido. Tente de novo em instantes.', 'red');
        ELX.voice?.speak('Atingi o limite de uso da API neste minuto, Senhor. Aguarde alguns segundos e repita, por favor.');
        ELX.setState('idle');
        history.push({ role: 'assistant', content: '(limite de taxa da API — pediu para repetir)' });
      } else {
        addSys('FALHA DE COMUNICAÇÃO: ' + e.message);
        ELX.toast(e.message, 'red');
        ELX.setState('idle');
        history.push({ role: 'assistant', content: '(falha de comunicação)' });
      }
    } finally {
      if (currentCtl === ctl) currentCtl = null;
      busy = false;
      ELX.voice.hold(false);
      ELX.agenda?.load(); // garante que o quadrante reflita o estado real em disco
      if (pendingSend) { const t = pendingSend; pendingSend = null; send(t); }
    }
  }

  /** corta geração + fala imediatamente (barge-in / Esc) */
  function interrupt(reason) {
    currentCtl?.abort();
    ELX.voice.stop();
  }

  /* RESPOSTA LOCAL — sem ida ao modelo.
     Quando o operador diz apenas "ELION", ele está CHAMANDO, não pedindo nada.
     Mandar isso ao modelo custava uma volta inteira e devolvia uma saudação
     completa — geralmente a MESMA que já estava no histórico logo acima, porque
     a situação era idêntica e a frase anterior servia de molde. O resultado era
     ele dizer duas vezes seguidas "Boa tarde novamente, Senhor. Sistemas online."
     Um assistente de verdade responde "Pois não?" na hora, e espera. */
  function responderLocal(texto) {
    const b = newAiBubble();
    b.push(texto); b.finish();
    history.push({ role: 'assistant', content: texto });
    ELX.voice.speak(texto);
  }

  ELX.agent = { send, history, interrupt, responderLocal };

  /* ── dock: altura dinâmica ──
     Os botões de acesso rápido agora ganham a linha de baixo inteira e
     quebram para mais linhas se precisarem (ver .quick no CSS) — então o
     dock deixou de ter altura fixa. --dock-h ainda é usada para posicionar
     o Visor Web flutuante logo acima do dock (bottom: calc(--dock-h + 16px));
     sem manter essa variável sincronizada com a altura REAL, o visor ficaria
     encostado no dock ou flutuando com um vão, sempre que a fileira de
     botões precisasse de mais de uma linha. */
  const dockEl = $('dock');
  if (dockEl) {
    const syncDockH = () => document.documentElement.style.setProperty('--dock-h', dockEl.offsetHeight + 'px');
    new ResizeObserver(syncDockH).observe(dockEl);
    // reforço: 'resize' da window cobre o caso raro de o navegador suspender
    // ResizeObserver com a aba em segundo plano — custa nada, redundante na
    // maioria dos casos, mas fecha a lacuna quando ela existir
    addEventListener('resize', syncDockH);
    syncDockH();
  }

  /* ── entrada ── */
  $('sendBtn').onclick = () => { const t = cmd.value; cmd.value = ''; send(t); };
  cmd.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const t = cmd.value; cmd.value = ''; send(t); }
  });

  /* quick actions */
  $('qaScan').onclick   = () => send('Acesse minha câmera agora e analise detalhadamente o que você vê: o que estou fazendo, vestindo, o ambiente e quem está comigo.');
  $('qaClima').onclick  = () => send('Como está o clima agora em Santos e qual a previsão para os próximos dias?');
  $('qaNews').onclick   = () => send('Verifique as notícias de IA mais recentes e me dê um resumo das 5 mais relevantes.');
  $('qaAgenda').onclick = () => send('Liste meus próximos compromissos da agenda.');
  $('qaBrain').onclick = () => ELX.brain.open(); // janela rastreada → o ELION consegue fechá-la por voz
  $('qaCyber').onclick = () => ELX.cyber.open(); // console de defesa cibernética (simulação + telemetria real)
  /* MODO NASA: abre o console de espectro e já avisa o agente que ele está no
     ar, para o operador poder pedir a varredura falando, sem clicar em mais nada. */
  $('qaNasa').onclick = () => {
    ELX.nasa.open();
    send('Ative seu modo NASA. O console de rastreio de espectro está aberto. Pergunte-me de qual cidade, município ou região do Brasil devo levantar as antenas das operadoras.');
  };
  $('qaMarket').onclick = () => {
    const sym = ($('mktQ').value.trim() || ELX.market?.symbol || '').toUpperCase();
    if (!sym) { $('mktQ').focus(); ELX.toast('Informe um ativo no quadrante MERCADO (ex.: AAPL, BTCUSD, PETR4).', 'red'); return; }
    send(`Analise o gráfico de ${sym} no mercado, de forma educativa.`);
  };
  $('qaEmail').onclick  = async () => {
    const ok = await ELX.email.connect();
    if (ok) send('Verifique meus emails recentes do Gmail e me dê um resumo dos mais importantes, destacando os não lidos.');
  };
  $('qaWhats').onclick  = () => ELX.whatsapp.open();
  /* ── CONSELHO DE DECISÃO: seletor visual de modelo + modificadores empilháveis ── */
  const cMod = { mode: 'jury', confidence: false, adaptive: false, measureDiversity: false };
  const councilModal = $('councilModal'), cmCost = $('cmCost'), cmQ = $('cmQuestion');
  function cmRefresh() {
    document.querySelectorAll('#cmModes .cm-mode').forEach(b => b.classList.toggle('sel', b.dataset.mode === cMod.mode));
    document.querySelectorAll('#cmFlags .cm-flag').forEach(b => b.classList.toggle('on', cMod[b.dataset.flag]));
    const adv = cMod.mode === 'quick' ? 3 : 5;
    const tail = 1 /*advogado*/ + (cMod.mode === 'jury' ? 4 : 1) + (cMod.measureDiversity ? 1 : 0);
    cmCost.textContent = cMod.adaptive
      ? `≈ ${adv + adv + tail}–${adv + adv * 3 + tail} IAs · roda até convergir`
      : `≈ ${adv + (cMod.mode === 'quick' ? 0 : adv) + tail} IAs`;
  }
  function cmClose() { councilModal.hidden = true; }
  $('qaCouncil').onclick = () => { councilModal.hidden = false; cmRefresh(); setTimeout(() => cmQ.focus(), 60); };
  $('cmClose').onclick = cmClose;
  $('cmCancel').onclick = cmClose;
  councilModal.onclick = e => { if (e.target === councilModal) cmClose(); };
  document.querySelectorAll('#cmModes .cm-mode').forEach(b => b.onclick = () => { cMod.mode = b.dataset.mode; cmRefresh(); });
  document.querySelectorAll('#cmFlags .cm-flag').forEach(b => b.onclick = () => { cMod[b.dataset.flag] = !cMod[b.dataset.flag]; cmRefresh(); });
  $('cmGo').onclick = () => {
    const q = cmQ.value.trim();
    if (!q) { cmQ.focus(); ELX.toast('Descreva a decisão a deliberar.', 'red'); return; }
    const hdr = `[CONSELHO · modo=${cMod.mode} · confiança=${cMod.confidence ? 'on' : 'off'} · adaptativo=${cMod.adaptive ? 'on' : 'off'} · diversidade=${cMod.measureDiversity ? 'on' : 'off'}]`;
    cmClose();
    send(`${hdr}\nDecisão: ${q}`);
    cmQ.value = '';
  };
  cmQ.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') $('cmGo').click(); });

  /* ── DOCUMENTOS: anexar (botão) + arrastar-e-soltar ── */
  const docInput = $('docInput'), dropZone = $('dropZone');
  $('qaDoc').onclick = () => docInput.click();
  docInput.onchange = () => { if (docInput.files[0]) uploadDocument(docInput.files[0]); docInput.value = ''; };

  let dragDepth = 0;
  window.addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); dragDepth++; dropZone.classList.add('show'); } });
  window.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  window.addEventListener('dragleave', e => { if (--dragDepth <= 0) { dragDepth = 0; dropZone.classList.remove('show'); } });
  window.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; dropZone.classList.remove('show');
    const f = e.dataTransfer?.files?.[0];
    if (f) uploadDocument(f);
  });

  async function uploadDocument(file) {
    const okExt = /\.(pdf|docx|pptx|txt|md|csv)$/i.test(file.name);
    if (!okExt) return ELX.toast('Formato não suportado. Use PDF, Word, PowerPoint ou TXT.', 'red');
    if (file.size > 40 * 1024 * 1024) return ELX.toast('Arquivo muito grande (máx 40MB).', 'red');
    ELX.toast(`Recebendo "${file.name}"… lendo e analisando.`, 'green');
    addSys(`📄 documento recebido: ${file.name} — processando…`);
    try {
      const data = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const resp = await fetch('/api/document', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, data }),
      }).then(r => r.json());
      if (resp.error) throw new Error(resp.error);
      ELX.toast(`"${resp.name}" lido (${resp.pages ? resp.pages + ' págs · ' : ''}${resp.chars.toLocaleString('pt-BR')} caracteres).`, 'green');
      // o agente analisa automaticamente
      send(`Acabei de enviar o documento "${resp.name}". Leia-o, me dê um resumo do que ele trata, comente os pontos principais e sugira como devo abordar o tema. Seja objetivo.`);
    } catch (e) {
      addSys('✕ falha ao processar o documento: ' + e.message);
      ELX.toast('Falha no documento: ' + e.message, 'red');
    }
  }

  /* ── GPS DO COMPUTADOR — posição do operador vira o padrão da meteorologia ── */
  function acquireGeo(loadWeather) {
    if (!navigator.geolocation) { if (loadWeather) ELX.clima.load('Santos'); return; }
    navigator.geolocation.getCurrentPosition(async pos => {
      ELX.geo = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: Math.round(pos.coords.accuracy || 0) };
      // persiste no servidor: as ferramentas do agente (get_weather sem cidade) usam esta posição
      try { await fetch('/api/geo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ELX.geo) }); } catch {}
      if (loadWeather) ELX.clima.load();                 // sem cidade → clima da posição GPS
    }, () => { if (loadWeather) ELX.clima.load('Santos'); }, // negado/indisponível → base padrão
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  }
  setInterval(() => acquireGeo(false), 15 * 60000);     // reatualiza a posição a cada 15 min

  /* ── relógio ── */
  function tick() {
    const n = new Date();
    $('clock').textContent = n.toLocaleTimeString('pt-BR', { hour12: false });
    $('dateline').textContent = n.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  }
  setInterval(tick, 250); tick();

  /* ── LEDs de status ── */
  async function refreshLeds() {
    $('ledNet').classList.toggle('on', navigator.onLine);
    try {
      const s = await fetch('/api/status').then(r => r.json());
      $('ledCore').classList.toggle('on', !!s.anthropic);
      $('ledCore').classList.toggle('err', !s.anthropic);
      $('ledVoice').classList.add('on'); // Edge TTS sempre disponível
      return s;
    } catch {
      $('ledCore').classList.add('err');
      return null;
    }
  }
  setInterval(refreshLeds, 30000);

  /* ═════════════════ BOOT ═════════════════ */
  const bootLines = [
    ['NÚCLEO NEURAL ELION-X v3.0', 320],
    ['Carregando malha de sinapses quânticas', 280],
    ['Vinculando motor de raciocínio · Claude Sonnet', 300],
    ['Sintetizador vocal neural — pt-BR · timbre grave', 260],
    ['Satélites meteorológicos — uplink estabelecido', 240],
    ['Interceptadores de notícias — fontes globais e brasileiras', 240],
    ['Cronograma do operador — montado', 200],
    ['Sensor óptico em prontidão', 200],
    ['Protocolos de segurança verificados', 220],
    ['TODOS OS SISTEMAS NOMINAIS', 350],
  ];

  async function bootSequence() {
    const log = $('bootLog'), fill = $('bootBarFill'), btn = $('bootStart');
    refreshLeds();
    for (let i = 0; i < bootLines.length; i++) {
      await new Promise(r => setTimeout(r, bootLines[i][1]));
      const d = document.createElement('div');
      d.textContent = '▸ ' + bootLines[i][0];
      d.classList.add('ok');
      log.appendChild(d);
      while (log.children.length > 8) log.firstChild.remove();
      fill.style.width = `${((i + 1) / bootLines.length) * 100}%`;
    }
    btn.disabled = false;
    btn.onclick = startSystem;
  }

  function startSystem() {
    ELX.voice.ensureCtx();            // desbloqueia áudio com o gesto do usuário
    $('boot').classList.add('off');
    ELX.setState('idle');

    /* carrega quadrantes */
    ELX.agenda.load();
    ELX.news.load();
    refreshLeds();
    acquireGeo(true); // GPS do computador → clima da POSIÇÃO ATUAL (fallback Santos se negado)

    /* primeira ativação do dia → briefing completo; demais → saudação curta */
    const today = new Date().toLocaleDateString('sv');
    const firstOfDay = localStorage.getItem('elx-briefing-date') !== today;

    setTimeout(() => {
      if (firstOfDay) {
        localStorage.setItem('elx-briefing-date', today);
        send(
          'SISTEMA (mensagem automática da plataforma, não do operador): primeira ativação do dia. ' +
          'Faça o briefing matinal falado: cumprimente o operador pelo período do dia, apresente os compromissos de HOJE ' +
          'com horários e observações (mencione brevemente os de amanhã, se existirem), resgate lembretes pertinentes da ' +
          'sua memória persistente, e encerre se colocando à disposição. Fala corrida e natural, sem listas. ' +
          'Se a agenda estiver vazia, diga isso com leveza.',
          { silent: true }
        );
      } else {
        const h = new Date().getHours();
        const per = h < 6 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
        const greet = `${per} novamente, Senhor. Sistemas online. Em que posso servi-lo?`;
        const b = newAiBubble();
        b.push(greet); b.finish();
        history.push({ role: 'assistant', content: greet });
        ELX.voice.speak(greet);
      }
    }, 900);
  }

  bootSequence();
})();
