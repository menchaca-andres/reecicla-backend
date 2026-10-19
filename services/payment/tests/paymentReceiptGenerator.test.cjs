const assert = require('node:assert/strict');
const { test } = require('node:test');
const { generatePaymentReceipt } = require('../dist/domain/paymentReceiptGenerator');

test('generates a PDF receipt containing payment identity and a bank-proof disclaimer', async () => {
  const pdf = await generatePaymentReceipt({
    paymentId: '79fbec1c-9dcb-48df-9862-a25cc1e1ad47',
    tenantId: 'cba8f143-2cec-45a1-b4ba-55ca2c41d41c',
    orderNumber: 'ORD-2026-42',
    amount: 125.5,
    currency: 'BOB',
    method: 'BANK_TRANSFER',
    reference: 'TRX-123',
    paidByUserId: 'aa0ba5e1-a118-4565-8e3b-b4c53b14b532',
    paidByUserName: 'Operadora de prueba',
    paidAt: new Date('2026-10-18T12:00:00.000Z'),
  });
  const content = pdf.toString('latin1');
  const encodedText = [...content.matchAll(/<([0-9a-f]+)>/gi)]
    .map(([, text]) => text)
    .join('');
  assert.ok(content.startsWith('%PDF-'));
  assert.ok(encodedText.includes(Buffer.from('ORD-2026-42').toString('hex')));
  assert.ok(encodedText.includes(Buffer.from('79fbec1c-9dcb-48df-9862-a25cc1e1ad47').toString('hex')));
  assert.ok(encodedText.includes(Buffer.from('TRX-123').toString('hex')));
  assert.ok(encodedText.includes(Buffer.from('Operadora de prueba').toString('hex')));
  assert.ok(encodedText.includes(Buffer.from('No reemplaza el comprobante emitido por el banco').toString('hex')));
  assert.ok(content.includes('%%EOF'));
});
