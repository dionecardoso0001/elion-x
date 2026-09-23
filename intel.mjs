/**
 * ELION-X · INVESTIGAÇÃO EM FONTES PRIMÁRIAS
 *
 * A premissa por trás deste módulo: quase toda notícia "que ainda não saiu"
 * JÁ ESTÁ PÚBLICA — só que num lugar chato que ninguém monitora. O edital
 * aparece no PNCP semanas antes de virar matéria; a empresa comunica o fato
 * relevante à CVM antes da imprensa cobrir; a multinacional registra o
 * movimento na SEC; a patente antecipa o produto; o paper antecipa a
 * tecnologia. Quem lê a fonte primária sabe antes — legalmente.
 *
 * Todas as fontes aqui são PÚBLICAS e oficiais. Nada de dados obtidos por
 * acesso não autorizado.
 */

const UA = 'ELION-X/3.1 (assistente pessoal; contato@advancedtechti.com.br)';
const t = ms => AbortSignal.timeout(ms);
const limpar = s => String(s || '').replace(/\s+/g, ' ').trim();

/* GDELT limita a 1 requisição a cada 5s.
   ARMADILHA: o relógio tem de ser reiniciado no FIM da requisição, não no
   começo. Marcando no começo, uma chamada que demora 3s deixa só 2,2s de
   folga até a seguinte — e o GDELT devolve texto puro de bloqueio em vez de
   JSON, que o nosso catch transforma silenciosamente em "nenhuma notícia".
   Era o que esvaziava a varredura sem dar erro. */
let gdeltUltima = 0;
let gdeltFila = Promise.resolve();
let gdeltCastigo = 0;      // instante até o qual o GDELT nos bloqueou
let gdeltPena = 0;         // duração da última punição (dobra a cada reincidência)
function gdeltVez(fn) {
  // serializa: com alvos em paralelo, dois esperariam a MESMA folga e sairiam juntos
  const vez = gdeltFila.then(async () => {
    const espera = 5500 - (Date.now() - gdeltUltima);
    if (espera > 0) await new Promise(r => setTimeout(r, espera));
    try { return await fn(); }
    finally { gdeltUltima = Date.now(); }
  });
  gdeltFila = vez.catch(() => {});
  return vez;
}

/* ── 1) PNCP — licitações e contratos públicos do Brasil ─────────────────
   O edital é publicado aqui ANTES de qualquer noticiário. Para quem vende
   B2G, é o sinal mais antecipado que existe: a demanda aparece formalizada,
   com valor, prazo e órgão, semanas antes de virar notícia. */
/* O buscador do PNCP é o mesmo que alimenta o portal pncp.gov.br/app/editais:
   faz busca TEXTUAL sobre a base inteira e responde em frações de segundo.
   Ele exige User-Agent de navegador — com UA de robô a resposta muda. */
const UA_NAV = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/* Nome composto tem de ir entre aspas, senão o buscador trata como OR e o
   ruído domina: "Vivo Empresas" sem aspas devolvia 194 editais — casando com
   "empresas" em qualquer licitação hospitalar. Com aspas, só o que cita a
   empresa de fato. Consultas que já tragam aspas ou OR passam intactas. */
