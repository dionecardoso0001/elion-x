/* ═══════════════════════════════════════════════════════════════════════════
   LEITOR — o que precisa acontecer ANTES de qualquer extração de texto.

   O modo DOC fazia `buffer.toString('utf8')` em todo arquivo de texto. Isso não
   é uma escolha discutível: um .csv ou .txt gravado pelo Excel brasileiro vem em
   Windows-1252, e decodificá-lo como UTF-8 transforma "Prestação" em "Presta��o"
   — de forma irreversível, porque o byte inválido vira U+FFFD e a informação
   original se perde. O operador subiria um contrato e leria lixo.

   Aqui moram três coisas que todo formato precisa antes de ser interpretado:

     1. CODIFICAÇÃO — descobrir se é UTF-8, UTF-16 ou uma página de código de
        byte único, e decodificar certo.
     2. NATUREZA    — isto é texto mesmo, ou é binário fingindo ser? Binário
        despejado no contexto do modelo é ruído caro e perigoso.
     3. FORMA       — CSV com ponto-e-vírgula e decimal por vírgula é a norma no
        Brasil e vira tabela ilegível se tratado como texto corrido.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ────────────────────── 1. CODIFICAÇÃO ────────────────────── */

/** Assinaturas de byte (BOM) — quando existem, não há o que adivinhar. */
function lerBOM(buf) {
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return { nome: 'utf8', pula: 3 };
  if (buf.length >= 4 && buf[0] === 0xFF && buf[1] === 0xFE && buf[2] === 0x00 && buf[3] === 0x00) return { nome: 'utf32le', pula: 4 };
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return { nome: 'utf16le', pula: 2 };
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return { nome: 'utf16be', pula: 2 };
  return null;
}

/**
 * UTF-8 é auto-verificável: a gramática das sequências multibyte é rígida o
 * bastante para que texto latin1 com acento quase nunca passe por ela. Validar
 * é muito mais confiável do que estatística de frequência.
 */
function pareceUtf8(buf) {
  let i = 0, multibyte = 0;
  const n = Math.min(buf.length, 262144);   // 256 KB bastam para decidir
  while (i < n) {
    const b = buf[i];
    if (b < 0x80) { i++; continue; }
    let extras;
    if ((b & 0xE0) === 0xC0) extras = 1;
    else if ((b & 0xF0) === 0xE0) extras = 2;
    else if ((b & 0xF8) === 0xF0) extras = 3;
    else return { ok: false, multibyte };     // 0x80-0xBF solto ou 0xF8+ → não é UTF-8
    // sequência cortada no fim da amostra não invalida o arquivo
    if (i + extras >= n) return { ok: true, multibyte };
    for (let k = 1; k <= extras; k++) {
      if ((buf[i + k] & 0xC0) !== 0x80) return { ok: false, multibyte };
    }
    // sobrelonga (C0/C1) é sinal clássico de arquivo forjado ou mal convertido
    if (b === 0xC0 || b === 0xC1) return { ok: false, multibyte };
    multibyte++;
    i += extras + 1;
  }
  return { ok: true, multibyte };
}

/**
 * Entre Windows-1252 e ISO-8859-1 a diferença está na faixa 0x80–0x9F: na 1252
 * ela guarda aspas curvas, travessão e o símbolo do euro, que o Word e o Excel
 * espalham por todo documento brasileiro. Na 8859-1 essa faixa é de controle e
 * não aparece em texto real. Logo: viu byte ali, é 1252.
 */
function pareceWin1252(buf) {
  const n = Math.min(buf.length, 262144);
  for (let i = 0; i < n; i++) if (buf[i] >= 0x80 && buf[i] <= 0x9F) return true;
  return false;
}

/** UTF-16 sem BOM se denuncia pela densidade de zeros em posições alternadas. */
function pareceUtf16SemBOM(buf) {
  const n = Math.min(buf.length, 4096);
  if (n < 16) return null;
  let zerosPar = 0, zerosImpar = 0;
  for (let i = 0; i < n; i++) {
    if (buf[i] !== 0) continue;
    if (i % 2) zerosImpar++; else zerosPar++;
  }
  const metade = n / 2;
  if (zerosImpar > metade * 0.3 && zerosPar < metade * 0.05) return 'utf16le';
  if (zerosPar > metade * 0.3 && zerosImpar < metade * 0.05) return 'utf16be';
  return null;
}

/* Windows-1252 não é embutida no Node (só latin1, que difere justamente na faixa
   que mais aparece em documento de escritório). Esta tabela cobre 0x80–0x9F. */
const CP1252_ALTO = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8A: 'Š', 0x8B: '‹', 0x8C: 'Œ', 0x8E: 'Ž',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•',
  0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›',
  0x9C: 'œ', 0x9E: 'ž', 0x9F: 'Ÿ',
};

