/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA SPY — câmeras do aparelho (ESM puro: sem DOM no import)

   O navegador só revela o NOME de cada câmera depois que a página recebe
   permissão de vídeo; antes disso enumerateDevices() devolve rótulo vazio
   (e, no Safari e no Firefox, às vezes deviceId vazio também). Por isso
   a lista é refeita depois que a câmera abre e a cada "devicechange" —
   a webcam USB plugada com a operação em curso aparece sem recarregar.

   Funções puras aqui, testadas em Node; o orquestrador cuida do DOM.
   ═══════════════════════════════════════════════════════════════════════ */

/** O Chrome no Windows anexa "(VID:PID)" do USB ao nome: "MX Brio (046d:0944)". */
const SUFIXO_USB = /\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i;

/** Nome legível de uma câmera; sem rótulo (antes da permissão), "Câmera N". */
export function nomeCamera(cam, indice = 0) {
  const r = String(cam?.label || '').replace(SUFIXO_USB, '').trim();
  return r || `Câmera ${indice + 1}`;
}

/** Só entram câmeras SELECIONÁVEIS: sem deviceId não há como pedir aquela câmera. */
export const selecionaveis = cams => (cams || []).filter(c => c && c.kind === 'videoinput' && c.deviceId);

/** O navegador já revelou os nomes? (depende da permissão de câmera) */
export const nomesLiberados = cams => (cams || []).some(c => c && c.label);

/**
 * Opções do seletor. A primeira é a escolha automática (câmera padrão da
 * missão) e diz QUAL câmera está ativa — "padrão do modo" sozinho dava a
 * impressão de que só existia uma opção.
 */
export function opcoesCameras(cams, { ativaId = null, escolhidaId = null } = {}) {
  const lista = selecionaveis(cams);
  const iAtiva = lista.findIndex(c => c.deviceId === ativaId);
  // o nome na opção automática só vale quando é ELA que está valendo
  const nomeAtiva = !escolhidaId && iAtiva >= 0 ? nomeCamera(lista[iAtiva], iAtiva) : null;
  return [
    { valor: '', texto: nomeAtiva ? `automática — ${nomeAtiva}` : 'automática (padrão da missão)' },
    ...lista.map((c, i) => ({ valor: c.deviceId, texto: `${nomeCamera(c, i)}${c.deviceId === ativaId ? ' ● em uso' : ''}` })),
  ];
}

/** Frase de estado: quantas câmeras e quais. */
export function resumoCameras(cams) {
  const lista = selecionaveis(cams);
  const n = lista.length || (cams || []).filter(c => c?.kind === 'videoinput').length;
  if (!n) return 'Nenhuma câmera detectada. Confira o cabo USB e as permissões do navegador.';
  if (!nomesLiberados(cams)) return `${n} câmera(s) detectada(s) — os nomes aparecem depois que a câmera for liberada.`;
  return `${n} câmera(s) detectada(s): ${lista.map(nomeCamera).join(' · ')}`;
}

/** O que mudou entre duas enumerações (câmera plugada ou removida). */
export function diferencaCameras(antes, depois) {
  const chave = c => c.deviceId || `rotulo:${c.label}`;
  const a = new Map(selecionaveis(antes).map(c => [chave(c), c]));
  const d = new Map(selecionaveis(depois).map(c => [chave(c), c]));
  return {
    entraram: [...d.entries()].filter(([k]) => !a.has(k)).map(([, c]) => c),
    sairam: [...a.entries()].filter(([k]) => !d.has(k)).map(([, c]) => c),
  };
}

/** Próxima câmera da lista, em ciclo (botão de troca no PC, onde não há frontal/traseira). */
export function proximaCamera(cams, atualId) {
  const lista = selecionaveis(cams);
  if (lista.length < 2) return null;
  const i = lista.findIndex(c => c.deviceId === atualId);
  return lista[(i + 1) % lista.length].deviceId;
}

/** Erro de getUserMedia → instrução que o operador consegue seguir. */
export function explicarErroCamera(erro, nome = '') {
  const qual = nome ? `A câmera "${nome}"` : 'A câmera';
  switch (erro?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Permissão de câmera negada. Libere a câmera para este endereço nas configurações do navegador (ícone de cadeado ao lado do endereço) e tente de novo.';
    case 'NotReadableError':
    case 'TrackStartError':
      return `${qual} está em uso por outro programa (Teams, Zoom, OBS, Logi Tune ou outra aba). Feche o programa e escolha a câmera de novo.`;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Nenhuma câmera encontrada. Confira o cabo USB e se a câmera aparece no Gerenciador de Dispositivos do Windows.';
    case 'OverconstrainedError':
      return `${qual} não está mais disponível (desconectada?). Escolha outra na lista.`;
    case 'AbortError':
      return `${qual} não iniciou (o sistema abortou). Desconecte e reconecte o cabo, ou reinicie o navegador.`;
    default:
      return `${qual} não abriu: ${erro?.message || erro}`;
  }
}