const frase = q => (/["()]|\bOR\b/.test(q) || !q.trim().includes(' ')) ? q : `"${q}"`;

/* ── PNCP: busca textual em licitações abertas ────────────────────────────
   status=recebendo_proposta devolve só o que ainda dá para disputar — é o
   que interessa a quem vende: prazo em aberto, não histórico. */
export async function pncpLicitacoes(termo, { uf = '', limite = 12, status = 'recebendo_proposta' } = {}) {
  const q = limpar(termo);
  if (!q) return [];
  try {
    const u = `https://pncp.gov.br/api/search/?q=${encodeURIComponent(frase(q))}` +
      `&tipos_documento=edital&ordenacao=-data&pagina=1&tam_pagina=${Math.min(limite, 20)}` +
      (status ? `&status=${status}` : '') + (uf ? `&ufs=${uf}` : '');
    const txt = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': UA_NAV }, signal: t(20000) })
      .then(r => r.text());
    if (!txt.trim().startsWith('{')) return [];
    const j = JSON.parse(txt);
    return (j.items || []).slice(0, limite).map(i => ({
      fonte: 'PNCP (licitação pública)',
      titulo: limpar(i.description || i.title).slice(0, 220),
      orgao: i.orgao_nome || '',
      local: `${i.municipio_nome || ''}/${i.uf || ''}`,
      valor: i.valor_global || null,
      publicacao: (i.data_publicacao_pncp || '').slice(0, 10),
      encerramento: (i.data_fim_vigencia || '').replace('T', ' '),
      modalidade: i.modalidade_licitacao_nome || '',
      url: i.item_url ? `https://pncp.gov.br/app/editais${i.item_url.replace('/compras', '')}`
        : `https://pncp.gov.br/app/editais?q=${encodeURIComponent(q)}`,
      id: i.numero_controle_pncp || i.id,
      _total: j.total,
    }));
  } catch { return []; }
}

/* ── 2) SEC EDGAR — o que multinacionais comunicam aos reguladores ──────
   Fusões, aquisições, riscos e mudanças estratégicas aparecem no filing
   antes de virarem release de imprensa. Busca em texto completo. */
export async function secEdgar(termo, { forms = '', limite = 8 } = {}) {
  try {
    const u = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent('"' + termo + '"')}` +
      (forms ? `&forms=${encodeURIComponent(forms)}` : '');
    const j = await fetch(u, { headers: { 'User-Agent': UA }, signal: t(15000) }).then(r => r.json());
    return (j?.hits?.hits || []).slice(0, limite).map(h => {
      const s = h._source || {};
      const adsh = (h._id || '').split(':')[0];
      const cik = (s.ciks && s.ciks[0]) || '';
      return {
        fonte: `SEC EDGAR (${s.file_type || 'filing'})`,
        titulo: limpar(s.display_names?.[0] || 'documento'),
        tipo: s.file_type, data: s.file_date,
        url: cik && adsh
          ? `https://www.sec.gov/Archives/edgar/data/${cik.replace(/^0+/, '')}/${adsh.replace(/-/g, '')}/${(h._id || '').split(':')[1] || ''}`
          : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`,
      };
    });
  } catch { return []; }
}

/* ── 3) GDELT — cobertura mundial quase em tempo real ───────────────────
   Indexa notícias de milhares de veículos, em dezenas de idiomas, com
   poucos minutos de atraso. Serve para pegar o assunto surgindo fora do
   eixo da imprensa brasileira. */
/* ── Google Notícias (RSS) — imprensa brasileira ─────────────────────────
   Para uma carteira majoritariamente brasileira esta é a fonte certa: cobre
   a imprensa nacional e regional, responde em menos de 1s e aceita consultas
   seguidas sem bloquear. O GDELT (abaixo) fica como complemento internacional.
   O operador cuida de clientes BR — aqui é onde o sinal dele aparece. */
export async function googleNews(termo, { limite = 10, horas = 48 } = {}) {
  const q = limpar(termo);
  if (!q) return [];
  try {
    // when: é o filtro de recência do Google Notícias — sem ele vêm meses de histórico
    const janela = horas <= 24 ? '1d' : horas <= 48 ? '2d' : `${Math.ceil(horas / 24)}d`;
    const u = `https://news.google.com/rss/search?q=${encodeURIComponent(`${frase(q)} when:${janela}`)}` +
      `&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
    const xml = await fetch(u, { headers: { 'User-Agent': UA_NAV }, signal: t(15000) }).then(r => r.text());
    const out = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const e = m[1];
      const campo = tag => limpar((e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [, ''])[1])
        .replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      const veiculo = campo('source');
      // o título vem "Manchete - Veículo"; tiramos o sufixo redundante
      const titulo = campo('title').replace(new RegExp(`\\s*-\\s*${veiculo}$`), '');
      if (!titulo) continue;
      out.push({
        fonte: `Google Notícias · ${veiculo || 'imprensa'}`,
        titulo, url: campo('link'), data: campo('pubDate'),
      });
      if (out.length >= limite) break;
    }
    return out;
  } catch { return []; }
}

export async function gdeltNoticias(termo, { idioma = '', limite = 10, horas = 72 } = {}) {
  try {
    const u = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(termo)}` +
      `${idioma ? '&sourcelang=' + idioma : ''}&mode=artlist&maxrecords=${limite}` +
      `&timespan=${horas}h&format=json&sort=datedesc`;
    // em castigo: nem tenta. Cada 429 custa ~10s — 30 alvos desperdiçariam 5min numa parede
    if (Date.now() < gdeltCastigo) return [];
    const txt = await gdeltVez(() => fetch(u, { headers: { 'User-Agent': UA }, signal: t(15000) })
      .then(async r => (r.status === 429 ? '429' : await r.text())));
    if (!txt.trim().startsWith('{')) {
      gdeltPena = Math.min(gdeltPena ? gdeltPena * 2 : 60000, 15 * 60000);   // dobra até 15 min
      gdeltCastigo = Date.now() + gdeltPena;
      return [];
    }
    gdeltPena = 0;                                    // respondeu: zera a punição
    const j = JSON.parse(txt);
    return (j.articles || []).map(a => ({
      fonte: `GDELT · ${a.domain || 'web'}`,
      titulo: limpar(a.title), url: a.url, data: a.seendate, idioma: a.language, pais: a.sourcecountry,
    }));
  } catch { return []; }
}

/* ── 4) arXiv — a pesquisa que antecede o produto ───────────────────────
   O paper costuma sair 6-18 meses antes de a tecnologia virar notícia. */
export async function arxivPapers(termo, { limite = 6 } = {}) {
  try {
    const xml = await fetch(
      `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent('"' + termo + '"')}` +
      `&start=0&max_results=${limite}&sortBy=submittedDate&sortOrder=descending`,
      { headers: { 'User-Agent': UA }, signal: t(15000) }).then(r => r.text());
    const out = [];
    for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
      const e = m[1];
      const g = (tag) => (e.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [, ''])[1];
      out.push({
        fonte: 'arXiv (pesquisa)',
        titulo: limpar(g('title')),
        data: (g('published') || '').slice(0, 10),
        resumo: limpar(g('summary')).slice(0, 260),
        url: limpar(g('id')),
      });
    }
    return out;
  } catch { return []; }
}

