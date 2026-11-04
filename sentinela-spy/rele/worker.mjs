/* SENTINELA SPY — relé de notificação como Cloudflare Worker (grátis, 24 h, sem PC ligado).
   A lógica inteira está em ../notificacao.mjs (a mesma do servidor próprio);
   aqui só a ligação com o ambiente do Worker. Implantação: ver ../ALERTAS.md. */
import { criarRele } from '../notificacao.mjs';

let rele = null;
export default {
  async fetch(request, env) {
    rele ??= criarRele({ env });
    return rele.tratar(request);
  },
};
