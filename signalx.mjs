/* ═══════════════════════════════════════════════════════════════════════════
   SIGNAL-X — inteligência de radiofrequência para o ELION-X

   Ponte para a plataforma SIGNAL-X, que consulta a base pública de
   licenciamento de estações da ANATEL (Mosaico / Spectrum-E) e devolve as
   antenas 2G/3G/4G/5G das operadoras num raio ou num município.

   O ELION-X não fala com a ANATEL: fala com o SIGNAL-X. A razão é que a
   consulta da ANATEL tem três armadilhas que devolvem "zero resultados" em vez
   de erro — sessão obrigatória, teto de 250 linhas por resposta e município por
   código IBGE. Todas moram no SIGNAL-X, tratadas. Aqui só consumimos.

   Sobe o SIGNAL-X com `npm run dev` em C:\SIGNAL-X (porta 4477).
   ═══════════════════════════════════════════════════════════════════════════ */

import { spawn } from 'child_process';
import net from 'net';

export const BASE = (process.env.SIGNALX_URL || 'http://localhost:4477').replace(/\/+$/, '');

/** Onde mora o projeto, para o ELION conseguir subi-lo sozinho. */
const DIR = process.env.SIGNALX_DIR || 'C:\\SIGNAL-X';

/** Varreduras de município levam dezenas de segundos: são várias páginas na ANATEL. */
const TIMEOUT_MS = 120_000;

/* ═══════════════════════════════════════════════════════════════════════════
   AUTOPARTIDA

   O SIGNAL-X é um serviço separado. Exigir que o operador lembre de abrir um
   segundo terminal antes de falar com o ELION é transferir a ele um problema
   que é nosso: quando esquecia, o console NASA abria com um quadro cinza
   quebrado e o rastreio ficava preso em "varrendo…" para sempre.

   Então o ELION sobe o serviço por conta própria e só então varre.
   ═══════════════════════════════════════════════════════════════════════════ */

let subindo = null;

async function estaNoAr() {
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

const PORTA = Number(new URL(BASE).port || 80);

/**
 * A porta já está sendo escutada?
 *
 * Distingue "ninguém subiu" de "está subindo": o Next liga a porta e só depois
 * compila a primeira rota. Sem esta checagem, um serviço no meio da partida
 * pareceria ausente e ganharia um segundo `npm run dev` na mesma porta — as
 * duas instâncias brigam e nenhuma termina de subir.
 */
function portaOcupada() {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port: PORTA });
    const fim = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(1200);
    s.on('connect', () => fim(true));
    s.on('error', () => fim(false));
    s.on('timeout', () => fim(false));
  });
}

function lancar() {
  /* Comando como string única: com `shell: true` e um array de argumentos o Node
     emite DEP0190, porque os argumentos entram concatenados no shell sem escape.
     Aqui não há entrada do usuário no comando — mas a forma correta é a string. */
  const p = spawn('npm run dev', {
    cwd: DIR,
    detached: true,   // sobrevive a um restart do ELION
    stdio: 'ignore',  // o log do Next não polui o console do ELION
    shell: true,      // no Windows `npm` é um .cmd
    windowsHide: true,
  });
  p.unref();
  return p;
}

/**
 * Garante o SIGNAL-X no ar. Devolve como ele ficou disponível, para o agente
 * poder contar ao operador o que aconteceu.
 */
export async function garantirNoAr(aviso) {
  if (await estaNoAr()) return { estado: 'ja-estava' };

  // Duas varreduras simultâneas não podem disparar dois servidores na mesma porta.
  if (!subindo) {
    subindo = (async () => {
      const jaSubindo = await portaOcupada();

      if (!jaSubindo) {
        aviso?.('SIGNAL-X fora do ar — iniciando o serviço…');
        try {
          lancar();
        } catch (e) {
          throw new Error(`Não consegui iniciar o SIGNAL-X em ${DIR}: ${e.message}. Rode "npm run dev" nessa pasta.`);
        }
      } else {
        aviso?.('SIGNAL-X está subindo — aguardando ficar pronto…');
      }

      /* Partida fria medida nesta máquina: ~29 s para o Next subir e mais ~20 s
         para compilar a primeira rota. Damos folga de sobra: estourar o prazo de
         um serviço que ia funcionar é pior do que esperar mais um pouco. */
      const limite = Date.now() + 180_000;
      let ultimoAviso = 0;

      while (Date.now() < limite) {
        await new Promise((r) => setTimeout(r, 2000));
        if (await estaNoAr()) return { estado: jaSubindo ? 'ja-subia' : 'iniciado' };

        const s = Math.round((Date.now() - (limite - 180_000)) / 1000);
        if (s - ultimoAviso >= 15) {
          ultimoAviso = s;
          aviso?.(`compilando o SIGNAL-X… ${s}s (primeira partida é lenta)`);
        }
      }

      throw new Error(
        `O SIGNAL-X não respondeu em 3 minutos (pasta ${DIR}). ` +
          'Abra essa pasta e rode "npm install" seguido de "npm run dev" para ver o erro real.',
      );
    })().finally(() => { subindo = null; });
  }

  return subindo;
}

