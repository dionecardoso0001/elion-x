/**
 * PIX "COPIA E COLA" (BR Code estático com valor)
 *
 * Monta o payload EMV do Manual de Padrões para Iniciação do Pix (Banco
 * Central): cada campo é ID(2) + TAMANHO(2) + VALOR, e o último campo (63)
 * é o CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF) de todo o resto.
 *
 * Com o valor e o identificador do pedido (txid) embutidos, o cliente não
 * digita nada errado e o pedido fica identificável no extrato — quando o
 * banco do recebedor exibe o txid de QR estático (nem todos exibem).
 */

const field = (id, value) => {
  const v = String(value);
  if (v.length > 99) throw new Error(`campo Pix ${id} longo demais`);
  return `${id}${String(v.length).padStart(2, '0')}${v}`;
};

export function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Remove acentos e caracteres fora do conjunto aceito pelos leitores de QR dos bancos. */
const ascii = (s, max) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .\-]/g, '').trim().slice(0, max);

export function pixPayload({ key, name, city, amountCents, txid, description }) {
  if (!key) throw new Error('chave Pix ausente');
  const account = field('00', 'br.gov.bcb.pix') + field('01', key) + (description ? field('02', ascii(description, 40)) : '');
  const tx = String(txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  const body =
    field('00', '01') +
    field('26', account) +
    field('52', '0000') +
    field('53', '986') +
    (amountCents ? field('54', (amountCents / 100).toFixed(2)) : '') +
    field('58', 'BR') +
    field('59', ascii(name, 25) || 'RECEBEDOR') +
    field('60', ascii(city, 15) || 'BRASIL') +
    field('62', field('05', tx)) +
    '6304';
  return body + crc16(body);
}

/** Mascara a chave para exibição em logs/painel (nunca necessário no QR). */
export const maskKey = k => (k.length <= 8 ? '****' : `${k.slice(0, 3)}…${k.slice(-4)}`);