/* ── 5) Diários oficiais municipais (Querido Diário / OKBR) ─────────────
   Contratos, nomeações e decretos municipais — onde nasce boa parte da
   notícia regional antes de qualquer jornal. */
export async function diariosOficiais(termo, { limite = 8, dias = 0 } = {}) {
  /* O host mudou: queridodiario.ok.org.br/api agora devolve o HTML do site
     (rota curinga do SPA) e o fetch morria calado no JSON.parse. A API vive
     em api.queridodiario.ok.org.br — o antigo fica como reserva. */
  const bases = [
    'https://api.queridodiario.ok.org.br/api/gazettes',
    'https://queridodiario.ok.org.br/api/gazettes',
  ];
  for (const base of bases) {
    try {
      /* dias > 0 recorta a janela recente — essencial na vigilância: sem isso
         um termo com poucos registros históricos devolve diário de 2024 como
         se fosse novidade. Na investigação sob demanda, dias = 0 (tudo). */
      const desde = dias > 0 ? `&published_since=${new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10)}` : '';
      const resp = await fetch(`${base}?querystring=${encodeURIComponent(frase(termo))}&size=${limite}&sort_by=descending_date${desde}`,
        { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: t(12000) });
      const txt = await resp.text();
      if (!txt.trim().startsWith('{')) continue;      // veio HTML: tenta a próxima base
      const j = JSON.parse(txt);
      const g = j?.gazettes;
      if (Array.isArray(g)) {
        return g.map(x => ({
          fonte: 'Diário Oficial municipal',
          titulo: `${x.territory_name || ''} — ${x.date || ''}`,
          data: x.date, url: x.url || x.txt_url, municipio: x.territory_name, uf: x.state_code,
          trecho: limpar((x.excerpts || [])[0] || '').slice(0, 240),
        }));
      }
    } catch {}
  }
  return [];
}