async function pedir(caminho) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${BASE}${caminho}`, { signal: ctrl.signal });
    const dados = await r.json().catch(() => null);
    if (!r.ok) {
      throw new Error(dados?.detalhe || dados?.erro || `SIGNAL-X respondeu ${r.status}`);
    }
    return dados;
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('A varredura passou de 2 minutos sem resposta. A ANATEL costuma ficar lenta em recortes grandes — tente um raio menor.');
    }
    // ECONNREFUSED tem mensagem críptica; aqui a causa quase sempre é uma só.
    if (/fetch failed|ECONNREFUSED/i.test(e.message)) {
      throw new Error(`SIGNAL-X não está no ar em ${BASE}. Peça ao operador para rodar "npm run dev" na pasta C:\\SIGNAL-X.`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function semAcento(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/**
 * A ANATEL só aceita o código IBGE de 7 dígitos. O operador fala "Santo André".
 * Esta função faz a ponte, e quando o nome é ambíguo devolve as opções em vez
 * de escolher sozinha — chutar o município erra a investigação inteira em
 * silêncio.
 */
async function resolverMunicipio(cidade, uf) {
  const { municipios } = await pedir(`/api/geo/municipios?uf=${encodeURIComponent(uf)}`);
  const alvo = semAcento(cidade);

  const exato = municipios.filter((m) => semAcento(m.nome) === alvo);
  if (exato.length === 1) return exato[0];

  const parcial = municipios.filter((m) => semAcento(m.nome).includes(alvo));
  if (parcial.length === 1) return parcial[0];

  if (parcial.length === 0) {
    throw new Error(`Não existe município parecido com "${cidade}" em ${uf}. Confira o nome e a UF.`);
  }
  throw new Error(
    `"${cidade}" é ambíguo em ${uf}. Candidatos: ${parcial.slice(0, 8).map((m) => m.nome).join(', ')}. Peça ao operador para precisar qual.`,
  );
}

const num = (v, padrao) => (Number.isFinite(Number(v)) ? Number(v) : padrao);

/**
 * Rua, bairro ou ponto de referência → coordenada.
 *
 * A ANATEL não aceita endereço: só raio, UF e município. Mas "as antenas da
 * Avenida Paulista" ou "do bairro Meireles" é exatamente o recorte que se quer
 * investigar. O SIGNAL-X geocodifica pelo OpenStreetMap e devolve, junto, um
 * raio proporcional ao tamanho do lugar — uma rua não pede o mesmo raio que um
 * bairro.
 */
async function resolverLocal(texto) {
  const d = await pedir(`/api/geo/local?q=${encodeURIComponent(texto)}`);
  if (!d.locais?.length) throw new Error(`Não localizei "${texto}" no Brasil.`);
  return d.locais[0];
}

/**
 * Executa a varredura e devolve texto pronto para o agente relatar.
 *
 * Aceita município (cidade + uf) ou raio (lat + lon + raio_km).
 */
export async function investigarAntenas(entrada = {}, aviso) {
  // Antes de qualquer consulta: o serviço precisa existir.
  const partida = await garantirNoAr(aviso);

  const escopo = entrada.escopo === 'todos' ? 'todos' : 'movel';
  const cidade = String(entrada.cidade || '').trim();
  const uf = String(entrada.uf || '').trim().toUpperCase();

  const local = String(entrada.local || '').trim();

  let url;
  let rotulo;
  /** Parâmetros que o console NASA usa para abrir o mapa já nesta varredura. */
  let mapa;

  if (local) {
    const l = await resolverLocal(local);
    const raio = num(entrada.raio_km, l.raioSugeridoKm);
    rotulo = l.nome.split(',').slice(0, 3).join(',').trim();
    url = `/api/anatel/scan?modo=raio&lat=${l.lat}&lon=${l.lon}&raio=${raio}&escopo=${escopo}&limite=3000`;
    mapa = { modo: 'raio', lat: l.lat, lon: l.lon, raio, escopo };
  } else if (cidade) {
    if (!/^[A-Z]{2}$/.test(uf)) {
      throw new Error(`Para varrer "${cidade}" preciso da UF (duas letras). Pergunte ao operador de qual estado.`);
    }
    const m = await resolverMunicipio(cidade, uf);
    rotulo = `${m.nome}/${uf}`;
    url = `/api/anatel/scan?modo=municipio&uf=${uf}&municipio=${m.codigo}&escopo=${escopo}&limite=3000`;
    mapa = { modo: 'municipio', uf, municipio: m.codigo, municipioNome: m.nome, escopo };
  } else {
    const lat = num(entrada.lat, null);
    const lon = num(entrada.lon, null);
    if (lat === null || lon === null) {
      throw new Error('Informe cidade+uf, ou lat+lon para varrer por raio.');
    }
    const raio = Math.min(Math.max(num(entrada.raio_km, 2), 0.1), 50);
    rotulo = `raio de ${raio} km em ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    url = `/api/anatel/scan?modo=raio&lat=${lat}&lon=${lon}&raio=${raio}&escopo=${escopo}&limite=3000`;
    mapa = { modo: 'raio', lat, lon, raio, escopo };
  }

  const scan = await pedir(url);

  /* URL do deck com a MESMA varredura já aplicada. É o que faz o globo abrir
     mostrando as antenas da região investigada, em vez do globo genérico: o
     console NASA usa isto como src do iframe. */
  const q = new URLSearchParams({ auto: '1', ...Object.fromEntries(
    Object.entries(mapa).map(([k, v]) => [k, String(v)]),
  ) });
  const mapaUrl = `${BASE}/?${q}`;

  return {
    rotulo,
    escopo,
    partida: partida.estado,
    texto: formatar(scan, rotulo, escopo, mapaUrl),
    stats: scan.stats,
    mapaUrl,
  };
}

