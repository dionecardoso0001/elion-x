/* ═══════════════════════════════════════════════════════════════════════════
   FORMATOS — o que o modo DOC recusava e passa a ler.

   Todos aqui são Node puro + jszip (já instalado). Nenhuma dependência nova:
   ODT/ODS/ODP, EPUB e ZIP são pacotes ZIP com XML dentro, exatamente como o
   Office moderno; EML é texto RFC 822; ICS e VCF são texto com dobra de linha.

   Cada extrator devolve `{ texto, meta }`. O `meta` viaja porque contexto é
   metade do que o operador precisa: de quem veio o e-mail, quantas planilhas
   tem o arquivo, quais documentos vieram dentro do ZIP.
   ═══════════════════════════════════════════════════════════════════════════ */
import { createRequire } from 'module';
import { decodificarTexto } from './leitor.mjs';

const require = createRequire(import.meta.url);
let JSZip = null;
const zipDe = async buf => {
  if (!JSZip) JSZip = require('jszip');
  return JSZip.loadAsync(buf);
};

const semTags = s => s
  .replace(/<text:line-break[^>]*\/>/g, '\n')
  .replace(/<text:tab[^>]*\/>/g, '\t')
  .replace(/<[^>]+>/g, '');

const entidades = s => (s || '')
  .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ');

const limpar = s => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/* ────────────────────── LIBREOFFICE / OPENDOCUMENT ────────────────────── */

/**
 * ODT/ODS/ODP compartilham content.xml. Trato tabela de verdade: no ODS a
 * planilha inteira é tabela, e no ODT a tabela costuma ser onde mora o preço.
 * Achatar célula em parágrafo perderia a associação coluna↔valor.
 */
export async function extrairOpenDocument(buf, tipo = 'odt') {
  const zip = await zipDe(buf);
  const f = zip.file('content.xml');
  if (!f) throw new Error('não é um arquivo OpenDocument válido (falta content.xml)');
  const xml = await f.async('string');

  const partes = [];
  let nTabelas = 0, nPlanilhas = 0;

  /* Percorre o corpo na ORDEM em que aparece, alternando parágrafo e tabela.
     Processar tudo por tipo separadamente embaralharia o documento. */
  const corpo = (xml.match(/<office:body>([\s\S]*)<\/office:body>/) || [, xml])[1];
  const blocos = corpo.match(/<table:table[ >][\s\S]*?<\/table:table>|<text:[hp][ >][\s\S]*?<\/text:[hp]>|<text:[hp]\/>/g) || [];

  for (const b of blocos) {
    if (b.startsWith('<table:table')) {
      const nome = (b.match(/table:name="([^"]*)"/) || [, ''])[1];
      const linhas = [];
      for (const lin of b.match(/<table:table-row[ >][\s\S]*?<\/table:table-row>/g) || []) {
        const cels = [];
        for (const c of lin.match(/<table:table-cell[ >][\s\S]*?<\/table:table-cell>|<table:table-cell[^>]*\/>/g) || []) {
          // células repetidas são comprimidas num atributo — expandir mantém o alinhamento
          const rep = Math.min(+(c.match(/table:number-columns-repeated="(\d+)"/) || [, 1])[1], 64);
          const txt = limpar(entidades(semTags(c))).replace(/\n+/g, ' ').trim();
          for (let k = 0; k < rep; k++) cels.push(txt);
        }
        while (cels.length && !cels[cels.length - 1]) cels.pop();   // apara colunas vazias à direita
        if (cels.length) linhas.push(cels.join(' | '));
      }
      if (linhas.length) {
        if (tipo === 'ods') { nPlanilhas++; partes.push(`\n━━ Planilha "${nome || 'Aba ' + nPlanilhas}" ━━\n${linhas.join('\n')}`); }
        else { nTabelas++; partes.push(`\n━━ Tabela ${nTabelas}${nome ? ` "${nome}"` : ''} ━━\n${linhas.join('\n')}\n━━ fim da tabela ━━`); }
      }
    } else {
      const t = entidades(semTags(b)).trim();
      if (t) partes.push(b.startsWith('<text:h') ? `\n## ${t}` : t);
    }
  }

  // apresentação: separa por slide, que é o que dá sentido ao ODP
  if (tipo === 'odp') {
    const slides = corpo.match(/<draw:page[ >][\s\S]*?<\/draw:page>/g) || [];
    if (slides.length) {
      const saida = slides.map((s, i) => {
        const t = limpar(entidades(semTags(s)));
        return t ? `\n━━ Slide ${i + 1} ━━\n${t}` : '';
      }).filter(Boolean).join('\n');
      if (saida.trim()) return { texto: limpar(saida), meta: { slides: slides.length } };
    }
  }

  const texto = limpar(partes.join('\n'));
  if (!texto) throw new Error('nenhum texto encontrado no documento OpenDocument');
  return { texto, meta: { tabelas: nTabelas, planilhas: nPlanilhas } };
}

