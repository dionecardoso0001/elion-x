/* ═══════════════════════════════════════════════════════════════════════════
   COMPREENSÃO — a diferença entre LER um arquivo e ENTENDER um documento.

   A extração entrega uma parede de texto. O agente então percorre 40 mil
   caracteres por vez, às cegas, sem saber onde começa a cláusula de multa nem
   que o número que ele acabou de ver é o valor total do contrato.

   Aqui moram quatro coisas que transformam texto em documento compreendido:

     1. ESTRUTURA — o sumário. Onde ficam as seções, cláusulas e páginas, com o
        endereço de cada uma. É o que permite ir direto em vez de varrer.
     2. NATUREZA  — isto é contrato, edital, proposta, nota fiscal, currículo ou
        relatório? Cada um se lê com uma pergunta diferente na cabeça.
     3. FATOS     — valores, prazos, datas, CNPJ, percentuais. Extraídos na
        entrada, disponíveis na primeira frase, sem gastar uma leitura inteira.
     4. SINÔNIMOS — o operador pergunta "qual a multa" e o contrato escreve
        "penalidade pecuniária". Busca literal devolve zero e o agente conclui
        que não há multa. Essa é a falha mais perigosa daqui: ela não parece
        falha, parece resposta.
   ═══════════════════════════════════════════════════════════════════════════ */

const semAcento = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/* ────────────────────── 1. ESTRUTURA ────────────────────── */

/* Cada padrão traz o nível hierárquico. Ordem importa: o primeiro que casar
   vence, então o mais específico vem antes. */
