/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA SPY — escuta da fala do motorista (Web Speech API)

   Reconhecimento de fala do PRÓPRIO navegador (SpeechRecognition): Chrome e
   Edge no Android e no PC, Safari no iPhone. Firefox não tem — sobram os
   botões grandes da tela.

   Privacidade (declarado na tela): no Chrome, o reconhecimento costuma ser
   feito nos servidores do Google — o áudio sai do aparelho só durante a
   pergunta da checagem, nunca em escuta contínua.

   Nunca ouve enquanto a plataforma FALA: a síntese de voz seria transcrita
   como se fosse o motorista. Quem chama espera a fala terminar.
   ═══════════════════════════════════════════════════════════════════════ */

const Reconhecedor = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;

export const escutaDisponivel = () => !!Reconhecedor();

/**
 * Ouve uma resposta curta. Resolve com { texto, confianca, alternativas } ou
 * null (silêncio, erro, sem suporte, tempo esgotado). Nunca rejeita.
 */
export function ouvir({ ms = 8000, idioma = 'pt-BR', sinal = null } = {}) {
  const R = Reconhecedor();
  if (!R || sinal?.aborted) return Promise.resolve(null);
  return new Promise(resolver => {
    let fim = false;
    const terminar = v => { if (fim) return; fim = true; clearTimeout(prazo); try { rec.abort(); } catch {} resolver(v); };
    let rec;
    try {
      rec = new R();
      rec.lang = idioma;
      rec.interimResults = false;
      rec.continuous = false;
      rec.maxAlternatives = 3;
    } catch { resolver(null); return; }
    const prazo = setTimeout(() => terminar(null), ms);
    // interrompida (botão, fechar): para de ouvir NA HORA — senão a escuta aberta
    // capturaria a fala seguinte, já fora desta pergunta (visto no teste E2E)
    sinal?.addEventListener?.('abort', () => terminar(null), { once: true });
    rec.onresult = ev => {
      const res = ev.results?.[0];
      if (!res) return terminar(null);
      const alternativas = Array.from(res, a => a.transcript).filter(Boolean);
      terminar(alternativas.length ? { texto: alternativas[0], confianca: res[0]?.confidence ?? null, alternativas } : null);
    };
    rec.onerror = () => terminar(null);
    rec.onend = () => terminar(null);
    try { rec.start(); } catch { terminar(null); }
  });
}

/**
 * Pede a permissão do microfone ANTES da emergência (o diálogo do navegador no
 * meio de uma checagem seria pior que inútil). Abre e fecha o microfone na hora.
 */
export async function liberarMicrofone() {
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, erro: 'este navegador não dá acesso ao microfone' };
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    s.getTracks().forEach(t => t.stop());
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e?.name === 'NotAllowedError' ? 'permissão do microfone negada — libere no cadeado ao lado do endereço' : (e?.message || 'falhou') };
  }
}