/* ── 7) CVM — FATO RELEVANTE das companhias abertas brasileiras ──────────
   A peça que faltava. A Resolução CVM 44 obriga a companhia a comunicar o
   fato relevante à CVM ANTES ou no mesmo instante em que informa a imprensa —
   então este é literalmente o ponto onde o fato nasce. A SEC EDGAR, que já
   temos, só alcança quem é registrado nos EUA: Santander Brasil, Bradesco,
   Cielo, Algar, Vivara, Americanas e Oi não aparecem lá.

   DUAS DECISÕES MEDIDAS, não estimadas:

   1) SÓ "Fato Relevante", nunca "Comunicado ao Mercado". Medi a janela de 90
      dias: 587 fatos relevantes contra 20.682 comunicados. O comunicado é
      mangueira de incêndio e vem cheio de formulário de emissor estrangeiro
      espelhado ("6-K", "144", "4"). Com fato relevante, a carteira inteira do
      operador rendeu 12 documentos em 90 dias e NENHUM falso positivo — todos
      eventos societários materiais (OPA do Santander, incorporação da
      Fibrasil, alienação da operação de IoT da Algar).

   2) UMA requisição serve a TODOS os alvos. A consulta sem filtro de empresa
      devolve a janela inteira em ~40ms; filtrar por nome em memória é de
      graça. Consultar empresa por empresa exigiria mapear cada alvo ao código
      CVM de 6 dígitos — e com ',2103' em vez de ',021032' a resposta volta
      VAZIA com HTTP 200, que é o tipo de armadilha que vira "nada novo". */
const CVM_URL = 'https://www.rad.cvm.gov.br/ENETWeb/frmConsultaExternaCVM.aspx';
let cvmCache = { em: 0, dias: 0, docs: [] };

const dataBR = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

async function cvmJanela(dias) {
  const agora = Date.now();
  // 10 min de cache: uma varredura de 40 alvos faz 1 chamada, não 40
  if (cvmCache.docs.length && cvmCache.dias >= dias && agora - cvmCache.em < 600000) return cvmCache.docs;
  const hoje = new Date();
  const r = await fetch(CVM_URL + '/ListarDocumentos', {
    method: 'POST',
    headers: { 'User-Agent': UA_NAV, 'Content-Type': 'application/json; charset=utf-8', Referer: CVM_URL },
    body: JSON.stringify({
      dataDe: dataBR(new Date(agora - dias * 86400000)), dataAte: dataBR(hoje),
      empresa: '', setorAtividade: '-1', categoriaEmissor: '-1', situacaoEmissor: '-1',
      tipoParticipante: '-1', dataReferencia: '', categoria: 'IPE_4_-1_-1', periodo: '2',
      horaIni: '', horaFim: '', palavraChave: '', ultimaDtRef: 'false', tipoEmpresa: '0',
      // token e versaoCaptcha são obrigatórios MESMO vazios: sem eles vem HTTP 500
      token: '', versaoCaptcha: '',
    }),
    signal: t(30000),
  });
  if (!r.ok) throw new Error(`CVM respondeu HTTP ${r.status}`);
  const j = await r.json();
  const d = j?.d;
  // erro explícito em vez de lista vazia: se a CVM religar o captcha, isso tem
  // de aparecer no log, não virar um silencioso "nenhuma novidade"
  if (!d || d.temErro) throw new Error('CVM recusou a consulta: ' + (d?.msgErro || 'sem detalhe') + ' (captcha religado?)');
  /* ARMADILHA CONFIRMADA: parâmetro inválido devolve HTTP 200, temErro=false,
     msgErro vazio e dados="" — 152 bytes de silêncio. Um erro de query fica
     idêntico a "nada aconteceu no mercado". Como consultamos a JANELA INTEIRA
     sem filtro de empresa, vazio é impossível na prática: o mercado brasileiro
     produz ~6 fatos relevantes por dia. Vazio aqui significa consulta quebrada. */
  if (!String(d.dados || '').trim())
    throw new Error('CVM devolveu lista vazia para a janela inteira — consulta provavelmente inválida, não ausência de fatos');
  const semTag = s => String(s || '').replace(/<[^>]*>/g, '').trim();
  const docs = String(d.dados || '').split('&*').filter(Boolean).map(linha => {
    const c = linha.split('$&');
    const prot = /NumeroProtocoloEntrega=(\d+)/.exec(c[10] || '');
    return {
      empresa: limpar(c[1]), assunto: semTag(c[4]),
      entrega: semTag(c[6]).replace(/^\d{8}\s*/, ''),   // tira a chave de ordenação
      protocolo: prot ? prot[1] : '',
    };
  }).filter(x => x.empresa);
  cvmCache = { em: agora, dias, docs };
  return docs;
}