/* ────────────────────── E-MAIL (.eml) ────────────────────── */

function desdobrarCabecalhos(bruto) {
  // RFC 822 permite quebrar um cabeçalho longo em várias linhas indentadas
  const linhas = bruto.split(/\r?\n/);
  const out = [];
  for (const l of linhas) {
    if (/^[ \t]/.test(l) && out.length) out[out.length - 1] += ' ' + l.trim();
    else out.push(l);
  }
  const mapa = new Map();
  for (const l of out) {
    const m = l.match(/^([A-Za-z-]+):\s*([\s\S]*)$/);
    if (m) {
      const k = m[1].toLowerCase();
      mapa.set(k, mapa.has(k) ? mapa.get(k) + ' | ' + m[2] : m[2]);
    }
  }
  return mapa;
}

/** =?UTF-8?B?...?= e =?ISO-8859-1?Q?...?= — assunto acentuado vem sempre assim. */
function decodificarMime(s) {
  return String(s || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, tipo, dado) => {
    try {
      let buf;
      if (tipo.toUpperCase() === 'B') buf = Buffer.from(dado, 'base64');
      else buf = Buffer.from(dado.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
      const cs = charset.toLowerCase();
      if (/utf-?8/.test(cs)) return buf.toString('utf8');
      return decodificarTexto(buf).texto;
    } catch { return dado; }
  }).replace(/\?=\s*=\?/g, '');   // trechos codificados adjacentes
}

function decodificarCorpo(corpo, codificacao, charset) {
  let buf;
  const cod = String(codificacao || '').toLowerCase();
  if (cod.includes('base64')) {
    buf = Buffer.from(corpo.replace(/\s+/g, ''), 'base64');
  } else if (cod.includes('quoted-printable')) {
    const s = corpo
      .replace(/=\r?\n/g, '')                                        // quebra suave
      .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    buf = Buffer.from(s, 'latin1');
  } else {
    buf = Buffer.from(corpo, 'latin1');
  }
  const cs = String(charset || '').toLowerCase();
  if (/utf-?8/.test(cs)) return buf.toString('utf8');
  if (cs) return decodificarTexto(buf).texto;
  return decodificarTexto(buf).texto;
}

const htmlParaTexto = h => entidades(
  h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
   .replace(/<br\s*\/?>/gi, '\n')
   .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
   .replace(/<\/td>/gi, ' | ')
   .replace(/<[^>]+>/g, '')
);

