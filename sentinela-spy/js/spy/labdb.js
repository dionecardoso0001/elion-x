/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA SPY — armazenamento do laboratório de modelo (IndexedDB)

   Conceitos (locais restritos e classes) com os vetores e as miniaturas das
   fotos ficam SÓ neste aparelho. Sem IndexedDB (modo privado), funciona em
   memória e a tela avisa que some ao fechar.
   ═══════════════════════════════════════════════════════════════════════ */
const BANCO = 'sentinela-spy-lab', LOJA = 'conceitos', VERSAO = 1;

const pedir = r => new Promise((ok, falha) => { r.onsuccess = () => ok(r.result); r.onerror = () => falha(r.error); });

export class BaseLab {
  constructor() { this.db = null; this.conceitos = []; this.persistente = false; }

  async abrir() {
    try {
      const req = indexedDB.open(BANCO, VERSAO);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(LOJA)) req.result.createObjectStore(LOJA, { keyPath: 'id' }); };
      this.db = await pedir(req);
      this.conceitos = await pedir(this.db.transaction(LOJA).objectStore(LOJA).getAll());
      this.conceitos.sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
      this.persistente = true;
    } catch { this.db = null; this.persistente = false; }
    return this.persistente;
  }

  async salvar(conceito) {
    const i = this.conceitos.findIndex(c => c.id === conceito.id);
    if (i >= 0) this.conceitos[i] = conceito; else this.conceitos.push(conceito);
    if (this.db) await pedir(this.db.transaction(LOJA, 'readwrite').objectStore(LOJA).put(conceito));
    return conceito;
  }

  async excluir(id) {
    this.conceitos = this.conceitos.filter(c => c.id !== id);
    if (this.db) await pedir(this.db.transaction(LOJA, 'readwrite').objectStore(LOJA).delete(id));
  }

  obter(id) { return this.conceitos.find(c => c.id === id) || null; }

  /** Há conceito do tipo com ao menos uma foto positiva? */
  temAtivo(tipo) { return this.conceitos.some(c => c.tipo === tipo && c.exemplos.some(e => e.rotulo === 'positivo')); }
}