function decodificarCp1252(buf) {
  let s = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    s += b >= 0x80 && b <= 0x9F ? (CP1252_ALTO[b] ?? '�') : String.fromCharCode(b);
  }
  return s;
}

function trocarBytes(buf) {
  const out = Buffer.allocUnsafe(buf.length - (buf.length % 2));
  for (let i = 0; i + 1 < buf.length; i += 2) { out[i] = buf[i + 1]; out[i + 1] = buf[i]; }
  return out;
}

/**
 * Decodifica um buffer para texto descobrindo a codificação.
 * Devolve { texto, codificacao, confianca } — a codificação viaja junto porque
 * o operador merece saber quando eu ADIVINHEI em vez de ter certeza.
 */
export function decodificarTexto(buf) {
  if (!buf || !buf.length) return { texto: '', codificacao: 'vazio', confianca: 'certa' };

  const bom = lerBOM(buf);
  if (bom) {
    const corpo = buf.subarray(bom.pula);
    if (bom.nome === 'utf8')    return { texto: corpo.toString('utf8'), codificacao: 'UTF-8 (BOM)', confianca: 'certa' };
    if (bom.nome === 'utf16le') return { texto: corpo.toString('utf16le'), codificacao: 'UTF-16LE (BOM)', confianca: 'certa' };
    if (bom.nome === 'utf16be') return { texto: trocarBytes(corpo).toString('utf16le'), codificacao: 'UTF-16BE (BOM)', confianca: 'certa' };
    if (bom.nome === 'utf32le') return { texto: corpo.toString('utf8'), codificacao: 'UTF-32LE (não suportada — lida como UTF-8)', confianca: 'baixa' };
  }

  const u16 = pareceUtf16SemBOM(buf);
  if (u16 === 'utf16le') return { texto: buf.toString('utf16le'), codificacao: 'UTF-16LE', confianca: 'alta' };
  if (u16 === 'utf16be') return { texto: trocarBytes(buf).toString('utf16le'), codificacao: 'UTF-16BE', confianca: 'alta' };

  const u8 = pareceUtf8(buf);
  if (u8.ok) {
    /* ASCII puro é válido como UTF-8 e como qualquer página de código — dá no
       mesmo, então não há incerteza que valha reportar. */
    return {
      texto: buf.toString('utf8'),
      codificacao: u8.multibyte ? 'UTF-8' : 'ASCII',
      confianca: 'alta',
    };
  }

  // não é UTF-8 válido: é página de código de byte único
  const win = pareceWin1252(buf);
  return {
    texto: win ? decodificarCp1252(buf) : buf.toString('latin1'),
    codificacao: win ? 'Windows-1252' : 'ISO-8859-1',
    confianca: 'alta',
  };
}

/* ────────────────────── 2. NATUREZA ────────────────────── */

/**
 * Binário disfarçado de texto. O sinal decisivo é o byte NUL: nenhuma
 * codificação de texto de byte único o produz, e o UTF-16 já foi tratado antes
 * de chegar aqui. Bytes de controle raros reforçam.
 */
export function pareceBinario(buf) {
  const n = Math.min(buf.length, 8192);
  if (!n) return false;
  if (lerBOM(buf) || pareceUtf16SemBOM(buf)) return false;
  let controle = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return true;                                  // NUL → binário
    if (b < 0x09 || (b > 0x0D && b < 0x20) || b === 0x7F) controle++;
  }
  return controle / n > 0.05;
}

/** Assinaturas de arquivo, para dizer ao operador O QUE ele subiu de verdade. */
const ASSINATURAS = [
  { bytes: [0x25, 0x50, 0x44, 0x46], nome: 'PDF', ext: 'pdf' },
  { bytes: [0x50, 0x4B, 0x03, 0x04], nome: 'ZIP (ou DOCX/XLSX/PPTX/ODT/EPUB)', ext: 'zip' },
  { bytes: [0xD0, 0xCF, 0x11, 0xE0], nome: 'Office antigo OLE (.doc/.xls/.ppt/.msg)', ext: 'ole' },
  { bytes: [0x89, 0x50, 0x4E, 0x47], nome: 'PNG', ext: 'png' },
  { bytes: [0xFF, 0xD8, 0xFF], nome: 'JPEG', ext: 'jpg' },
  { bytes: [0x47, 0x49, 0x46, 0x38], nome: 'GIF', ext: 'gif' },
  { bytes: [0x42, 0x4D], nome: 'BMP', ext: 'bmp' },
  { bytes: [0x49, 0x49, 0x2A, 0x00], nome: 'TIFF', ext: 'tif' },
  { bytes: [0x4D, 0x4D, 0x00, 0x2A], nome: 'TIFF', ext: 'tif' },
  { bytes: [0x52, 0x61, 0x72, 0x21], nome: 'RAR', ext: 'rar' },
  { bytes: [0x37, 0x7A, 0xBC, 0xAF], nome: '7-Zip', ext: '7z' },
  { bytes: [0x1F, 0x8B], nome: 'GZIP', ext: 'gz' },
  { bytes: [0x7B, 0x5C, 0x72, 0x74], nome: 'RTF', ext: 'rtf' },
  { bytes: [0x53, 0x51, 0x4C, 0x69], nome: 'SQLite', ext: 'sqlite' },
];