/** .eml → cabeçalhos legíveis + corpo em texto + lista de anexos. */
export function extrairEml(buf) {
  const bruto = buf.toString('latin1');
  const corte = bruto.search(/\r?\n\r?\n/);
  if (corte < 0) throw new Error('arquivo .eml sem separação entre cabeçalho e corpo');
  const cab = desdobrarCabecalhos(bruto.slice(0, corte));
  const corpoBruto = bruto.slice(corte).replace(/^\r?\n\r?\n/, '');

  const tipoConteudo = cab.get('content-type') || 'text/plain';
  const fronteira = (tipoConteudo.match(/boundary="?([^";\s]+)"?/i) || [, null])[1];

  const anexos = [];
  let textoCorpo = '', htmlCorpo = '';

  const tratarParte = (parte) => {
    const c = parte.search(/\r?\n\r?\n/);
    if (c < 0) return;
    const ch = desdobrarCabecalhos(parte.slice(0, c));
    const corpo = parte.slice(c).replace(/^\r?\n\r?\n/, '');
    const ct = ch.get('content-type') || 'text/plain';
    const disp = ch.get('content-disposition') || '';
    const nome = decodificarMime((disp.match(/filename="?([^";]+)"?/i) || ct.match(/name="?([^";]+)"?/i) || [, ''])[1]);

    if (/attachment/i.test(disp) || (nome && !/^text\/(plain|html)/i.test(ct))) {
      anexos.push({ nome: nome || '(sem nome)', tipo: ct.split(';')[0].trim(), bytes: Math.round(corpo.replace(/\s/g, '').length * 0.75) });
      return;
    }
    const sub = (ct.match(/boundary="?([^";\s]+)"?/i) || [, null])[1];
    if (sub) { fatiar(corpo, sub); return; }                        // multipart aninhado

    const charset = (ct.match(/charset="?([^";\s]+)"?/i) || [, ''])[1];
    const txt = decodificarCorpo(corpo, ch.get('content-transfer-encoding'), charset);
    if (/text\/html/i.test(ct)) htmlCorpo ||= txt;
    else textoCorpo ||= txt;
  };

  const fatiar = (corpo, b) => {
    const pedacos = corpo.split(new RegExp(`--${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?\\r?\\n?`));
    for (const p of pedacos) if (p.trim()) tratarParte(p);
  };

  if (fronteira) fatiar(corpoBruto, fronteira);
  else {
    const charset = (tipoConteudo.match(/charset="?([^";\s]+)"?/i) || [, ''])[1];
    const txt = decodificarCorpo(corpoBruto, cab.get('content-transfer-encoding'), charset);
    if (/text\/html/i.test(tipoConteudo)) htmlCorpo = txt; else textoCorpo = txt;
  }

  const corpoFinal = limpar(textoCorpo || htmlParaTexto(htmlCorpo));
  const linhas = [];
  linhas.push('━━ E-MAIL ━━');
  for (const [rot, chave] of [['De', 'from'], ['Para', 'to'], ['Cópia', 'cc'], ['Assunto', 'subject'], ['Data', 'date'], ['Responder para', 'reply-to']]) {
    if (cab.get(chave)) linhas.push(`${rot}: ${decodificarMime(cab.get(chave))}`);
  }
  if (anexos.length) {
    linhas.push(`Anexos (${anexos.length}): ${anexos.map(a => `${a.nome} [${a.tipo}, ~${Math.round(a.bytes / 1024)} KB]`).join(', ')}`);
    linhas.push('⚠ O conteúdo dos anexos NÃO foi lido — peça ao operador para subir o anexo separadamente se ele importar.');
  }
  linhas.push('━━━━━━━━━━━━');
  linhas.push('');
  linhas.push(corpoFinal || '(mensagem sem corpo de texto)');

  return {
    texto: limpar(linhas.join('\n')),
    meta: {
      de: decodificarMime(cab.get('from') || ''),
      assunto: decodificarMime(cab.get('subject') || ''),
      data: cab.get('date') || '',
      anexos: anexos.length,
    },
  };
}

/* ────────────────────── EPUB ────────────────────── */

