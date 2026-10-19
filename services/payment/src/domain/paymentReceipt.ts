import { createHash } from 'crypto';

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

const ALLOWED_RECEIPTS = new Map<string, { mimeType: string; extension: string }>([
  ['application/pdf', { mimeType: 'application/pdf', extension: 'pdf' }],
  ['image/jpeg', { mimeType: 'image/jpeg', extension: 'jpg' }],
  ['image/png', { mimeType: 'image/png', extension: 'png' }],
]);

export function identifyReceipt(buffer: Buffer): { mimeType: string; extension: string; sha256: string } {
  let detected: { mimeType: string; extension: string } | undefined;
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    detected = ALLOWED_RECEIPTS.get('application/pdf');
  } else if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    detected = ALLOWED_RECEIPTS.get('image/jpeg');
  } else if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    detected = ALLOWED_RECEIPTS.get('image/png');
  }
  if (!detected) throw new Error('El comprobante debe ser un archivo PDF, JPG o PNG válido.');
  return {
    ...detected,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

export function validateIdempotencyKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new Error('El encabezado Idempotency-Key es obligatorio y debe tener hasta 100 caracteres válidos.');
  }
  return key;
}
