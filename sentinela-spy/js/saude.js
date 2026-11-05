/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA SPY — checagem de saúde do motorista (ESM puro, sem DOM)

   Fluxo (máquina de estados; quem fala, ouve e envia é o orquestrador):

     gatilho (mão no peito, mão nos olhos ≥ 3 s, cabeça tombada, fora de visão)
       → PERGUNTA por voz: "Você está bem? Responda: estou bem, ou preciso de ajuda."
       → OUVE ~8 s (reconhecimento de fala) — ou o toque num dos dois botões grandes
           · "estou bem"                  → encerra (o mesmo gatilho só volta em 3 min)
           · "preciso de ajuda", sintoma  → AVISA O RESPONSÁVEL na hora
           · silêncio ou resposta confusa → pergunta de novo, mais firme
           · silêncio de novo             → AVISA O RESPONSÁVEL ("sem resposta")

   Silêncio escala de propósito: quem desmaia ou tem um AVC não confirma nada.
   É o cenário mais grave e o pedido original ("caso ele confirme") não o
   cobria. A decisão de escalar é DETERMINÍSTICA e local — não depende do
   agente de IA nem de rede para decidir; a IA entra depois, para conversar e
   colher sintomas.

   Isto é TRIAGEM por sinais observáveis, não diagnóstico. A mensagem ao
   responsável diz isso.
   ═══════════════════════════════════════════════════════════════════════ */

export const CFG_SAUDE = {
  ouvirMs: 8000,                  // janela de resposta por pergunta
  tentativas: 2,                  // perguntas antes de considerar SEM RESPOSTA (≈ 20 s no total)
  escalarSemResposta: true,
  pausaAposBemMs: 180000,         // "estou bem": o MESMO gatilho só pergunta de novo após 3 min
};

export const MOTIVOS = {
  mao_peito: { titulo: 'mão no peito', aviso: 'Notei sua mão no peito.' },
  mao_olhos: { titulo: 'mão nos olhos por mais de 3 segundos', aviso: 'Notei sua mão nos olhos por alguns segundos.' },
  mal_subito: { titulo: 'cabeça tombada e imóvel', aviso: 'Notei sua cabeça tombada.' },
  ausente: { titulo: 'rosto fora da visão da câmera', aviso: 'Não estou vendo o seu rosto.' },
  manual: { titulo: 'pedido de ajuda do motorista', aviso: '' },
};