function formatar(scan, rotulo, escopo, mapaUrl) {
  const s = scan.stats;

  if (s.totalSites === 0) {
    return `Nenhuma estação licenciada encontrada em ${rotulo}${escopo === 'movel' ? ' (apenas rede móvel/SMP)' : ''}.`;
  }

  const linhas = [];
  linhas.push(`VARREDURA: ${rotulo}${escopo === 'movel' ? ' — apenas rede móvel (SMP)' : ' — todos os serviços licenciados'}`);
  linhas.push(`${s.totalSites} sites físicos, ${s.totalEmissoes} emissões licenciadas.`);
  linhas.push('');

  linhas.push('OPERADORAS:');
  for (const o of s.porOperadora) {
    const pct = Math.round((o.sites / s.totalSites) * 100);
    linhas.push(`  ${o.operadora}: ${o.sites} sites (${pct}%), ${o.emissoes} emissões`);
  }

  linhas.push('');
  linhas.push('GERAÇÕES (um site pode contar em várias):');
  for (const g of s.porGeracao) {
    if (g.sites === 0) continue;
    const pct = Math.round((g.sites / s.totalSites) * 100);
    linhas.push(`  ${g.geracao}: ${g.sites} sites (${pct}% da área)`);
  }

  linhas.push('');
  linhas.push('ESPECTRO MAIS OCUPADO:');
  for (const b of s.porBanda.slice(0, 8)) {
    linhas.push(`  ${b.banda}: ${b.emissoes} emissões [${b.geracao}]`);
  }

  // Sites de maior porte: quem investiga quer saber onde estão os pontos densos.
  const destaques = [...scan.sites]
    .sort((a, b) => b.totalEmissoes - a.totalEmissoes)
    .slice(0, 5);

  linhas.push('');
  linhas.push('SITES MAIS DENSOS:');
  for (const st of destaques) {
    linhas.push(
      `  ${st.operadora} — ${st.endereco || 'endereço não informado'} (${st.municipio}/${st.uf})` +
        `\n    ${st.latitude.toFixed(6)}, ${st.longitude.toFixed(6)} · ${st.geracoes.join('+')} · ` +
        `${st.setores.length} setores · ${st.alturaAntenaM != null ? st.alturaAntenaM + ' m' : 'altura n/i'}` +
        `${st.compartilhado ? ' · infra compartilhada' : ''}`,
    );
  }

  // HISTÓRICO — responde "desde quando", que o mapa sozinho nunca responde.
  const h = s.historico || [];
  if (h.length) {
    const recentes = h.slice(-8);
    const pico = h.reduce((a, b) => (b.novos > a.novos ? b : a), h[0]);
    linhas.push('');
    linhas.push('HISTÓRICO DE IMPLANTAÇÃO (ano do primeiro licenciamento de cada site):');
    linhas.push(`  Primeiro site da região: ${h[0].ano}. Ano de maior expansão: ${pico.ano} (${pico.novos} sites novos).`);
    linhas.push('  Últimos anos: ' + recentes.map((a) => `${a.ano}:+${a.novos}`).join('  '));
    linhas.push(`  Total acumulado até ${h[h.length - 1].ano}: ${h[h.length - 1].acumulado} sites.`);
  }

  const c = (s.chegadas || []).filter((x) => x.geracao !== 'OUTRO' && x.primeiroAno);
  if (c.length) {
    linhas.push('');
    linhas.push('JANELA DE LICENCIAMENTO POR GERAÇÃO:');
    for (const x of c) {
      linhas.push(`  ${x.geracao}: ${x.primeiroAno}–${x.ultimoAno} (${x.emissoes} emissões)`);
    }
    /* Sem esta ressalva o agente diria "o 2G chegou em 2019", o que é falso: a
       data é da licença VIGENTE, e 2G existe desde os anos 1990. Só no 5G a
       primeira data equivale à chegada, porque NR só é licenciado desde 2021. */
    linhas.push('  OBS: são datas de licença VIGENTE, não a chegada da tecnologia — em 2G/3G/4G isso reflete renovação. Apenas no 5G (NR) a primeira data equivale à chegada real, pois só passou a ser licenciado após o leilão de 2021.');
  }

  if (s.truncado) {
    linhas.push('');
    linhas.push('ATENÇÃO: a amostra bateu no teto do scan — a ANATEL tinha mais registros neste recorte. Os números são um piso, não o total.');
  }

  linhas.push('');
  linhas.push(`Fonte: ${scan.fonte}. Dados de LICENCIAMENTO (o que a operadora declarou), não de sinal medido.`);
  // Link com a varredura embutida: abre o globo já sobre estes sites.
  linhas.push(`Mapa interativo desta varredura: ${mapaUrl || BASE}`);

  return linhas.join('\n');
}

