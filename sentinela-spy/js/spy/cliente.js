/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA SPY — transporte do agente

   Dois modos, o MESMO pedido (montado por cerebro.js) e o MESMO SDK oficial
   da Anthropic:
   · servidor  — a instalação tem servidor próprio (npm start) com a chave em
                 variável de ambiente. O navegador nunca vê a chave; o servidor
                 monta o pedido (modelo, prompt, ferramentas) — o cliente só
                 manda a tarefa e as mensagens.
   · navegador — hospedagem estática (GitHub Pages). O operador informa a
                 PRÓPRIA chave; ela vai só para api.anthropic.com. Por padrão
                 fica só na memória desta aba; "lembrar" grava neste aparelho.
   ═══════════════════════════════════════════════════════════════════════ */
import { montarPedido, recursoRecusado } from './cerebro.js';

/** O servidor desta instalação oferece o agente? (404 em hospedagem estática) */
export async function detectarServidor(base = 'api/spy/') {
  try {
    const r = await fetch(`${base}estado`, { cache: 'no-store' });
    if (!r.ok) return { disponivel: false };
    const j = await r.json();
    return { disponivel: !!j.disponivel, exigeToken: !!j.exige_token, modelo: j.modelo || null };
  } catch { return { disponivel: false }; }
}

function erroCom(msg, extra = {}) { return Object.assign(new Error(msg), extra); }

export class ClienteAgente {
  constructor({ modo = 'navegador', chave = '', token = '', base = 'api/spy/' } = {}) {
    this.modo = modo; this.chave = chave; this.token = token; this.base = base;
    this.sdk = null; this.Anthropic = null;
    this.compat = {};               // recursos opcionais que a API recusou nesta conta
    this.aoAjuste = () => {};       // avisa a interface quando o pedido se adapta
  }

  get pronto() { return this.modo === 'servidor' || !!this.chave; }

  configurar({ modo, chave, token }) {
    if (modo !== undefined) this.modo = modo;
    if (chave !== undefined && chave !== this.chave) { this.chave = chave; this.sdk = null; }
    if (token !== undefined) this.token = token;
  }

  /** Envia uma tarefa e devolve a Message da API. */
  async enviar(tipo, messages, { signal } = {}) {
    return this.modo === 'servidor' ? this.#viaServidor(tipo, messages, signal) : this.#viaNavegador(tipo, messages, signal);
  }

  async #viaServidor(tipo, messages, signal) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const r = await fetch(`${this.base}mensagens`, { method: 'POST', headers, body: JSON.stringify({ tipo, messages }), signal });
    let j = null;
    try { j = await r.json(); } catch { /* corpo não-JSON */ }
    if (!r.ok) throw erroCom(j?.erro || `servidor respondeu HTTP ${r.status}`, { status: r.status, tentarEmS: j?.tentar_em_s ?? null });
    return j;
  }

  async #viaNavegador(tipo, messages, signal) {
    if (!this.chave) throw erroCom('Informe a chave da API nas configurações do agente.', { status: 401 });
    if (!this.sdk) {
      const mod = await import('../../vendor/anthropic-sdk.mjs');
      this.Anthropic = mod.default;
      // dangerouslyAllowBrowser: a chave é do próprio operador, no aparelho dele (ver README → Segurança)
      this.sdk = new this.Anthropic({ apiKey: this.chave, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 120_000 });
    }
    // recurso opcional recusado (400): adapta UMA vez por recurso e repete
    for (;;) {
      try {
        return await this.sdk.beta.messages.create(montarPedido(tipo, messages, { compat: this.compat }), { signal });
      } catch (e) {
        const recurso = e instanceof this.Anthropic.BadRequestError ? recursoRecusado(e.message) : null;
        if (recurso && this.compat[recurso] !== false && !signal?.aborted) {
          this.compat[recurso] = false;
          this.aoAjuste(recurso, e.message);
          continue;
        }
        throw traduzirErro(e, this.Anthropic);
      }
    }
  }
}

/** Erros tipados do SDK → mensagem acionável para o operador (mais específico primeiro). */
export function traduzirErro(e, A) {
  if (!A || !(e instanceof A.APIError)) return e;
  if (e instanceof A.AuthenticationError) return erroCom('Chave da API recusada (401). Confira a chave nas configurações.', { status: 401 });
  if (e instanceof A.PermissionDeniedError) return erroCom('A chave não tem permissão para este modelo (403).', { status: 403 });
  if (e instanceof A.RateLimitError) return erroCom('Limite de uso da API atingido (429). O agente volta sozinho em instantes.', { status: 429 });
  if (e instanceof A.BadRequestError) return erroCom(`Pedido recusado pela API (400): ${e.message}`, { status: 400 });
  return erroCom(`API da Anthropic indisponível (${e.status ?? 'rede'}): ${e.message}`, { status: e.status ?? 0 });
}