/** minúsculas, sem acento e sem pontuação (a vírgula vira separador próprio: "não, tô bem" ≠ "não tô bem"). */
export function normalizar(texto) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[,;]/g, ' , ').replace(/[^a-z0-9, ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const MAL = [
  /\b(nao|num) (estou|to|tou|esta|ta|me sinto|sinto) (bem|legal|bom)\b/,
  /\b(passando|sentindo|estou|to|tou|me sinto|muito|bem) mal\b/,
  /\b(socorro|ajuda|ajude|ajudar|emergencia|samu|ambulancia|hospital|medico)\b/,
  /\b(dor|doendo|doi|aperto|apertado|pressao|queimacao|falta de ar|sem ar|respirar|tontura|tonto|tonta|zonzo|zonza|desmai\w*|enjoo|enjoad\w*|vomit\w*|formig\w*|dorment\w*|embac\w*|confus\w*|infarto|enfarte|avc|derrame|fraqueza|fraco|fraca|suor frio|suando|palpitac\w*|coracao|peito|paralis\w*|nao sinto)\b/,
];
const BEM = [
  /\b(estou|to|tou|ta|esta|me sinto|tudo|ja estou|ja to) (bem|otimo|otima|tranquilo|tranquila|certo|ok|joia|beleza|normal)\b/,
  /^(sim|s|ok|okay|beleza|tranquilo|positivo|bem|tudo bem|tudo certo|estou bem|to bem|ta tudo bem|nada|foi nada|nao foi nada)$/,
  /\b(foi so|era so|so (uma |um )?)(coceira|cisco|cansaco|o cinto|ajeitando|arrumando|cocando)\b/,
  /\bnao foi nada\b/,
];
const NAO_SECO = /^(nao|n|negativo|nao nao)$/;

/**
 * Resposta à pergunta "Você está bem?" → 'mal' | 'bem' | 'incerto'.
 * Sinal de mal-estar tem PRECEDÊNCIA ("sim, estou com dor no peito" é mal).
 * Na dúvida entre "não tô bem" e "não, tô bem" sem pontuação, o reconhecedor
 * de fala não separa as duas — vale a leitura que protege: mal.
 */
export function interpretarResposta(texto) {
  const n = normalizar(texto);
  if (!n) return 'incerto';
  if (NAO_SECO.test(n)) return 'mal';
  // "não, tô bem": a vírgula separa a negação da afirmação
  if (/^(nao|n) , /.test(n) && BEM.some(r => r.test(n.replace(/^(nao|n) , /, '')))) return 'bem';
  if (MAL.some(r => r.test(n))) return 'mal';
  if (BEM.some(r => r.test(n))) return 'bem';
  return 'incerto';
}

/** Texto da pergunta conforme o motivo e a tentativa (a segunda é mais curta e firme). */
export function pergunta(motivo, tentativa) {
  if (tentativa > 1) return 'Motorista, você está me ouvindo? Responda: estou bem, ou, preciso de ajuda.';
  const m = MOTIVOS[motivo] || MOTIVOS.manual;
  return `${m.aviso} Você está bem? Responda: estou bem, ou, preciso de ajuda.`.trim();
}

export const FALAS = {
  bem: 'Entendido. Se sentir qualquer coisa, diga: preciso de ajuda.',
  escalando: 'Entendido. Estou avisando o seu responsável agora. Ligue o pisca-alerta e pare em local seguro, se puder. Em emergência, ligue 192.',
  semResposta: 'Você não respondeu. Estou avisando o seu responsável agora.',
  bemDepois: 'Certo. Vou avisar o seu responsável que você está bem.',
};

/**
 * Máquina de estados da checagem. Cada método devolve AÇÕES para o orquestrador:
 *   { tipo: 'mostrar' } · { tipo: 'falar', texto } · { tipo: 'ouvir', ms }
 *   { tipo: 'escalar', motivo, resposta, semResposta } · { tipo: 'atualizar', texto }
 *   { tipo: 'conversar' } (passa a palavra ao agente de IA) · { tipo: 'fechar' }
 */
export class ChecagemSaude {
  constructor(cfg = {}) {
    this.cfg = { ...CFG_SAUDE, ...cfg };
    this.pausas = new Map();   // motivo → instante até quando não pergunta de novo
    this.#zerar();
  }

  #zerar() {
    this.estado = 'ocioso';    // ocioso | perguntando | escalado
    this.motivo = null; this.tentativa = 0; this.inicio = null; this.escaladoEm = null;
    this.respostas = [];
  }

  get ativa() { return this.estado !== 'ocioso'; }

  /** Novo gatilho. Ignorado se já há checagem em curso ou se o motorista disse "estou bem" a este motivo há pouco. */
  iniciar(motivo, t) {
    if (this.ativa) return [];
    if (motivo !== 'manual' && (this.pausas.get(motivo) ?? -Infinity) > t) return [];
    this.estado = 'perguntando'; this.motivo = motivo; this.tentativa = 1; this.inicio = t; this.respostas = [];
    if (motivo === 'manual') return this.#escalar(t, { resposta: 'pedido de ajuda pelo botão', semResposta: false });
    return [{ tipo: 'mostrar' }, { tipo: 'falar', texto: pergunta(motivo, 1) }, { tipo: 'ouvir', ms: this.cfg.ouvirMs }];
  }

  /** Fala reconhecida (texto) — ou null/'' quando a janela de escuta terminou em silêncio. */
  aoOuvir(texto, t) {
    if (this.estado === 'ocioso') return [];
    const limpo = String(texto || '').trim();
    if (limpo) this.respostas.push({ t, texto: limpo });
    if (this.estado === 'escalado') {
      // depois do aviso, a conversa segue com o agente; "estou bem" vira atualização ao responsável
      if (limpo && interpretarResposta(limpo) === 'bem') return [{ tipo: 'falar', texto: FALAS.bemDepois }, { tipo: 'atualizar', texto: `Motorista respondeu: "${limpo}" (informa que está bem).` }, { tipo: 'fechar' }];
      return limpo ? [{ tipo: 'conversar', texto: limpo }] : [];
    }
    const leitura = limpo ? interpretarResposta(limpo) : 'silencio';
    if (leitura === 'bem') return this.#bem(t);
    if (leitura === 'mal') return this.#escalar(t, { resposta: limpo, semResposta: false });
    // silêncio ou resposta incerta: repete uma vez; depois escala
    if (this.tentativa < this.cfg.tentativas) {
      this.tentativa++;
      return [{ tipo: 'falar', texto: pergunta(this.motivo, this.tentativa) }, { tipo: 'ouvir', ms: this.cfg.ouvirMs }];
    }
    if (leitura === 'silencio' && !this.cfg.escalarSemResposta) { const m = this.motivo; this.#zerar(); return [{ tipo: 'fechar', motivo: m, semResposta: true }]; }
    return this.#escalar(t, leitura === 'silencio'
      ? { resposta: null, semResposta: true }
      : { resposta: `resposta não compreendida: "${this.respostas.map(r => r.texto).join(' / ')}"`, semResposta: false });
  }

  /** Botões grandes da tela (quando o veículo está parado ou para quem está junto). */
  aoBotao(tipo, t) {
    if (tipo === 'ajuda') {
      if (this.estado === 'ocioso') return this.iniciar('manual', t);
      if (this.estado === 'escalado') return [];
      return this.#escalar(t, { resposta: 'pediu ajuda pelo botão', semResposta: false });
    }
    if (this.estado === 'escalado') return [{ tipo: 'falar', texto: FALAS.bemDepois }, { tipo: 'atualizar', texto: 'Motorista informou pelo botão que está bem.' }, { tipo: 'fechar' }];
    if (this.estado === 'perguntando') return this.#bem(t);
    return [];
  }

  /** Encerra (o orquestrador chama depois de executar a ação 'fechar'). */
  encerrar() { this.#zerar(); }

  #bem(t) {
    this.pausas.set(this.motivo, t + this.cfg.pausaAposBemMs);
    this.estado = 'ocioso';
    const motivo = this.motivo;
    this.#zerar();
    return [{ tipo: 'falar', texto: FALAS.bem }, { tipo: 'fechar', motivo, bem: true }];
  }

  #escalar(t, { resposta, semResposta }) {
    this.estado = 'escalado'; this.escaladoEm = t;
    return [
      { tipo: 'mostrar' },
      { tipo: 'escalar', motivo: this.motivo, resposta, semResposta },
      { tipo: 'falar', texto: semResposta ? FALAS.semResposta : FALAS.escalando },
      { tipo: 'conversar', texto: resposta || null },
    ];
  }
}

