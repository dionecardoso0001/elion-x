/**
 * PERSISTÊNCIA — arquivo JSON com escrita atômica e fila serializada.
 *
 * Suficiente para validar o negócio (centenas de pedidos/dia, 1 instância).
 * Ao escalar para várias instâncias, troque por PostgreSQL mantendo esta
 * mesma interface (get / list / insert / update) — o resto do código não muda.
 *
 * - Escrita atômica: grava em .tmp e renomeia. Queda no meio da escrita não
 *   corrompe o arquivo.
 * - Fila: cada alteração espera a anterior terminar, então dois webhooks
 *   simultâneos não sobrescrevem um ao outro.
 */
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function createStore(file) {
  let data = { orders: {} };
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
    data.orders ||= {};
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    await mkdir(dirname(file), { recursive: true });
  }

  let chain = Promise.resolve();
  const persist = async () => {
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
    await rename(tmp, file);
  };

  /** Executa fn(data) em série e persiste. Devolve o retorno de fn. */
  const mutate = fn => {
    const run = chain.then(async () => {
      const r = await fn(data);
      await persist();
      return r;
    });
    chain = run.catch(() => {});
    return run;
  };

  const clone = o => (o ? structuredClone(o) : null);

  return {
    get: id => clone(data.orders[id]),
    list: () => Object.values(data.orders).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(clone),
    insert: order => mutate(d => { d.orders[order.id] = order; return clone(order); }),
    /** fn recebe o pedido e o altera no lugar; retorna null se não existir. */
    update: (id, fn) => mutate(d => {
      const o = d.orders[id];
      if (!o) return null;
      fn(o);
      o.updatedAt = new Date().toISOString();
      return clone(o);
    }),
  };
}