/* Casamento nome comercial → razão social. Regra estrita, calibrada contra o
   cadastro real: TODOS os tokens distintivos presentes como PALAVRA INTEIRA.
   Sem "palavra inteira", "Mercado Livre" casa com SUPERMERCADOS e "Amazon"
   com BCO AMAZONIA. Sem "todos os tokens", "America Net" casa com AMERICA DO
   SUL. Alternativas de OR são avaliadas em separado, porque o operador
   escreve alvos como "Telefônica Brasil OR Vivo Empresas". */
const CVM_RUIDO = new Set(['BANCO','BCO','GRUPO','EMPRESAS','EMPRESA','BRASIL','BRASILEIRA','TECH','TELECOM',
  'TELECOMUNICACOES','LTDA','PARTICIPACOES','PARTICIPACAO','HOLDING','COMPANHIA','CIA','SEGUROS','SEGURADORA',
  'SERVICOS','SISTEMAS','SOLUCOES','INDUSTRIA','COMERCIO','NACIONAL','INTERNACIONAL','TECNOLOGIA','DIGITAL',
  'MINISTERIO','FEDERAL','ESTADO','AGENCIA','HOSPITAL','OPERADORA','TELEFONIA','LOJAS','SUPERMERCADO']);
const semAcento = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();

function cvmCasa(termo, razaoSocial) {
  const palavras = new Set(semAcento(razaoSocial).split(/[^A-Z0-9]+/).filter(Boolean));
  return String(termo).split(/\s+OR\s+/i).some(alt => {
    const toks = semAcento(alt).split(/[^A-Z0-9]+/).filter(x => x.length >= 3 && !CVM_RUIDO.has(x));
    return toks.length > 0 && toks.every(x => palavras.has(x));
  });
}

export async function cvmFatosRelevantes(termo, { dias = 30, limite = 8 } = {}) {
  const q = limpar(termo);
  if (!q) return [];
  try {
    const docs = await cvmJanela(Math.max(dias, 30));
    return docs.filter(d => cvmCasa(q, d.empresa)).slice(0, limite).map(d => ({
      fonte: 'CVM (fato relevante)',
      titulo: `${d.empresa} — ${d.assunto.replace(/\s*-\s*$/, '')}`,
      orgao: d.empresa,
      tipo: 'Fato Relevante',
      data: d.entrega,
      id: d.protocolo ? 'cvm:' + d.protocolo : '',
      url: d.protocolo
        ? `https://www.rad.cvm.gov.br/ENETWeb/frmExibirArquivoIPEExterno.aspx?NumeroProtocoloEntrega=${d.protocolo}`
        : 'https://www.rad.cvm.gov.br/ENETWeb/frmConsultaExternaCVM.aspx',
    }));
  } catch (e) {
    // barulhento de propósito: falha de fonte não pode se disfarçar de "sem novidade"
    console.warn('[intel] CVM indisponível:', e.message);
    return [];
  }
}