/**
 * Conteúdo do alerta ao responsável (o relé formata para WhatsApp e e-mail).
 * Sem imagem do rosto: dado de saúde é dado sensível (LGPD, art. 11) — vai o
 * mínimo para socorrer: quem, o quê, onde, quando.
 */
export function montarAlerta({ motivo, resposta = null, semResposta = false, motorista = '', veiculo = '', local = null, velocidadeKmh = null, quando = new Date(), atualizacao = null }) {
  const m = MOTIVOS[motivo] || MOTIVOS.manual;
  const hora = quando.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
  const mapa = local && isFinite(local.lat) && isFinite(local.lng) ? `https://maps.google.com/?q=${local.lat.toFixed(6)},${local.lng.toFixed(6)}` : null;
  const situacao = atualizacao || (semResposta
    ? `${m.titulo} e o motorista NÃO RESPONDEU à checagem por voz`
    : motivo === 'manual' ? 'o motorista pediu ajuda pelo botão do aplicativo'
    : `${m.titulo}; motorista: ${resposta || 'pediu ajuda'}`);
  return {
    tipo: atualizacao ? 'atualizacao' : 'alerta_saude',
    gravidade: semResposta ? 'critica' : 'alta',
    motorista: motorista || 'não informado', veiculo: veiculo || 'não informado',
    situacao, quando: hora,
    local: mapa ? { lat: local.lat, lng: local.lng, precisaoM: local.precisao ?? null, mapa } : null,
    velocidadeKmh: velocidadeKmh != null && isFinite(velocidadeKmh) ? Math.round(velocidadeKmh) : null,
    aviso: 'Alerta automático de triagem por sinais observáveis — não é diagnóstico. Em emergência, SAMU 192.',
  };
}
