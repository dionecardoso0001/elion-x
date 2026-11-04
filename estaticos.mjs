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

/**
 * Cabeçalhos de segurança de tudo que a INTERFACE serve.
 * · frame-ancestors/X-Frame-Options: só a própria plataforma enquadra suas
 *   páginas (o visor da central). Sem isto, qualquer site aberto pelo
 *   operador podia enquadrar http://localhost:3001 — endereço previsível — e
 *   induzir cliques em botões que enviam WhatsApp ou leem e-mail (clickjacking).
 * · Permissions-Policy: câmera, microfone e GPS só para a própria origem,
 *   nunca para iframe de terceiro.
 */
export const CABECALHOS_SEGURANCA = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "frame-ancestors 'self'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(self)',
});

/**
 * Conteúdo de TERCEIRO servido na nossa origem pelo proxy do visor.
 * A remoção de <script> por regex não basta: manipulador de evento
 * (<img src=x onerror=…>) passa direto e <scr<script></script>ipt> se
 * remonta depois da remoção. Servido na MESMA origem, esse script alcançaria
 * /api/memory, /api/email e o envio de WhatsApp. O sandbox sem allow-scripts
 * impede qualquer script; sem allow-same-origin o documento ganha origem
 * OPACA — mesmo que algo rodasse, não seria "da casa".
 */
export const CABECALHOS_TERCEIRO = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox allow-popups allow-popups-to-escape-sandbox allow-forms; script-src 'none'; object-src 'none'",
});

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