/* ── 8) DOU — Diário Oficial da União ────────────────────────────────────
   O Querido Diário, que já temos, para nos diários MUNICIPAIS e estaduais. O
   DOU federal ficava de fora — e é onde nascem os atos da Anatel, as portarias
   do Ministério das Comunicações e os atos da Receita Federal, três órgãos que
   estão na carteira do operador. Publica de madrugada e já está indexado no
   mesmo dia: é o melhor frescor entre as fontes oficiais brasileiras.

   O JSON vem embutido num <script type="application/json"> — contrato não
   documentado, mas estável. O buscador aplica STEMMING: "Telefonica" casa com
   "telefone". Por isso o pós-filtro abaixo confere se o termo aparece MESMO no
   texto retornado; sem ele, a busca por Telefônica devolvia só falso positivo. */
const DOU_URL = 'https://www.in.gov.br/consulta/-/buscar/dou';
const ddmmyyyy = d => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;

export async function douAtos(termo, { dias = 10, limite = 8, secoes = 'todos' } = {}) {
  const q = limpar(termo);
  if (!q) return [];
  try {
    const hoje = new Date();
    const u = `${DOU_URL}?q=${encodeURIComponent(q)}&s=${secoes}&exactDate=personalizado` +
      `&publishFrom=${ddmmyyyy(new Date(Date.now() - Math.max(dias, 1) * 86400000))}` +
      `&publishTo=${ddmmyyyy(hoje)}&sortType=0`;
    // Accept explícito: o portal já devolveu 403 sem ele em outras janelas
    const html = await fetch(u, { headers: { 'User-Agent': UA_NAV, Accept: 'text/html,application/json' }, signal: t(25000) })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
    const m = /<script[^>]*BuscaDouPortlet_params[^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (!m) return [];
    const arr = JSON.parse(m[1]).jsonArray || [];
    /* PÓS-FILTRO contra o stemming: só passa o que traz o termo de verdade.
       Cada palavra do termo tem de aparecer no título ou no trecho — é o que
       separa a Telefônica da palavra "telefone". */
    const alvos = semAcento(q).split(/[^A-Z0-9]+/).filter(x => x.length >= 4);
    const ok = a => {
      if (!alvos.length) return true;
      const txt = semAcento(`${a.title || ''} ${a.content || ''}`);
      return alvos.every(x => txt.includes(x));
    };
    return arr.filter(ok).slice(0, limite).map(a => ({
      fonte: `DOU ${a.pubName || ''} (${a.artType || 'ato'})`,
      titulo: limpar(a.title).slice(0, 200),
      orgao: limpar(String(a.hierarchyStr || '').split('/').pop()),
      data: a.pubDate,
      trecho: limpar(String(a.content || '').replace(/<[^>]*>/g, '')).slice(0, 220),
      id: a.classPK ? 'dou:' + a.classPK : '',
      url: a.urlTitle ? `https://www.in.gov.br/web/dou/-/${a.urlTitle}` : DOU_URL,
    }));
  } catch (e) {
    console.warn('[intel] DOU indisponível:', e.message);
    return [];
  }
}

/* ── 9) ANATEL — consultas públicas com prazo aberto ─────────────────────
   O setor do próprio operador. Aqui aparece, por exemplo, a reavaliação dos
   limites de espectro POR GRUPO ECONÔMICO — que mexe na posição competitiva de
   Vivo, Claro e TIM — enquanto a janela de contribuição ainda está aberta.
   Isso quase nunca vira manchete.

   Não há API: é OutSystems renderizado no servidor. Mas são poucas consultas
   (2 a 3 abertas por vez), os links são estáveis por ConsultaId e a página é
   determinista — parse de HTML resolve. Sem busca textual no portal, então o
   casamento com o termo é feito aqui, sobre o texto já baixado. */
const ANATEL_URL = 'https://apps.anatel.gov.br/ParticipaAnatel/ConsultasEmAndamento.aspx';
let anatelCache = { em: 0, itens: [] };

const deHtml = s => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/<[^>]*>/g, ' ');

