/* ═══════════════════════════════════════════════════════════════════════
   ELION-X — o que o servidor de estáticos pode entregar

   LISTA DE PERMISSÃO, não de bloqueio. A primeira correção (bloquear
   segmento oculto, data/, node_modules/, bin/) fechou o GET /.env no
   Linux, mas a revisão de segurança mostrou que no Windows — onde o
   ELION-X roda de fato — o NTFS abre o mesmo arquivo por nomes que um
   filtro de texto não reconhece:
     · nome curto 8.3:      /ENV~1            → .env
                            /GIT~1/config     → .git/config
     · fluxo de diretório:  /data::$INDEX_ALLOCATION/google-token.json
   Lista de bloqueio sempre perde para a criatividade do sistema de
   arquivos. Então: só sai daqui o que a interface usa — oito arquivos
   da raiz e a árvore assets/ — e qualquer caminho com ":" ou "~" (que
   nenhum arquivo legítimo da plataforma tem) é recusado de saída.
   O servidor ainda confere o caminho REAL resolvido no disco
   (realpath), que pega link simbólico e qualquer apelido restante.
   ═══════════════════════════════════════════════════════════════════════ */

/** Arquivos da raiz que a interface carrega (levantado de todos os HTML/JS do cliente). */
export const PUBLICOS_RAIZ = new Set([
  'index.html', 'sentinela.html', 'cyber.html', 'brain.html', 'whatsapp.html',
  'manifest.webmanifest', 'sentinela.webmanifest', 'sw.js',
]);

const NEGADOS = /^(data|node_modules|bin)([\\/]|$)/i;

/** Segmentos do caminho, separando por "/" e por "\" (o Windows aceita os dois). */
const segmentos = rel => rel.split(/[\\/]/).filter(Boolean);

/** Caminho relativo que nunca pode ser servido, venha de onde vier. */
export function caminhoProibido(rel) {
  return /[:~\0]/.test(rel)                      // fluxo NTFS, nome curto 8.3, byte nulo
    || segmentos(rel).some(s => s.startsWith('.')) // .env, .git, .wwebjs_auth, e ".."
    || NEGADOS.test(rel);
}

/**
 * Classifica um caminho de URL JÁ DECODIFICADO (decodeURIComponent):
 *   'negado'      → responder 404
 *   'publico'     → pode servir (se existir)
 *   'desconhecido'→ não é da interface: o servidor responde como faria com
 *                   arquivo inexistente (página principal), sem revelar nada
 */
export function classificarCaminho(decodificado) {
  const rel = String(decodificado || '').replace(/^[\\/]+/, '');
  if (rel === '') return 'publico';                 // "/" → index.html
  if (caminhoProibido(rel)) return 'negado';
  if (PUBLICOS_RAIZ.has(rel.toLowerCase())) return 'publico';
  if (/^assets[\\/]/i.test(rel)) return 'publico';
  return 'desconhecido';
}
