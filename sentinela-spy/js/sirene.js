/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA — sirene, voz, vibração e tela ligada (navegador)

   A sirene é SINTETIZADA (Web Audio), não um arquivo: dois osciladores
   (quadrada + dente-de-serra levemente desafinada) varridos por um LFO
   entre ~700 e ~1600 Hz — o padrão "yelp" das sirenes de emergência,
   escolhido porque a faixa de 1–2 kHz é onde o ouvido humano é mais
   sensível. Passa por um compressor para soar no máximo sem estourar.

   Voz e sirene não tocam juntas: durante a fala, a sirene cai para 18%
   (ducking). Uma ordem falada por cima de uma sirene a 100% é ruído — e
   a ordem ("estacione") é a parte que salva.

   Restrições de navegador tratadas aqui:
   · áudio só destrava com GESTO do usuário → desbloquear() roda no
     clique de INICIAR OPERAÇÃO;
   · iOS: a chave silenciosa emudece Web Audio; navigator.audioSession
     (quando existir) pede a categoria "playback";
   · tela apagando no meio da viagem → Screen Wake Lock, refeito quando a
     página volta ao primeiro plano.
   ═══════════════════════════════════════════════════════════════════════ */

export class Sirene {
  constructor() {
    this.ctx = null; this.mestre = null; this.nos = null;
    this.volume = 0.9;
    this.vozLigada = true;
    this.falando = false;
    this.voz = null;
    this.trava = null;
  }

  /** Precisa rodar dentro de um gesto do usuário (clique/toque). */
  desbloquear() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 8;
      comp.attack.value = 0.003; comp.release.value = 0.15;
      this.mestre = this.ctx.createGain();
      this.mestre.gain.value = 0;
      this.mestre.connect(comp).connect(this.ctx.destination);
      // buffer mudo: destrava o caminho de áudio no Safari
      const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.ctx.destination); s.start(0);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.#escolherVoz();
    if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => this.#escolherVoz();
    return true;
  }

  get ligada() { return !!this.nos; }

  ligar() {
    if (!this.ctx || this.nos) return;
    const c = this.ctx, agora = c.currentTime;
    const lfo = c.createOscillator(), lfoGanho = c.createGain();
    lfo.type = 'triangle'; lfo.frequency.value = 2.6;      // ~2,6 varreduras/s: urgência sem virar zumbido
    lfoGanho.gain.value = 450;
    const a = c.createOscillator(), b = c.createOscillator();
    a.type = 'square'; b.type = 'sawtooth';
    a.frequency.value = 1150; b.frequency.value = 1150; b.detune.value = 12;
    lfo.connect(lfoGanho); lfoGanho.connect(a.frequency); lfoGanho.connect(b.frequency);
    const mix = c.createGain(); mix.gain.value = 0.5;
    a.connect(mix); b.connect(mix); mix.connect(this.mestre);
    lfo.start(agora); a.start(agora); b.start(agora);
    this.mestre.gain.cancelScheduledValues(agora);
    this.mestre.gain.setTargetAtTime(this.falando ? this.volume * 0.18 : this.volume, agora, 0.03);
    this.nos = { lfo, a, b, mix };
  }

  desligar() {
    if (!this.nos) return;
    const c = this.ctx, agora = c.currentTime, n = this.nos;
    this.mestre.gain.cancelScheduledValues(agora);
    this.mestre.gain.setTargetAtTime(0, agora, 0.05);
    setTimeout(() => { try { n.lfo.stop(); n.a.stop(); n.b.stop(); n.mix.disconnect(); } catch {} }, 300);
    this.nos = null;
  }

  /** Bipe de aviso (não-crítico): dois toques curtos. */
  bipe(nivel = 'aviso') {
    if (!this.ctx || this.nos) return;      // sirene tocando já diz tudo
    const c = this.ctx, t0 = c.currentTime;
    const f = nivel === 'aviso' ? 880 : 660;
    for (let k = 0; k < 2; k++) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + k * 0.22);
      g.gain.linearRampToValueAtTime(0.55 * this.volume, t0 + k * 0.22 + 0.01);
      g.gain.setTargetAtTime(0, t0 + k * 0.22 + 0.12, 0.03);
      o.connect(g).connect(c.destination);
      o.start(t0 + k * 0.22); o.stop(t0 + k * 0.22 + 0.3);
    }
  }

  definirVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.nos && this.ctx) this.mestre.gain.setTargetAtTime(this.falando ? this.volume * 0.18 : this.volume, this.ctx.currentTime, 0.05);
  }

  #escolherVoz() {
    if (!('speechSynthesis' in window)) return;
    const vozes = speechSynthesis.getVoices();
    const pt = vozes.filter(v => /^pt[-_]BR/i.test(v.lang));
    // vozes neurais/online soam mais claras quando existem
    this.voz = pt.find(v => /natural|neural|online|google/i.test(v.name)) || pt[0] || vozes.find(v => /^pt/i.test(v.lang)) || null;
  }

  /** Fala em pt-BR; a sirene abaixa enquanto fala. Resolve ao terminar. */
  /** forcar: a checagem de saúde fala mesmo com a voz geral desligada — é o único canal com quem dirige. */
  falar(texto, { urgente = false, forcar = false } = {}) {
    if ((!this.vozLigada && !forcar) || !texto || !('speechSynthesis' in window)) return Promise.resolve();
    return new Promise(resolve => {
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = 'pt-BR';
      if (this.voz) u.voice = this.voz;
      u.rate = urgente ? 1.08 : 1.0; u.pitch = 1.0; u.volume = 1;
      const fim = () => {
        this.falando = false;
        if (this.nos && this.ctx) this.mestre.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.08);
        resolve();
      };
      u.onend = fim; u.onerror = fim;
      this.falando = true;
      if (this.nos && this.ctx) this.mestre.gain.setTargetAtTime(this.volume * 0.18, this.ctx.currentTime, 0.04);
      if (urgente) speechSynthesis.cancel();   // ordem urgente interrompe a anterior
      speechSynthesis.speak(u);
      setTimeout(fim, 12000);                  // alguns navegadores esquecem o onend
    });
  }

  calar() { try { speechSynthesis.cancel(); } catch {} this.falando = false; }

  vibrar(padrao = [400, 120, 400, 120, 400]) { try { navigator.vibrate?.(padrao); } catch {} }

  async manterTelaLigada() {
    if (!('wakeLock' in navigator)) return false;
    const pedir = async () => {
      try { this.trava = await navigator.wakeLock.request('screen'); } catch { this.trava = null; }
    };
    await pedir();
    if (!this._visivel) {
      // o navegador solta a trava sozinho quando a página fica oculta; ao voltar, pede de novo
      this._visivel = () => { if (document.visibilityState === 'visible') pedir(); };
      document.addEventListener('visibilitychange', this._visivel);
    }
    return !!this.trava;
  }
}
