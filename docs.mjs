/**
 * ELION-X · Extração de documentos (PDF, DOCX, PPTX, TXT)
 * PDF: pdf-parse (texto) — fallback p/ Claude nativo quando for digitalizado
 * DOCX/PPTX: leitura do ZIP interno (Office Open XML) + extração de texto
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let JSZip = null, pdfParse = null;

const decodeEntities = s => (s || '')
  .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** Word .docx → texto (parágrafos de word/document.xml) */
export async function extractDocx(buffer) {
  if (!JSZip) JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('estrutura .docx inválida');
  const xml = await f.async('string');
  const paras = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
  let out = '';
  for (const p of paras) {
    const texts = [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => decodeEntities(m[1]));
    out += texts.join('') + '\n';
  }
  // tabelas e cabeçalhos já entram como parágrafos; limpa excesso de linhas
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** PowerPoint .pptx → texto por slide (ppt/slides/slideN.xml) */
export async function extractPptx(buffer) {
  if (!JSZip) JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => (+a.match(/slide(\d+)/)[1]) - (+b.match(/slide(\d+)/)[1]));
  let out = '';
  for (let i = 0; i < slides.length; i++) {
    const xml = await zip.file(slides[i]).async('string');
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => decodeEntities(m[1]).trim()).filter(Boolean);
    if (texts.length) out += `\n━━ Slide ${i + 1} ━━\n${texts.join('\n')}\n`;
  }
  if (!out.trim()) throw new Error('nenhum texto encontrado nos slides');
  return out.trim();
}

/** PDF → texto (pdf-parse). Retorna {text, pages}. */
export async function extractPdf(buffer) {
  if (!pdfParse) pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);
  return { text: (data.text || '').replace(/\n{3,}/g, '\n\n').trim(), pages: data.numpages || 0 };
}

/** Excel .xlsx → texto por planilha, células separadas por " | ".
    Sem dependência nova: .xlsx é um ZIP de XML, igual ao docx/pptx. */
export async function extractXlsx(buffer) {
  if (!JSZip) JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);

  // strings compartilhadas: as células de texto guardam só um ÍNDICE para cá
  const shared = [];
  const ss = zip.file('xl/sharedStrings.xml');
  if (ss) {
    const xml = await ss.async('string');
    // <si> pode ter vários <t> (texto formatado por trechos) — junta todos
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => decodeEntities(t[1])).join(''));
    }
  }

  // nomes das abas, na ordem do workbook
  const nomes = [];
  const wb = zip.file('xl/workbook.xml');
  if (wb) {
    const xml = await wb.async('string');
    for (const m of xml.matchAll(/<sheet [^>]*name="([^"]*)"/g)) nomes.push(decodeEntities(m[1]));
  }

  const abas = Object.keys(zip.files)
    .filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
    .sort((a, b) => (+a.match(/sheet(\d+)/)[1]) - (+b.match(/sheet(\d+)/)[1]));

  let out = '';
  for (let i = 0; i < abas.length; i++) {
    const xml = await zip.file(abas[i]).async('string');
    const linhas = [];
    for (const row of xml.matchAll(/<row[ >][\s\S]*?<\/row>/g)) {
      const cels = [];
      /* atributos capturados por inteiro e t="…" extraído depois: com o
         grupo opcional embutido, o regex "pulava" o t quando ele não vinha
         logo após o <c (ex.: <c r="A1" t="s">) e as células de texto saíam
         como ÍNDICES numéricos em vez das palavras */
      for (const c of row[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const tipo = (/(?:^|\s)t="([^"]*)"/.exec(c[1]) || [, ''])[1];
        const vm = c[2].match(/<v>([\s\S]*?)<\/v>/) || c[2].match(/<t[^>]*>([\s\S]*?)<\/t>/);
        if (!vm) { cels.push(''); continue; }
        const bruto = decodeEntities(vm[1]);
        // t="s" = índice em sharedStrings; o resto é valor literal (número, data serial, fórmula calculada)
        cels.push(tipo === 's' ? (shared[+bruto] ?? bruto) : bruto);
      }
      const linha = cels.join(' | ').replace(/(\s*\|\s*)+$/, '').trim();
      if (linha) linhas.push(linha);
    }
    if (linhas.length) out += `\n━━ Planilha "${nomes[i] || 'Aba ' + (i + 1)}" ━━\n${linhas.join('\n')}\n`;
  }
  if (!out.trim()) throw new Error('nenhum dado encontrado nas planilhas');
  return out.trim();
}
