/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA — gestor de alertas (ESM puro)

   Dois tipos de sinal, com ciclos de vida diferentes:
   · CONDIÇÃO — estado contínuo ("olhos fechados", "intrusão na zona A").
     Existe enquanto o analisador a reportar; só termina depois de
     ausente por `histereseMs`. Sem histerese, um quadro ruidoso
     liga-desliga a sirene dez vezes por segundo — o operador aprende a
     ignorar o alarme, que é o pior desfecho possível para um alarme.
   · EVENTO — fato pontual ("bocejo", "objeto retirado"). Vai ao registro,
     com supressão de repetição por chave.

   Voz: uma fala por vez, a mais grave primeiro. Condição crítica que
   persiste volta a falar a cada `repetirVozCriticoMs`; fala do mesmo
   GRUPO (ex.: três pedestres) respeita cooldown — quem dirige precisa
   de UMA ordem clara, não de um coral.
   ═══════════════════════════════════════════════════════════════════════ */
import { LIMIARES } from './config.js';

const L = LIMIARES.alertas;
export const PESO = { info: 1, aviso: 2, critico: 3 };

export class GestorAlertas {
  constructor(cfg = {}) {
    this.cfg = { ...L, ...cfg, cooldownMs: { ...L.cooldownMs, ...(cfg.cooldownMs || {}) } };
    this.reiniciar();
  }

  reiniciar() {
    this.ativas = new Map();      // chave → condição viva
    this.historico = [];          // registro cronológico (mais novo no fim)
    this.ultimoRegistro = new Map();  // chave/grupo → t (supressão de eventos)
    this.ultimaVoz = new Map();       // grupo → t
    this.filaVoz = [];
    this.silencioAte = 0;
    this.seq = 0;
  }

  silenciar(t, ms = this.cfg.silenciarMs) { this.silencioAte = t + ms; }
  silenciado(t) { return t < this.silencioAte; }

  /** Sincroniza as condições reportadas neste quadro. */
  sincronizar(condicoes, t) {
    const novas = [], escaladas = [], encerradas = [];
    const vistas = new Set();
    for (const c of condicoes) {
      vistas.add(c.chave);
      const ant = this.ativas.get(c.chave);
      if (!ant) {
        const viva = { ...c, desde: t, vistoEm: t };
        this.ativas.set(c.chave, viva);
        novas.push(viva);
        this.#registrar({ tipo: 'condicao', ...c }, t, true);
        if (c.voz) this.#enfileirarVoz(viva, t, true);
      } else {
        const subiu = PESO[c.nivel] > PESO[ant.nivel];
        Object.assign(ant, c, { vistoEm: t });
        if (subiu) {
          escaladas.push(ant);
          this.#registrar({ tipo: 'condicao', ...c }, t, true);
          if (c.voz) this.#enfileirarVoz(ant, t, true);
        }
      }
    }
    for (const [chave, c] of this.ativas) {
      if (vistas.has(chave)) continue;
      if (t - c.vistoEm >= this.cfg.histereseMs) {
        this.ativas.delete(chave);
        encerradas.push(c);
      }
    }
    // repetição de voz para crítico persistente
    for (const c of this.ativas.values()) {
      if (c.nivel !== 'critico' || !c.voz || !vistas.has(c.chave)) continue;
      const ult = this.ultimaVoz.get(c.grupo || c.chave);
      if (!ult || t - ult.t >= this.cfg.repetirVozCriticoMs) this.#enfileirarVoz(c, t, false);
    }
    return { novas, escaladas, encerradas };
  }

  /** Evento pontual. Devolve a entrada registrada, ou null se suprimida. */
  evento(e, t) {
    return this.#registrar({ tipo: 'evento', ...e }, t, false);
  }

  #registrar(e, t, forcar) {
    const chave = e.chave || e.titulo;
    const cd = this.cfg.cooldownMs[e.nivel] ?? 30000;
    if (!forcar && t - (this.ultimoRegistro.get(chave) ?? -Infinity) < cd) return null;
    this.ultimoRegistro.set(chave, t);
    const entrada = { id: ++this.seq, t, ...e };
    this.historico.push(entrada);
    if (this.historico.length > 400) this.historico.splice(0, this.historico.length - 400);
    return entrada;
  }

  #enfileirarVoz(c, t, nova) {
    const g = c.grupo || c.chave;
    const cd = c.nivel === 'critico' ? this.cfg.repetirVozCriticoMs : this.cfg.cooldownMs[c.nivel] ?? 20000;
    const ult = this.ultimaVoz.get(g);
    const desde = ult ? t - ult.t : Infinity;
    if (!nova && desde < cd) return;
    // mesma ordem há instantes: cala — EXCETO se agora é mais grave (escalada nunca espera)
    if (nova && ult && desde < Math.min(cd, 4000) && PESO[c.nivel] <= PESO[ult.nivel]) return;
    const fila = this.filaVoz.find(v => v.grupo === g);
    if (fila) { if (PESO[c.nivel] > PESO[fila.nivel]) Object.assign(fila, { nivel: c.nivel, texto: c.voz, t }); return; }
    this.filaVoz.push({ grupo: g, nivel: c.nivel, texto: c.voz, t });
  }

  /** Próxima fala (a mais grave). null se nada a dizer ou se silenciado. */
  proximaFala(t) {
    if (!this.filaVoz.length) return null;
    if (this.silenciado(t)) { this.filaVoz.length = 0; return null; }
    this.filaVoz.sort((a, b) => PESO[b.nivel] - PESO[a.nivel] || a.t - b.t);
    const v = this.filaVoz.shift();
    this.ultimaVoz.set(v.grupo, { t, nivel: v.nivel });
    return v;
  }

  nivelAtual() {
    let n = 0;
    for (const c of this.ativas.values()) n = Math.max(n, PESO[c.nivel] || 0);
    return n === 3 ? 'critico' : n === 2 ? 'aviso' : n === 1 ? 'info' : null;
  }

  /** Sirene: só condição crítica viva — e nunca durante o silêncio pedido pelo operador. */
  sireneLigada(t) {
    if (this.silenciado(t)) return false;
    for (const c of this.ativas.values()) if (c.nivel === 'critico') return true;
    return false;
  }

  /**
   * Nível de ameaça estilo DEFCON (5 = nominal … 1 = crítico agora).
   * Combina o que está ATIVO com o que ACONTECEU no último minuto. Evento
   * informativo ("calibração concluída", "bocejo") não é ameaça e não mexe
   * no nível — um indicador que sobe à toa ensina o operador a ignorá-lo.
   */
  defcon(t) {
    const atual = this.nivelAtual();
    if (atual === 'critico') return 1;
    const recente = this.historico.filter(e => t - e.t <= 60000);
    if (recente.some(e => e.nivel === 'critico')) return 2;
    if (atual === 'aviso') return 3;
    if (recente.some(e => e.nivel === 'aviso')) return 4;
    return 5;
  }

  listaAtivas() {
    return [...this.ativas.values()].sort((a, b) => PESO[b.nivel] - PESO[a.nivel] || a.desde - b.desde);
  }
}