/** Definição da ferramenta, no formato de tool use da Anthropic. */
export const TOOL_SIGNALX = {
  name: 'investigar_antenas',
  description:
    'INTELIGÊNCIA DE RADIOFREQUÊNCIA: mapeia as antenas/ERBs 2G, 3G, 4G e 5G de TODAS as operadoras (Vivo, Claro, TIM, Algar, Brisanet e demais) no Brasil, usando a base pública de licenciamento da ANATEL. Aceita quatro recortes: ENDEREÇO livre (rua, avenida, bairro, ponto de referência), CIDADE+UF, ESTADO inteiro, ou LAT+LON com raio. Retorna quantos sites físicos existem, a fatia de cada operadora, as gerações presentes, as faixas de espectro ocupadas (700 MHz a 26 GHz), os endereços dos sites mais densos com coordenadas/setores/altura, e o HISTÓRICO de implantação ano a ano — desde quando a região tem infraestrutura e em que ano ela mais cresceu. Use quando o operador perguntar sobre cobertura, antenas, ERBs, torres, sinal de celular, 5G, presença de operadora, infraestrutura de telecom, conectividade ou histórico de rede num lugar.',
  input_schema: {
    type: 'object',
    properties: {
      local: { type: 'string', description: 'ENDEREÇO livre: rua, avenida, bairro ou ponto de referência, SEMPRE com a cidade junto (ex: "Bairro Meireles, Fortaleza", "Avenida Paulista, São Paulo", "Rua Oscar Freire, São Paulo"). É o recorte mais preciso — prefira este quando o operador citar um bairro ou uma rua. O raio é escolhido automaticamente pelo tamanho do lugar.' },
      cidade: { type: 'string', description: 'Nome do município a varrer (ex: "Santo André", "Campinas"). Exige uf junto.' },
      uf: { type: 'string', description: 'Sigla do estado com duas letras (ex: "SP"). Obrigatória quando usar cidade.' },
      lat: { type: 'number', description: 'Latitude do centro, para varredura por raio (ex: -23.5613).' },
      lon: { type: 'number', description: 'Longitude do centro, para varredura por raio (ex: -46.6565).' },
      raio_km: { type: 'number', description: 'Raio da varredura em km (máximo 50). Com "local", omita para usar o raio proporcional ao tamanho do lugar. Use 0.5-2 para um bairro, 5-15 para uma região.' },
      escopo: {
        type: 'string',
        enum: ['movel', 'todos'],
        description: '"movel" (padrão) traz só as células de telefonia. "todos" inclui enlaces de backhaul, rádio privado e demais serviços licenciados no ponto.',
      },
    },
  },
};