const PADROES_SECAO = [
  { re: /^(?:CL[ÁA]USULA)\s+([IVXLCDM]+|[A-ZÇÃÕÉÊÍÓÚÂ]+|\d+)[ªº°]?\s*[-–—:.]?\s*(.{0,90})$/i, nivel: 1, tipo: 'cláusula' },
  { re: /^(?:ANEXO|AP[ÊE]NDICE)\s+([IVXLCDM]+|[A-Z]|\d+)\s*[-–—:.]?\s*(.{0,90})$/i, nivel: 1, tipo: 'anexo' },
  { re: /^(?:CAP[ÍI]TULO|T[ÍI]TULO|SE[ÇC][ÃA]O|PARTE)\s+([IVXLCDM]+|\d+)\s*[-–—:.]?\s*(.{0,90})$/i, nivel: 1, tipo: 'seção' },
  { re: /^(?:ARTIGO|ART\.)\s*(\d+)[ºo°]?\s*[-–—:.]?\s*(.{0,90})$/i, nivel: 2, tipo: 'artigo' },
  { re: /^(?:ITEM|LOTE|OBJETO|PAR[ÁA]GRAFO)\s+([IVXLCDM]+|\d+)[ªº°]?\s*[-–—:.]?\s*(.{0,90})$/i, nivel: 2, tipo: 'item' },
  { re: /^(\d+(?:\.\d+){0,3})[.)]?\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^\n]{2,90})$/, nivel: 0, tipo: 'numerada' },   // nível vem da profundidade
  { re: /^#{1,6}\s+(.{1,100})$/, nivel: 0, tipo: 'markdown' },
  { re: /^━━\s*(.{1,80}?)\s*━━$/, nivel: 1, tipo: 'bloco' },                                           // marcadores dos meus extratores
  { re: /^([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9 ,\/'"()–—-]{6,70})$/, nivel: 2, tipo: 'caixa-alta' },
];

/**
 * Mapa navegável do documento: cada seção com o endereço em caracteres, para o
 * agente pular direto. Sem isso ele lê da primeira à última parte para achar
 * uma cláusula que estava na página 40.
 */
export function mapearEstrutura(texto, { maxSecoes = 120 } = {}) {
  const linhas = String(texto || '').split('\n');
  const secoes = [];
  let pos = 0;

  for (const linha of linhas) {
    const inicio = pos;
    pos += linha.length + 1;
    const t = linha.trim();
    if (t.length < 3 || t.length > 120) continue;

    for (const p of PADROES_SECAO) {
      const m = t.match(p.re);
      if (!m) continue;
      // "caixa-alta" é o padrão mais frouxo — exige que a linha esteja isolada
      if (p.tipo === 'caixa-alta' && /[.;,]$/.test(t)) break;
      let nivel = p.nivel;
      if (p.tipo === 'numerada') nivel = Math.min(1 + (m[1].match(/\./g) || []).length, 4);
      if (p.tipo === 'markdown') nivel = (t.match(/^#+/) || ['#'])[0].length;
      secoes.push({ titulo: t.slice(0, 100), nivel, tipo: p.tipo, inicio });
      break;
    }
    if (secoes.length >= maxSecoes * 3) break;   // documento sem estrutura: pare de tentar
  }

  /* Um documento onde TUDO vira seção não tem estrutura — tem texto em caixa
     alta, ou uma lista. Anunciar 400 "seções" seria pior que não anunciar
     nenhuma: o agente confiaria num mapa que não descreve nada. */
  const densidade = secoes.length / Math.max(1, linhas.filter(l => l.trim()).length);
  if (densidade > 0.35 || secoes.length > maxSecoes) {
    const fortes = secoes.filter(s => s.tipo !== 'caixa-alta' && s.tipo !== 'numerada');
    if (fortes.length && fortes.length <= maxSecoes) return fortes;
    return secoes.filter(s => s.nivel <= 1).slice(0, maxSecoes);
  }
  return secoes.slice(0, maxSecoes);
}

/** Sumário em texto, pronto para entrar no prompt. */
export function sumarioTexto(secoes, totalChars, porParte = 40000) {
  if (!secoes || !secoes.length) return '';
  const linhas = secoes.map(s => {
    const parte = Math.floor(s.inicio / porParte) + 1;
    return `${'  '.repeat(Math.max(0, s.nivel - 1))}· ${s.titulo}${totalChars > porParte ? `  [parte ${parte}]` : ''}`;
  });
  return `MAPA DO DOCUMENTO (${secoes.length} seções — use para ir DIRETO ao trecho, em vez de ler tudo):\n${linhas.join('\n')}`;
}

/* ────────────────────── 2. NATUREZA ────────────────────── */

const TIPOS = [
  {
    tipo: 'contrato',
    sinais: [/cl[aá]usula/i, /contratante/i, /contratad[ao]/i, /rescis[aã]o/i, /foro da comarca/i, /v[ií]nculo emprega/i, /partes acordam/i, /firmam o presente/i],
    minimo: 3,
    leitura: 'Leia como ADVOGADO DO OPERADOR: cace obrigações dele, multas, prazos de aviso prévio, renovação automática, exclusividade, garantias e foro. O que o contrato NÃO diz também é risco.',
  },
  {
    tipo: 'edital/licitação',
    sinais: [/edital/i, /licita[çc][ãa]o/i, /preg[ãa]o/i, /habilita[çc][ãa]o/i, /pregoeiro/i, /lei\s*n?[º°.]?\s*(8\.?666|14\.?133)/i, /termo de refer[êe]ncia/i, /disputa de lances/i],
    minimo: 2,
    leitura: 'Leia como QUEM VAI CONCORRER: prazo de entrega da proposta, documentos de habilitação exigidos, critério de julgamento, valor estimado, e o que DESCLASSIFICA. Sinalize cada exigência que o operador ainda não cumpre.',
  },
  {
    tipo: 'proposta comercial',
    sinais: [/proposta comercial/i, /escopo (?:do|de) (?:projeto|servi[çc]o)/i, /investimento/i, /validade da proposta/i, /condi[çc][õo]es de pagamento/i, /entreg[áa]veis/i],
    minimo: 2,
    leitura: 'Leia como QUEM VAI NEGOCIAR: escopo prometido, o que está FORA do escopo, preço e forma de pagamento, prazo, validade da proposta e premissas que, se furarem, mudam o preço.',
  },
  {
    tipo: 'nota fiscal/fatura',
    sinais: [/nota fiscal/i, /danfe/i, /\bnfe?\b/i, /valor total da nota/i, /base de c[áa]lculo/i, /\bicms\b/i, /\biss\b/i, /chave de acesso/i],
    minimo: 2,
    leitura: 'Extraia: emitente, destinatário, número, data, itens, valor total e impostos. Confira se o valor bate com o contrato ou pedido correspondente, se o operador mencionar um.',
  },
  {
    tipo: 'currículo',
    sinais: [/curr[ií]culo/i, /experi[êe]ncia profissional/i, /forma[çc][ãa]o acad[êe]mica/i, /\bcurriculum\b/i, /objetivo profissional/i, /idiomas?:/i],
    minimo: 2,
    leitura: 'Leia como QUEM VAI CONTRATAR: aderência ao que o operador precisa, tempo real em cada função, lacunas de período, e as 3 perguntas que a entrevista precisa fazer.',
  },
  {
    tipo: 'especificação técnica',
    sinais: [/requisitos? (?:funcionais?|t[ée]cnicos?)/i, /arquitetura/i, /\bapi\b/i, /endpoint/i, /diagrama/i, /caso de uso/i, /\bsla\b/i, /integra[çc][ãa]o/i],
    minimo: 3,
    leitura: 'Leia como ARQUITETO: o que o sistema precisa fazer, as restrições, as integrações e os requisitos não-funcionais. Aponte requisito ambíguo — é ali que o projeto derrapa.',
  },
  {
    tipo: 'relatório/apresentação',
    sinais: [/sum[áa]rio executivo/i, /conclus[ãa]o/i, /metodologia/i, /resultados/i, /━━ Slide/, /pr[óo]ximos passos/i],
    minimo: 2,
    leitura: 'Leia como EXECUTIVO: a tese, a evidência que a sustenta e a decisão que ele pede. Separe o que é dado do que é opinião do autor.',
  },
  {
    tipo: 'e-mail',
    sinais: [/^━━ E-MAIL ━━/m, /^Assunto:/m, /^De:.*@/m],
    minimo: 2,
    leitura: 'Identifique o PEDIDO (o que querem dele), o PRAZO e quem mais está na conversa. Se houver anexo não lido, diga.',
  },
  {
    tipo: 'planilha/dados',
    sinais: [/^TABELA · \d+ coluna/m, /^━━ Planilha/m, /^\[linha \d+\]/m],
    minimo: 1,
    leitura: 'Leia como ANALISTA: o que cada coluna significa, totais, valores fora da curva e linhas incompletas. Não invente soma — se precisar de um total, some explicitamente e mostre a conta.',
  },
];

/**
 * Classificação por sinais contados, não por um único gatilho: a palavra
 * "contrato" aparece em edital e em proposta o tempo todo. Exigir um mínimo de
 * sinais distintos é o que separa o documento do que só o menciona.
 */
export function classificarDocumento(texto, nome = '') {
  const amostra = String(texto || '').slice(0, 20000) + '\n' + String(texto || '').slice(-4000);
  const alvo = amostra + '\n' + nome;
  const pontuados = [];
  for (const t of TIPOS) {
    const achados = t.sinais.filter(re => re.test(alvo));
    if (achados.length >= t.minimo) pontuados.push({ ...t, forca: achados.length, achados: achados.length });
  }
  if (!pontuados.length) return { tipo: 'documento genérico', confianca: 'baixa', leitura: '', alternativas: [] };
  pontuados.sort((a, b) => (b.forca / b.sinais.length) - (a.forca / a.sinais.length) || b.forca - a.forca);
  const [melhor, ...resto] = pontuados;
  return {
    tipo: melhor.tipo,
    confianca: melhor.forca >= melhor.minimo + 2 ? 'alta' : 'média',
    leitura: melhor.leitura,
    alternativas: resto.slice(0, 2).map(x => x.tipo),
  };
}

/* ────────────────────── 3. FATOS ────────────────────── */

/* A ESCALA FAZ PARTE DO VALOR. Sem capturar "bilhões", uma apresentação que diz
   "R$ 47 bilhões" era relatada como "R$ 47" — erro de nove ordens de grandeza,
   apresentado com a mesma confiança de um acerto. */
/* `,\d{1,2}` e não `,\d{2}`: "R$ 2,5 milhões" e "R$ 116,7 MM" têm UMA casa
   decimal, e exigir duas fazia o valor ser cortado em "R$ 2" — perdendo junto a
   escala que vinha logo depois. */
const RE_DINHEIRO = /R\$\s?([\d.]{1,15},\d{1,2}|\d[\d.]{0,14})(\s*(?:mil|milh[õo]es?|milh[ãa]o|bilh[õo]es?|bilh[ãa]o|trilh[õo]es?|trilh[ãa]o|MM|mi|bi|k)\b)?/gi;
const RE_DATA = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/g;
const RE_DATA_EXT = /\b(\d{1,2})\s+de\s+(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})\b/gi;
const RE_CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const RE_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const RE_PERCENT = /\b(\d{1,3}(?:,\d{1,2})?)\s?%/g;
/* O número precisa estar COLADO na unidade, admitindo só o extenso entre
   parênteses que o texto jurídico usa ("24 (vinte e quatro) meses"). Um
   intervalo livre de 20 caracteres fazia "3.1. Vigência de 24 meses" ser lido
   como prazo de 3 — número errado com a mesma cara de certo, que é o pior tipo
   de defeito porque não levanta suspeita. */
const RE_PRAZO = /\b(\d{1,4})\s*(?:\([^)\n]{0,40}\)\s*)?(dias?\s+[úu]teis|dias?|meses|m[êe]s|anos?|horas?|semanas?)\b/gi;

const ESCALAS = [
  [/trilh/i, 1e12], [/bilh|(?:^|\s)bi\b/i, 1e9],
  [/milh/i, 1e6], [/\bMM\b/, 1e6], [/(?:^|\s)mi\b/i, 1e6],
  [/\bmil\b/i, 1e3], [/\bk\b/i, 1e3],
];

/** Converte "R$ 47 bilhões" em 47000000000 — para que o MAIOR valor seja o maior de verdade. */
const paraNumero = s => {
  const t = String(s);
  const num = parseFloat(t.replace(/R\$\s?/i, '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
  for (const [re, mult] of ESCALAS) if (re.test(t)) return num * mult;
  return num;
};

/** Um valor só importa se aparece junto de contexto — número solto é ruído. */
function comContexto(texto, re, { max = 12, janela = 60 } = {}) {
  const out = [];
  const vistos = new Set();
  for (const m of texto.matchAll(re)) {
    const bruto = m[0];
    if (vistos.has(bruto)) continue;
    vistos.add(bruto);
    const ini = Math.max(0, m.index - janela);
    const ctx = texto.slice(ini, Math.min(texto.length, m.index + bruto.length + janela)).replace(/\s+/g, ' ').trim();
    out.push({ valor: bruto, contexto: ctx });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Fatos extraídos NA ENTRADA. O ganho não é a extração — é estarem disponíveis
 * antes da primeira leitura, para o agente responder "qual o valor?" sem gastar
 * uma varredura, e para NUNCA citar número de memória.
 */
export function extrairFatos(texto) {
  const t = String(texto || '');
  const dinheiro = comContexto(t, RE_DINHEIRO, { max: 14 });
  const ordenados = [...dinheiro].sort((a, b) => paraNumero(b.valor) - paraNumero(a.valor));

  const datas = [...comContexto(t, RE_DATA, { max: 10 }), ...comContexto(t, RE_DATA_EXT, { max: 6 })];
  const prazos = comContexto(t, RE_PRAZO, { max: 12 })
    // "2 dias" dentro de "em 2 dias úteis" importa; "10 anos" em "há 10 anos" não
    .filter(p => !/\bh[áa]\s*$|atr[áa]s/.test(p.contexto.slice(0, p.contexto.indexOf(p.valor))))
    /* "99,5% ao mês" é TAXA, não prazo. Deixar passar faria o agente relatar um
       prazo de 5 meses que não existe em lugar nenhum do contrato. */
    .filter(p => !p.valor.includes('%'))
    .slice(0, 10);

  return {
    valores: ordenados.slice(0, 10),
    maiorValor: ordenados[0] || null,
    datas: datas.slice(0, 12),
    prazos,
    percentuais: comContexto(t, RE_PERCENT, { max: 10 }),
    cnpj: [...new Set([...t.matchAll(RE_CNPJ)].map(m => m[0]))].slice(0, 6),
    cpf: [...new Set([...t.matchAll(RE_CPF)].map(m => m[0]))].slice(0, 4),
  };
}

/** Bloco curto de fatos para o prompt — só o que muda uma decisão. */
export function fatosTexto(f) {
  if (!f) return '';
  const L = [];
  if (f.maiorValor) L.push(`Maior valor citado: ${f.maiorValor.valor} — «${f.maiorValor.contexto}»`);
  if (f.valores.length > 1) L.push(`Outros valores: ${f.valores.slice(1, 6).map(v => v.valor).join(', ')}`);
  /* Sem dizer o que cada percentual É. Antes a dica afirmava "multa, juros,
     desconto ou reajuste" em TODO documento — numa apresentação comercial,
     onde são participação de mercado e crescimento, isso empurrava o agente
     para uma leitura errada antes mesmo de ele abrir o texto. */
  if (f.percentuais.length) L.push(`Percentuais citados: ${f.percentuais.slice(0, 5).map(p => p.valor).join(', ')} — o texto ao redor diz o que cada um significa; CONFIRA antes de nomear qualquer um.`);
  if (f.prazos.length) L.push(`Prazos: ${f.prazos.slice(0, 5).map(p => p.valor).join(', ')}`);
  if (f.datas.length) L.push(`Datas: ${f.datas.slice(0, 6).map(d => d.valor).join(', ')}`);
  if (f.cnpj.length) L.push(`CNPJ: ${f.cnpj.join(', ')}`);
  if (!L.length) return '';
  return `FATOS LOCALIZADOS NA ENTRADA (extraídos por varredura, não por leitura — SEMPRE confirme no texto antes de afirmar, e cite de onde veio):\n- ${L.join('\n- ')}`;
}

/* ────────────────────── 4. SINÔNIMOS ────────────────────── */

/* Vocabulário do documento comercial e jurídico brasileiro. Cada grupo é uma
   família: perguntar por qualquer termo busca por todos. É a diferença entre
   "não encontrei multa" e achar a "penalidade pecuniária" que estava lá. */
const FAMILIAS = [
  ['multa', 'penalidade', 'penalidades', 'sanção', 'sanções', 'cláusula penal', 'pecuniária', 'infração'],
  ['prazo', 'vigência', 'validade', 'duração', 'período', 'cronograma', 'entrega'],
  ['rescisão', 'rescindir', 'término', 'encerramento', 'denúncia', 'resilição', 'cancelamento'],
  ['pagamento', 'faturamento', 'desembolso', 'remuneração', 'contraprestação', 'parcela', 'fatura'],
  ['valor', 'preço', 'montante', 'importância', 'investimento', 'custo', 'orçamento', 'total'],
  ['reajuste', 'correção', 'atualização monetária', 'índice', 'IPCA', 'IGP-M', 'inflação'],
  ['garantia', 'caução', 'fiança', 'seguro', 'retenção'],
  ['confidencialidade', 'sigilo', 'NDA', 'não divulgação', 'segredo'],
  ['exclusividade', 'exclusivo', 'não concorrência', 'não competição'],
  ['responsabilidade', 'obrigações', 'deveres', 'incumbe', 'compete', 'obriga-se'],
  ['foro', 'jurisdição', 'comarca', 'arbitragem', 'litígio', 'controvérsia'],
  ['SLA', 'nível de serviço', 'disponibilidade', 'indisponibilidade', 'uptime', 'tempo de resposta'],
  ['escopo', 'objeto', 'abrangência', 'entregáveis', 'produtos', 'serviços contratados'],
  ['habilitação', 'qualificação', 'documentação', 'certidão', 'regularidade', 'atestado'],
  ['proposta', 'lance', 'oferta', 'cotação'],
  ['renovação', 'prorrogação', 'aditivo', 'aditamento', 'renovar'],
  ['LGPD', 'dados pessoais', 'proteção de dados', 'titular', 'tratamento de dados'],
  ['reembolso', 'ressarcimento', 'restituição', 'devolução'],
  ['aviso prévio', 'notificação prévia', 'comunicação prévia', 'antecedência'],
];

/**
 * Devolve os termos a buscar. Sempre inclui o original em primeiro lugar — a
 * intenção do operador manda, a expansão só acrescenta.
 */
export function expandirBusca(termo) {
  const alvo = semAcento(String(termo || '').trim());
  if (!alvo) return [];
  const saida = [String(termo).trim()];
  for (const fam of FAMILIAS) {
    const bate = fam.some(p => {
      const pp = semAcento(p);
      return pp === alvo || alvo.includes(pp) || pp.includes(alvo);
    });
    if (!bate) continue;
    for (const p of fam) if (semAcento(p) !== alvo) saida.push(p);
  }
  return [...new Set(saida)];
}

/* ────────────────────── MONTAGEM ────────────────────── */

/** Tudo que o modo DOC descobre sobre um documento, de uma vez, na ingestão. */
export function analisarDocumento(texto, nome = '') {
  const estrutura = mapearEstrutura(texto);
  const natureza = classificarDocumento(texto, nome);
  const fatos = extrairFatos(texto);
  return { estrutura, natureza, fatos };
}