async function anatelAbertas() {
  if (anatelCache.itens.length && Date.now() - anatelCache.em < 1800000) return anatelCache.itens;
  const html = await fetch(ANATEL_URL, { headers: { 'User-Agent': UA_NAV }, signal: t(40000) })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
  const itens = [];
  // cada consulta é uma linha de tabela iniciada pelo link com ConsultaId
  for (const m of html.matchAll(/ConsultaId=(\d+)"[^>]*>([\s\S]*?)(?=ConsultaId=\d+"|<\/table>)/g)) {
    const [, id, bloco] = m;
    const txt = limpar(deHtml(bloco));
    const titulo = (/CONSULTA P[ÚU]BLICA N[ºO°]?\s*\d+|TOMADA DE SUBS[ÍI]DIOS N[ºO°]?\s*\d+/i.exec(txt) || [''])[0];
    // duas datas dd/mm/aaaa hh:mm:ss na linha: abertura e ENCERRAMENTO
    const datas = [...txt.matchAll(/(\d{2}\/\d{2}\/\d{4})\s*(\d{2}:\d{2}:\d{2})/g)].map(d => `${d[1]} ${d[2]}`);
    const ementa = limpar(txt.replace(titulo, '').split(/Respons[áa]vel:/)[0]).slice(0, 220);
    const area = (/[ÁA]rea:\s*([A-Z0-9]+)/.exec(txt) || [, ''])[1];
    if (!titulo && !ementa) continue;
    itens.push({ id, titulo: titulo || 'Consulta pública', ementa, area,
                 abertura: datas[0] || '', encerramento: datas[1] || '' });
  }
  anatelCache = { em: Date.now(), itens };
  return itens;
}

/* Termos que fazem a consulta da Anatel ser relevante mesmo sem casar o nome:
   é regulação do setor em que o operador vende, não de uma conta específica. */
const ANATEL_SETOR = ['ANATEL', 'TELECOM', 'ESPECTRO', 'RADIOFREQUENCIA', 'SATELITE', 'HOMOLOGACAO',
                      'IOT', 'INTERNET DAS COISAS', 'CONECTIVIDADE', '5G', 'BANDA LARGA', 'SMP'];

export async function anatelConsultas(termo, { limite = 5 } = {}) {
  const q = limpar(termo);
  if (!q) return [];
  try {
    const abertas = await anatelAbertas();
    const alvo = semAcento(q);
    const setorial = ANATEL_SETOR.some(s => alvo.includes(s));
    const casa = c => setorial || semAcento(`${c.titulo} ${c.ementa}`).includes(alvo);
    return abertas.filter(casa).slice(0, limite).map(c => ({
      fonte: 'ANATEL (consulta pública em aberto)',
      titulo: `${c.titulo} — ${c.ementa}`,
      orgao: c.area ? `Anatel · ${c.area}` : 'Anatel',
      encerramento: c.encerramento,
      data: c.abertura,
      id: 'anatel:' + c.id,
      url: `https://apps.anatel.gov.br/ParticipaAnatel/VisualizarTextoConsulta.aspx?TelaDeOrigem=2&ConsultaId=${c.id}`,
    }));
  } catch (e) {
    console.warn('[intel] ANATEL indisponível:', e.message);
    return [];
  }
}

/* ── orquestrador: dispara as fontes pertinentes em paralelo ───────────── */
/* dias: janela de recência. 0 = tudo (investigação sob demanda, onde o
   histórico interessa). Na vigilância passamos ~10 dias, senão um diário de
   2024 entraria no briefing como se fosse novidade de hoje. */
