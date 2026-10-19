const assert = require('node:assert/strict');
const { test } = require('node:test');
const { identifyReceipt, validateIdempotencyKey } = require('../dist/domain/paymentReceipt');

test('accepts PDF, JPEG, and PNG receipts based on their content signatures', () => {
  assert.equal(identifyReceipt(Buffer.from('%PDF-1.7')).mimeType, 'application/pdf');
  assert.equal(identifyReceipt(Buffer.from([0xff, 0xd8, 0xff, 0x00])).mimeType, 'image/jpeg');
  assert.equal(
    identifyReceipt(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).mimeType,
    'image/png'
  );
});

test('rejects file contents that do not match a supported receipt format', () => {
  assert.throws(() => identifyReceipt(Buffer.from('not an image')), /PDF, JPG o PNG válido/);
});

test('requires a bounded idempotency key with safe characters', () => {
  assert.equal(validateIdempotencyKey('order-123-attempt-1'), 'order-123-attempt-1');
  assert.throws(() => validateIdempotencyKey(undefined), /Idempotency-Key es obligatorio/);
  assert.throws(() => validateIdempotencyKey('bad key'), /Idempotency-Key es obligatorio/);
  assert.throws(() => validateIdempotencyKey('a'.repeat(101)), /Idempotency-Key es obligatorio/);
});