/** Identifica o formato pelos bytes iniciais — a extensão pode estar mentindo. */
export function assinaturaDe(buf) {
  if (!buf || buf.length < 2) return null;
  for (const a of ASSINATURAS) {
    if (a.bytes.every((b, i) => buf[i] === b)) return a;
  }
  // WEBP e HEIC ficam deslocados: o tipo mora nos bytes 8..11
  const marca = buf.subarray(8, 12).toString('latin1');
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && marca === 'WEBP') return { nome: 'WebP', ext: 'webp' };
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    if (/heic|heix|hevc|mif1/.test(marca)) return { nome: 'HEIC (foto de iPhone)', ext: 'heic' };
    return { nome: 'MP4/QuickTime', ext: 'mp4' };
  }
  return null;
}

/* ────────────────────── 3. FORMA — CSV ────────────────────── */

/**
 * Descobre o separador contando candidatos FORA de aspas e premiando o que
 * produz o mesmo número de colunas em todas as linhas. Contar ocorrências cruas
 * elegeria a vírgula em qualquer CSV brasileiro, onde ela é o separador decimal
 * de todo valor em reais.
 */
export function detectarSeparador(texto) {
  const linhas = texto.split(/\r?\n/).filter(l => l.trim()).slice(0, 25);
  if (!linhas.length) return ',';
  let melhor = ',', melhorNota = -1;
  for (const sep of [';', ',', '\t', '|']) {
    const contagens = linhas.map(l => dividirLinhaCsv(l, sep).length);
    const cols = contagens[0];
    if (cols < 2) continue;
    const consistentes = contagens.filter(c => c === cols).length / contagens.length;
    // consistência pesa muito mais que número de colunas
    const nota = consistentes * 100 + Math.min(cols, 20);
    if (nota > melhorNota) { melhorNota = nota; melhor = sep; }
  }
  return melhor;
}

/** Divide respeitando aspas e aspas escapadas ("") — campo com separador dentro é comum. */
export function dividirLinhaCsv(linha, sep) {
  const out = [];
  let atual = '', dentro = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentro && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentro = !dentro;
    } else if (c === sep && !dentro) { out.push(atual); atual = ''; }
    else atual += c;
  }
  out.push(atual);
  return out;
}

/**
 * CSV vira tabela alinhada e anotada. Texto corrido separado por ponto-e-vírgula
 * o modelo até lê, mas erra a associação coluna↔valor quando há célula vazia —
 * e numa planilha de preço isso é o erro que custa dinheiro.
 */
export function csvParaTabela(texto, { maxLinhas = 400 } = {}) {
  const sep = detectarSeparador(texto);
  const linhas = texto.split(/\r?\n/).filter(l => l.trim());
  if (!linhas.length) return { texto: '', colunas: 0, linhas: 0, separador: sep };

  const grade = linhas.map(l => dividirLinhaCsv(l, sep).map(c => c.trim().replace(/^"|"$/g, '')));
  const nCols = Math.max(...grade.map(r => r.length));
  const cab = grade[0];
  const corpo = grade.slice(1);
  const mostradas = corpo.slice(0, maxLinhas);

  const nomeCol = i => (cab[i] && cab[i].trim()) || `coluna ${i + 1}`;
  const partes = [];
  partes.push(`TABELA · ${nCols} coluna(s) · ${corpo.length} linha(s) de dados · separador "${sep === '\t' ? 'TAB' : sep}"`);
  partes.push(`COLUNAS: ${Array.from({ length: nCols }, (_, i) => nomeCol(i)).join(' | ')}`);
  partes.push('');
  for (let r = 0; r < mostradas.length; r++) {
    /* Cada linha sai rotulada campo a campo. Ocupa mais espaço que a grade
       crua, e é justamente o que impede o modelo de deslizar uma coluna quando
       uma célula vem vazia. */
    const campos = [];
    for (let c = 0; c < nCols; c++) {
      const v = mostradas[r][c];
      if (v !== undefined && v !== '') campos.push(`${nomeCol(c)}: ${v}`);
    }
    partes.push(`[linha ${r + 2}] ${campos.join(' · ') || '(vazia)'}`);
  }
  if (corpo.length > mostradas.length) {
    partes.push('');
    partes.push(`⚠ Mostrei ${mostradas.length} das ${corpo.length} linhas. As demais existem no arquivo — use read_document com query para buscar dentro delas, ou peça a parte seguinte.`);
  }
  return { texto: partes.join('\n'), colunas: nCols, linhas: corpo.length, separador: sep };
}