export async function extrairEpub(buf) {
  const zip = await zipDe(buf);
  const nomes = Object.keys(zip.files);

  // a ordem de leitura mora no OPF; sem ela, os capítulos saem fora de ordem
  const opfNome = nomes.find(n => /\.opf$/i.test(n));
  let ordem = [];
  let titulo = '', autor = '';
  if (opfNome) {
    const opf = await zip.file(opfNome).async('string');
    titulo = entidades((opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i) || [, ''])[1]).trim();
    autor = entidades((opf.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i) || [, ''])[1]).trim();
    const manifesto = new Map();
    for (const m of opf.matchAll(/<item\b[^>]*id="([^"]+)"[^>]*href="([^"]+)"/g)) manifesto.set(m[1], m[2]);
    for (const m of opf.matchAll(/<item\b[^>]*href="([^"]+)"[^>]*id="([^"]+)"/g)) if (!manifesto.has(m[2])) manifesto.set(m[2], m[1]);
    const base = opfNome.includes('/') ? opfNome.slice(0, opfNome.lastIndexOf('/') + 1) : '';
    for (const m of opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)) {
      const href = manifesto.get(m[1]);
      if (href) ordem.push(base + href.replace(/^\.\//, ''));
    }
  }
  if (!ordem.length) ordem = nomes.filter(n => /\.x?html?$/i.test(n)).sort();

  const partes = [];
  for (const n of ordem) {
    const f = zip.file(n) || zip.file(decodeURIComponent(n));
    if (!f) continue;
    const t = limpar(htmlParaTexto(await f.async('string')));
    if (t) partes.push(t);
  }
  const texto = limpar(partes.join('\n\n'));
  if (!texto) throw new Error('nenhum texto encontrado no EPUB');
  return { texto: (titulo ? `━━ ${titulo}${autor ? ` · ${autor}` : ''} ━━\n\n` : '') + texto, meta: { titulo, autor, capitulos: partes.length } };
}

/* ────────────────────── PACOTE ZIP ────────────────────── */

const EXT_TEXTO = /\.(txt|md|csv|json|xml|html?|ya?ml|log|ini|cfg|conf|sql|sh|ps1|bat|js|mjs|ts|tsx|jsx|py|java|cs|c|cpp|h|go|rb|php|css|svg)$/i;

/**
 * ZIP não é "um documento": é uma PASTA. Devolvo o inventário sempre, e o
 * conteúdo dos arquivos de texto até um teto — assim o operador vê o que veio
 * e pede o que interessa, em vez de receber um despejo de megabytes.
 */
export async function extrairZip(buf, { maxTexto = 120000, maxArquivos = 40 } = {}) {
  const zip = await zipDe(buf);
  const itens = Object.keys(zip.files)
    .filter(n => !zip.files[n].dir && !/^__MACOSX\//.test(n) && !/\/\.DS_Store$/.test(n))
    .sort();
  if (!itens.length) throw new Error('o arquivo compactado está vazio');

  const linhas = [`━━ PACOTE COMPACTADO · ${itens.length} arquivo(s) ━━`];
  for (const n of itens.slice(0, 200)) {
    const info = zip.files[n];
    const tam = info._data?.uncompressedSize ?? 0;
    linhas.push(`  ${n}${tam ? `  (${tam >= 1048576 ? (tam / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(tam / 1024)) + ' KB'})` : ''}`);
  }
  if (itens.length > 200) linhas.push(`  … e mais ${itens.length - 200} arquivo(s)`);

  const legiveis = itens.filter(n => EXT_TEXTO.test(n));
  const pesados = itens.filter(n => /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|png|jpe?g|epub|eml)$/i.test(n));

  linhas.push('');
  if (pesados.length) {
    linhas.push(`📄 ${pesados.length} documento(s) que eu leio, mas só um de cada vez: ${pesados.slice(0, 12).join(', ')}${pesados.length > 12 ? '…' : ''}`);
    linhas.push('   Diga qual deles interessa e peça ao operador para subir esse arquivo — ou peça que eu extraia do pacote.');
    linhas.push('');
  }

  let usado = 0, lidos = 0;
  for (const n of legiveis) {
    if (lidos >= maxArquivos || usado >= maxTexto) break;
    const conteudo = await zip.file(n).async('nodebuffer');
    const { texto } = decodificarTexto(conteudo);
    const t = texto.trim();
    if (!t) continue;
    const espaco = Math.max(0, maxTexto - usado);
    const corte = t.length > espaco ? t.slice(0, espaco) + `\n… (arquivo truncado: ${t.length} caracteres no total)` : t;
    linhas.push(`\n━━ ${n} ━━\n${corte}`);
    usado += corte.length; lidos++;
  }
  const naoLidos = legiveis.length - lidos;
  if (naoLidos > 0) linhas.push(`\n⚠ ${naoLidos} arquivo(s) de texto não couberam nesta leitura. Peça um específico pelo nome.`);

  return { texto: limpar(linhas.join('\n')), meta: { arquivos: itens.length, lidos, documentos: pesados.length } };
}