export async function investigar(termo, { fontes = 'auto', uf = '', idioma = '', dias = 0, termoEn = '' } = {}) {
  const q = limpar(termo);
  if (!q) throw new Error('informe o que investigar');

  const querem = f => fontes === 'auto' || String(fontes).includes(f);
  const horas = dias > 0 ? dias * 24 : 168;
  const tarefas = [];
  if (querem('licitacoes')) tarefas.push(pncpLicitacoes(q, { uf }).then(r => ['licitacoes', r]));
  if (querem('regulador'))  tarefas.push(secEdgar(q).then(r => ['regulador', r]));
  if (querem('noticias'))   tarefas.push(googleNews(q, { horas }).then(r => ['noticias', r]));
  if (querem('mundo'))      tarefas.push(gdeltNoticias(q, { idioma }).then(r => ['mundo', r]));
  /* arXiv é uma base EM INGLÊS: buscar "telemetria" ou "internet das coisas"
     devolve zero — não por falha, por idioma. termoEn carrega o equivalente
     ("telemetry", "internet of things"); sem ele, nem consulta. */
  if (querem('pesquisa') && (termoEn || /^[\x20-\x7E]+$/.test(q)))
    tarefas.push(arxivPapers(termoEn || q).then(r => ['pesquisa', r]));
  if (querem('diarios'))    tarefas.push(diariosOficiais(q, { dias }).then(r => ['diarios', r]));
  if (querem('cvm'))        tarefas.push(cvmFatosRelevantes(q, { dias: dias || 30 }).then(r => ['cvm', r]));
  if (querem('dou'))        tarefas.push(douAtos(q, { dias: dias || 10 }).then(r => ['dou', r]));
  if (querem('anatel'))     tarefas.push(anatelConsultas(q).then(r => ['anatel', r]));

  const res = await Promise.allSettled(tarefas);
  const out = { termo: q, em: new Date().toISOString(), fontes: {} };
  let total = 0;
  for (const r of res) {
    if (r.status !== 'fulfilled') continue;
    const [nome, itens] = r.value;
    if (itens && itens.length) { out.fontes[nome] = itens; total += itens.length; }
  }
  out.total = total;
  return out;
}

/** relatório em texto para o agente narrar */
export function relatorio(r) {
  const N = { licitacoes: 'LICITAÇÕES PÚBLICAS (PNCP) — demanda formalizada antes de virar notícia',
    regulador: 'REGULADOR (SEC EDGAR) — o que a empresa comunicou oficialmente',
    noticias: 'IMPRENSA (Google Notícias) — cobertura brasileira recente',
    mundo: 'IMPRENSA MUNDIAL (GDELT) — cobertura fora do eixo brasileiro',
    pesquisa: 'PESQUISA (arXiv) — o que antecede a tecnologia virar produto',
    diarios: 'DIÁRIOS OFICIAIS — atos municipais na origem',
    cvm: 'CVM · FATO RELEVANTE — o que a companhia comunicou ANTES da imprensa',
    dou: 'DIÁRIO OFICIAL DA UNIÃO — ato federal no dia em que sai',
    anatel: 'ANATEL — consulta pública com PRAZO ABERTO para contribuir' };
  if (!r.total) return `Nenhum registro encontrado nas fontes primárias para "${r.termo}". Vale tentar termos mais específicos (nome da empresa, do órgão, da tecnologia) ou ampliar o período.`;
  let s = `INVESTIGAÇÃO EM FONTES PRIMÁRIAS · "${r.termo}" · ${r.total} registro(s)\n`;
  for (const [k, itens] of Object.entries(r.fontes)) {
    s += `\n■ ${N[k] || k} (${itens.length})\n`;
    itens.slice(0, 8).forEach((i, n) => {
      s += `  ${n + 1}. ${i.titulo}\n`;
      if (i.orgao) s += `     órgão: ${i.orgao} · ${i.local || ''}\n`;
      if (i.valor) s += `     valor estimado: R$ ${Number(i.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n`;
      if (i.encerramento) s += `     propostas até: ${String(i.encerramento).slice(0, 10)}\n`;
      if (i.tipo) s += `     tipo: ${i.tipo} · ${i.data || ''}\n`;
      if (i.trecho) s += `     "${i.trecho}"\n`;
      if (i.resumo) s += `     ${i.resumo}\n`;
      if (i.url) s += `     ${i.url}\n`;
    });
  }
  return s;
}
