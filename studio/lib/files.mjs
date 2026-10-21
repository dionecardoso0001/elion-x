/**
 * ARQUIVOS — fotos do cliente (entrada) e material pronto (entrega).
 *
 * - Gravação em streaming direto para o disco, com limite de bytes: um
 *   upload enorme é cortado antes de lotar memória ou disco.
 * - O tipo é decidido pelos BYTES do arquivo (assinatura), nunca pelo nome
 *   ou pelo Content-Type que o navegador declara.
 * - Nome no disco é aleatório: o nome original nunca vira caminho
 *   (path traversal) e fica guardado só como rótulo.
 * - Fotos JPEG do cliente têm metadados EXIF/XMP/IPTC removidos (podem
 *   conter GPS da casa do cliente). O navegador já reconverte a foto via
 *   canvas; isto aqui é a segunda barreira, para quem pular o navegador.
 * - Download por URL assinada com validade curta (HMAC), porque <video> e
 *   <img> não conseguem mandar cabeçalho Authorization.
 */
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { randomToken, hmacHex, safeEqual } from './crypto.mjs';

export const TYPES = {
  jpg: { mime: 'image/jpeg', kind: 'image' },
  png: { mime: 'image/png', kind: 'image' },
  webp: { mime: 'image/webp', kind: 'image' },
  mp4: { mime: 'video/mp4', kind: 'video' },
  mov: { mime: 'video/quicktime', kind: 'video' },
  webm: { mime: 'video/webm', kind: 'video' },
  zip: { mime: 'application/zip', kind: 'file' },
  pdf: { mime: 'application/pdf', kind: 'file' },
};

/** Identifica o tipo pelos primeiros bytes. */
export function sniff(buf) {
  const hex = buf.subarray(0, 12).toString('hex');
  const ascii = buf.subarray(0, 12).toString('latin1');
  if (hex.startsWith('ffd8ff')) return 'jpg';
  if (hex.startsWith('89504e470d0a1a0a')) return 'png';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'webp';
  if (ascii.slice(4, 8) === 'ftyp') return ascii.slice(8, 10) === 'qt' ? 'mov' : 'mp4';
  if (hex.startsWith('1a45dfa3')) return 'webm';
  if (hex.startsWith('504b0304')) return 'zip';
  if (ascii.startsWith('%PDF-')) return 'pdf';
  return null;
}

/** Remove segmentos APP1 (EXIF/XMP) e APP13 (IPTC) de um JPEG. */
export function stripJpegMetadata(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return buf; // estrutura inesperada: devolve intacto
    const marker = buf[i + 1];
    if (marker === 0xda) { out.push(buf.subarray(i)); return Buffer.concat(out); } // início da imagem
    const len = buf.readUInt16BE(i + 2);
    const seg = buf.subarray(i, i + 2 + len);
    if (marker !== 0xe1 && marker !== 0xed) out.push(seg);
    i += 2 + len;
  }
  return buf;
}

export class UploadError extends Error { constructor(status, message) { super(message); this.status = status; } }

/**
 * Grava o corpo da requisição em `dir` e devolve os metadados.
 * `allowed`: extensões aceitas; `maxBytes`: limite rígido.
 */
export async function saveUpload(req, { dir, allowed, maxBytes, label }) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > maxBytes) throw new UploadError(413, `arquivo acima do limite de ${Math.round(maxBytes / 1048576)} MB`);

  const id = randomToken(12);
  const tmp = join(dir, `${id}.part`);
  let size = 0;
  let head = Buffer.alloc(0);
  const guard = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > maxBytes) return cb(new UploadError(413, `arquivo acima do limite de ${Math.round(maxBytes / 1048576)} MB`));
      if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16)]);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(req, guard, createWriteStream(tmp, { mode: 0o600 }));
  } catch (e) {
    await rm(tmp, { force: true });
    throw e instanceof UploadError ? e : new UploadError(400, 'upload interrompido');
  }
  const ext = sniff(head);
  if (!size || !ext || !allowed.includes(ext)) {
    await rm(tmp, { force: true });
    throw new UploadError(415, `tipo de arquivo não aceito (permitidos: ${allowed.join(', ')})`);
  }
  const file = `${id}.${ext}`;
  if (ext === 'jpg') {
    const clean = stripJpegMetadata(await readFile(tmp));
    await writeFile(tmp, clean, { mode: 0o600 });
    size = clean.length;
  }
  await rename(tmp, join(dir, file));
  const safeLabel = String(label || '').replace(/[^\p{L}\p{N} ._()\-]/gu, '').trim().slice(0, 80) || `Arquivo ${ext.toUpperCase()}`;
  return { id, file, ext, kind: TYPES[ext].kind, mime: TYPES[ext].mime, size, label: safeLabel, at: new Date().toISOString() };
}

/* ── URLs assinadas ─────────────────────────────────────────────────── */
export function signFileUrl(secret, orderId, fileId, ttlSec = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = hmacHex(secret, `${orderId}/${fileId}/${exp}`);
  return `/api/files/${orderId}/${fileId}?exp=${exp}&sig=${sig}`;
}

export function verifyFileUrl(secret, orderId, fileId, exp, sig) {
  const e = Number(exp);
  if (!Number.isInteger(e) || e < Date.now() / 1000 || !sig) return false;
  return safeEqual(sig, hmacHex(secret, `${orderId}/${fileId}/${e}`));
}

/** Envia o arquivo com suporte a Range (o Safari exige isso para tocar vídeo). */
export async function sendFile(req, res, path, { mime, download, label, ext }) {
  const { size } = await stat(path);
  const headers = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=600',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(label || 'arquivo')}.${ext}`,
  };
  const range = String(req.headers.range || '').match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    if (start < 0) start = 0;
    if (start >= size || end < start) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    end = Math.min(end, size - 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return pipeline(createReadStream(path, { start, end }), res).catch(() => {});
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  return pipeline(createReadStream(path), res).catch(() => {});
}
