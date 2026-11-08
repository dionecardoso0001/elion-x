// Ponto de entrada da versão autônoma (arquivo HTML único, abre com duplo clique, sem servidor).
import { createLocalBackend } from './local/backend.mjs';

globalThis.__SENTINEL_LOCAL__ = createLocalBackend();
import('./main.mjs'); // carregado depois do backend local estar disponível
