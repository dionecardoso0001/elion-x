/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA SPY — registro de incidentes

   Persistente NESTE aparelho (IndexedDB): sobrevive a recarga e a queda
   de energia, nunca sai do aparelho sem ordem do operador (exportação).
   Cada incidente guarda o alerta dos detectores locais e, quando houver,
   o parecer do agente. Sem IndexedDB (aba privada, armazenamento
   bloqueado), funciona só em memória e avisa.
   ═══════════════════════════════════════════════════════════════════════ */
const NOME_BD = 'sentinela-spy';
const LOJA = 'incidentes';

const prometer = req => new Promise((ok, falha) => { req.onsuccess = () => ok(req.result); req.onerror = () => falha(req.error); });

export class RegistroIncidentes {
  constructor({ limite = 3000, indexedDB: idb = globalThis.indexedDB } = {}) {
    this.limite = limite;
    this.idb = idb;
    this.bd = null;
    this.itens = [];          // mais antigo → mais recente
    this.persistente = false;
    this.ouvintes = new Set();
  }

  /** Abre o banco e carrega o histórico. Devolve se ficou persistente. */
  async abrir() {
    if (!this.idb) return false;
    try {
      const req = this.idb.open(NOME_BD, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(LOJA, { keyPath: 'id' });
        s.createIndex('em', 'em');
      };
      this.bd = await prometer(req);
      const todos = await prometer(this.bd.transaction(LOJA).objectStore(LOJA).getAll());
      this.itens = todos.sort((a, b) => a.em - b.em);
      this.persistente = true;
      return true;
    } catch { this.bd = null; return false; }
  }

  #gravar(item) {
    if (!this.bd) return;
    try { this.bd.transaction(LOJA, 'readwrite').objectStore(LOJA).put(item); } catch { /* cota cheia: segue em memória */ }
  }

  #avisar() { this.ouvintes.forEach(f => { try { f(this); } catch { /* ouvinte com defeito não derruba o registro */ } }); }
  aoMudar(f) { this.ouvintes.add(f); return () => this.ouvintes.delete(f); }

  /** Registra um incidente novo e devolve-o (com id). */
  registrar({ em = Date.now(), modo, chave, nivel, titulo, detalhe = null, alvo = null, foto = null }) {
    const id = `${em.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const item = { id, em, modo, chave, nivel, titulo, detalhe, alvo, foto, parecer: null };
    this.itens.push(item);
    this.#gravar(item);
    while (this.itens.length > this.limite) {
      const velho = this.itens.shift();
      if (this.bd) try { this.bd.transaction(LOJA, 'readwrite').objectStore(LOJA).delete(velho.id); } catch { /* idem */ }
    }
    this.#avisar();
    return item;
  }

  /** Anexa o parecer do agente a um incidente. */
  anexarParecer(id, parecer) {
    const item = this.itens.find(i => i.id === id);
    if (!item) return null;
    item.parecer = parecer;
    this.#gravar(item);
    this.#avisar();
    return item;
  }

  /** Consulta para a tela e para a ferramenta do agente (mais recente primeiro). */
  listar({ minutos = 60, limite = 20, nivel = 'todos', agora = Date.now() } = {}) {
    const desde = agora - Math.max(1, Math.min(1440, minutos)) * 60000;
    const out = [];
    for (let i = this.itens.length - 1; i >= 0 && out.length < Math.max(1, Math.min(50, limite)); i--) {
      const x = this.itens[i];
      if (x.em < desde) break;
      if (nivel !== 'todos' && x.nivel !== nivel) continue;
      out.push(x);
    }
    return out;
  }

  /** Forma compacta e sem imagem — o que vai para o agente. */
  static resumo(x) {
    return {
      id: x.id, hora: new Date(x.em).toTimeString().slice(0, 8), missao: x.modo, nivel: x.nivel,
      titulo: x.titulo, detalhe: x.detalhe, alvo: x.alvo,
      parecer_do_agente: x.parecer ? { veredito: x.parecer.veredito, risco: x.parecer.nivel_risco, resumo: x.parecer.resumo } : null,
    };
  }

  exportar() {
    return JSON.stringify({
      formato: 'sentinela-spy-incidentes/1', exportado_em: new Date().toISOString(),
      incidentes: this.itens.map(x => ({ ...x, em: new Date(x.em).toISOString() })),
    }, null, 2);
  }

  async limpar() {
    this.itens = [];
    if (this.bd) { try { await prometer(this.bd.transaction(LOJA, 'readwrite').objectStore(LOJA).clear()); } catch { /* idem */ } }
    this.#avisar();
  }
}
