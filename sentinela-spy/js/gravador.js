/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA — gravador de campo (ESM puro)

   Os limiares dos alarmes são, em sua maioria, HEURÍSTICAS (docs/SENTINELA.md,
   seção 4). Heurística só vira engenharia quando é medida contra a
   realidade — e realidade, aqui, é uma sessão de uso com alguém anotando o
   que de fato aconteceu. Este módulo grava exatamente o que essa medição
   precisa, e nada além:

     · cabeçalho: modo, perfil e TODOS os limiares efetivos da sessão
     · amostras a 10 Hz das métricas DERIVADAS (EAR, PERCLOS, TTC…)
     · início e fim de cada alerta (condição) e eventos pontuais
     · anotações do operador: alerta correto, falso alarme, evento perdido,
       e "marca" (início de um comportamento provocado, para medir latência)

   Privacidade por construção: nenhuma imagem, nenhum ponto facial, nenhuma
   identidade — só números derivados. Ainda assim, fadiga é dado de saúde
   (LGPD, art. 5º, II): a gravação fica só no aparelho, em arquivo que o
   operador baixa e decide onde guardar.

   Formato: JSONL (uma linha JSON por registro) — legível, anexável,
   processável em streaming por scripts/sentinela-avaliar.mjs ou por
   qualquer ferramenta de dados (pandas, DuckDB, Spark).
   ═══════════════════════════════════════════════════════════════════════ */
import { VERSAO } from './config.js';

const r3 = v => (typeof v === 'number' && isFinite(v) ? Math.round(v * 1000) / 1000 : v === Infinity ? null : v ?? null);
const b = v => (v == null ? null : v ? 1 : 0);

/** Métricas compactas por modo — chaves curtas porque são milhares de linhas. */
export function compactar(modo, m = {}) {
  if (modo === 'motorista') {
    return { pr: b(m.presente), ca: b(m.calibrando), ear: r3(m.ear), eb: r3(m.earBase), fe: r3(m.fechamento),
      fc: b(m.fechado), df: r3(m.duracaoFechado), pc: r3(m.perclos), pcc: r3(m.perclosCobertura),
      pm: m.piscadasMin ?? null, bo: m.bocejos5min ?? null, ya: r3(m.yaw), pi: r3(m.pitch), ro: r3(m.roll),
      cel: b(m.celular), mov: b(m.emMovimento), fad: m.indiceFadiga ?? null };
  }
  if (modo === 'transito') {
    const l = m.lider || null, c = m.contagem || {};
    return { lz: r3(l?.z), lt: l && isFinite(l.ttc) ? r3(l.ttc) : null, lf: r3(l?.fechamento), lh: r3(l?.thw),
      vel: r3(m.velocidade), nv: c.veiculo ?? 0, np: c.pedestre ?? 0, na: c.animal ?? 0, no: c.obstaculo ?? 0 };
  }
  return { np: m.pessoas ?? 0, no: m.objetos ?? 0, sd: m.semDono ?? 0, ab: m.abandonados ?? 0 };
}

export const ROTULOS_ANOTACAO = {
  verdadeiro: 'ALERTA CORRETO',
  falso_alarme: 'FALSO ALARME',
  perdeu: 'EVENTO PERDIDO',
  marca: 'MARCA (início de comportamento)',
};

export class GravadorCampo {
  constructor({ amostragemMs = 100, maxLinhas = 250000 } = {}) {
    this.amostragemMs = amostragemMs;   // 10 Hz: resolve piscada (~0,2 s) sem inflar o arquivo
    this.maxLinhas = maxLinhas;         // ~7 h a 10 Hz — teto de memória do navegador
    this.reiniciar();
  }

  reiniciar() {
    this.linhas = [];
    this.t0 = null;
    this.proximaAmostra = -Infinity;
    this.ativo = false;
    this.cheio = false;
    this.contagem = { amostras: 0, condicoes: 0, eventos: 0, anotacoes: 0 };
    this.ultimoAlerta = null;
  }

  #gravarLinha(obj) {
    if (this.linhas.length >= this.maxLinhas) { this.cheio = true; this.ativo = false; return false; }
    this.linhas.push(JSON.stringify(obj));
    return true;
  }
  #rel(t) { return Math.round(t - this.t0); }

  iniciar({ t, modo, perfil, limiares, dispositivo = {}, demo = false }) {
    this.reiniciar();
    this.t0 = t;
    this.ativo = true;
    this.modo = modo;
    this.#gravarLinha({ tipo: 'cabecalho', formato: 'sentinela-campo/1', sistema: `SENTINELA SPY v${VERSAO}`,
      iniciado_em: new Date().toISOString(), modo, perfil, demo, limiares, dispositivo });
  }

  amostra(t, metricas) {
    if (!this.ativo || t < this.proximaAmostra) return false;
    /* Agenda pelo relógio IDEAL, não pelo instante da última amostra: a 30
       quadros/s, "≥ 100 ms desde a última" só dispara no 4º quadro (132 ms)
       e os 10 Hz viram 7,5 Hz — viés que o teste pegou. Se o laço atrasar
       mais de um período (aba em segundo plano), reancora em vez de disparar
       uma rajada de amostras atrasadas. */
    this.proximaAmostra = t - this.proximaAmostra > this.amostragemMs ? t + this.amostragemMs : this.proximaAmostra + this.amostragemMs;
    this.contagem.amostras++;
    return this.#gravarLinha({ tipo: 'amostra', t: this.#rel(t), m: compactar(this.modo, metricas) });
  }

  /** extra.pre_existente = alerta que já estava ativo quando a gravação começou. */
  condicao(t, c, fase, extra = {}) {
    if (!this.ativo) return false;
    this.contagem.condicoes++;
    if (fase === 'inicio') this.ultimoAlerta = { chave: c.chave, titulo: c.titulo, t };
    return this.#gravarLinha({ tipo: 'condicao', t: this.#rel(t), fase, chave: c.chave, grupo: c.grupo || null, nivel: c.nivel, titulo: c.titulo, ...extra });
  }

  evento(t, e) {
    if (!this.ativo) return false;
    this.contagem.eventos++;
    return this.#gravarLinha({ tipo: 'evento', t: this.#rel(t), chave: e.chave, nivel: e.nivel, titulo: e.titulo });
  }

  /** Anotação do operador. "verdadeiro"/"falso_alarme" se referem ao alerta mais recente. */
  anotacao(t, rotulo, nota = null) {
    if (!this.ativo || !ROTULOS_ANOTACAO[rotulo]) return null;
    this.contagem.anotacoes++;
    const ref = (rotulo === 'verdadeiro' || rotulo === 'falso_alarme') && this.ultimoAlerta
      ? { alvo: this.ultimoAlerta.chave, alvo_titulo: this.ultimoAlerta.titulo, alvo_ha_ms: Math.round(t - this.ultimoAlerta.t) }
      : {};
    this.#gravarLinha({ tipo: 'anotacao', t: this.#rel(t), rotulo, nota, ...ref });
    return { rotulo, ...ref };
  }

  parar(t) {
    if (this.t0 == null) return null;
    // a linha final entra mesmo com o teto atingido: a análise precisa saber que truncou
    this.linhas.push(JSON.stringify({ tipo: 'fim', t: this.#rel(t), truncado: this.cheio, contagem: this.contagem }));
    this.ativo = false;
    return this.exportar();
  }

  duracaoMs(t) { return this.t0 == null ? 0 : Math.max(0, t - this.t0); }
  exportar() { return this.linhas.join('\n') + '\n'; }
}