/* ────────────────────── CALENDÁRIO E CONTATO ────────────────────── */

const desdobrarIcs = s => s.replace(/\r?\n[ \t]/g, '');
const dataIcs = v => {
  const m = String(v).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (!m) return v;
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` às ${m[4]}:${m[5]}` : ''}`;
};

export function extrairIcs(buf) {
  const s = desdobrarIcs(decodificarTexto(buf).texto);
  const eventos = s.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  if (!eventos.length) throw new Error('nenhum evento encontrado no arquivo de calendário');
  const linhas = [`━━ CALENDÁRIO · ${eventos.length} evento(s) ━━`];
  for (const ev of eventos) {
    const campo = k => (ev.match(new RegExp(`^${k}[^:]*:(.*)$`, 'm')) || [, ''])[1].replace(/\\,/g, ',').replace(/\\n/g, ' ').trim();
    linhas.push('');
    linhas.push(`• ${campo('SUMMARY') || '(sem título)'}`);
    if (campo('DTSTART')) linhas.push(`  Início: ${dataIcs(campo('DTSTART'))}`);
    if (campo('DTEND')) linhas.push(`  Fim: ${dataIcs(campo('DTEND'))}`);
    if (campo('LOCATION')) linhas.push(`  Local: ${campo('LOCATION')}`);
    if (campo('ORGANIZER')) linhas.push(`  Organizador: ${campo('ORGANIZER').replace(/^mailto:/i, '')}`);
    const convidados = [...ev.matchAll(/^ATTENDEE[^:]*:(.*)$/gm)].map(m => m[1].replace(/^mailto:/i, '').trim());
    if (convidados.length) linhas.push(`  Convidados (${convidados.length}): ${convidados.slice(0, 15).join(', ')}`);
    if (campo('DESCRIPTION')) linhas.push(`  Descrição: ${campo('DESCRIPTION')}`);
  }
  return { texto: linhas.join('\n'), meta: { eventos: eventos.length } };
}

export function extrairVcf(buf) {
  const s = desdobrarIcs(decodificarTexto(buf).texto);
  const cartoes = s.match(/BEGIN:VCARD[\s\S]*?END:VCARD/g) || [];
  if (!cartoes.length) throw new Error('nenhum contato encontrado no arquivo');
  const linhas = [`━━ CONTATOS · ${cartoes.length} ━━`];
  for (const c of cartoes) {
    const campo = k => (c.match(new RegExp(`^${k}[^:]*:(.*)$`, 'm')) || [, ''])[1].trim();
    const todos = k => [...c.matchAll(new RegExp(`^${k}[^:]*:(.*)$`, 'gm'))].map(m => m[1].trim()).filter(Boolean);
    linhas.push('');
    linhas.push(`• ${campo('FN') || campo('N').split(';').filter(Boolean).reverse().join(' ') || '(sem nome)'}`);
    if (campo('ORG')) linhas.push(`  Empresa: ${campo('ORG').replace(/;/g, ' · ')}`);
    if (campo('TITLE')) linhas.push(`  Cargo: ${campo('TITLE')}`);
    const tels = todos('TEL'), mails = todos('EMAIL');
    if (tels.length) linhas.push(`  Telefone: ${tels.join(', ')}`);
    if (mails.length) linhas.push(`  E-mail: ${mails.join(', ')}`);
    if (campo('ADR')) linhas.push(`  Endereço: ${campo('ADR').split(';').filter(Boolean).join(', ')}`);
    if (campo('NOTE')) linhas.push(`  Nota: ${campo('NOTE')}`);
  }
  return { texto: linhas.join('\n'), meta: { contatos: cartoes.length } };
}
