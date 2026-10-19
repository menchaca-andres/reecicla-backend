const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  DispositionError,
  decideDispositionAction,
  validateDispositionInput,
} = require('../dist/domain/disposition');

test('valida y recorta tipo y referencia', () => {
  assert.deepEqual(
    validateDispositionInput({ type: 'RECYCLE', reference: '  CERT-2026-0042  ' }),
    { type: 'RECYCLE', reference: 'CERT-2026-0042' }
  );
  assert.equal(validateDispositionInput({ type: 'RESALE', reference: 'PUB-1' }).type, 'RESALE');
  assert.equal(validateDispositionInput({ type: 'RETURN', reference: 'GUIA-9' }).type, 'RETURN');
});

test('rechaza tipo inválido, referencia vacía o excesiva', () => {
  for (const body of [
    null,
    {},
    { type: 'SELL', reference: 'X' },
    { type: 'RESALE' },
    { type: 'RESALE', reference: '   ' },
    { type: 'RESALE', reference: 42 },
    { type: 'RECYCLE', reference: 'x'.repeat(256) },
  ]) {
    assert.throws(() => validateDispositionInput(body), (error) => {
      assert.ok(error instanceof DispositionError);
      assert.equal(error.httpStatus, 400);
      return true;
    });
  }
  assert.doesNotThrow(() => validateDispositionInput({ type: 'RESALE', reference: 'x'.repeat(255) }));
});

test('orden PAID sin disposición crea el destino', () => {
  assert.equal(
    decideDispositionAction({ status: 'PAID' }, null, { type: 'RESALE', reference: 'PUB-1' }),
    'CREATE'
  );
  assert.equal(
    decideDispositionAction({ status: 'PAID' }, null, { type: 'RECYCLE', reference: 'CERT-1' }),
    'CREATE'
  );
});

test('RETURN no se puede crear desde una orden pagada', () => {
  assert.throws(
    () => decideDispositionAction({ status: 'PAID' }, null, { type: 'RETURN', reference: 'G-1' }),
    (error) => error instanceof DispositionError && error.httpStatus === 409
  );
});

test('ajuste rechazado completa la disposición pendiente con el mismo tipo', () => {
  assert.equal(
    decideDispositionAction(
      { status: 'ADJUSTMENT_REJECTED' },
      { type: 'RECYCLE', status: 'PENDING' },
      { type: 'RECYCLE', reference: 'CERT-2' }
    ),
    'COMPLETE_EXISTING'
  );
  assert.equal(
    decideDispositionAction(
      { status: 'ADJUSTMENT_REJECTED' },
      { type: 'RETURN', status: 'PENDING' },
      { type: 'RETURN', reference: 'G-2' }
    ),
    'COMPLETE_EXISTING'
  );
});

test('ajuste rechazado no permite cambiar el tipo ni registrar sin elección', () => {
  assert.throws(
    () => decideDispositionAction(
      { status: 'ADJUSTMENT_REJECTED' },
      { type: 'RECYCLE', status: 'PENDING' },
      { type: 'RESALE', reference: 'PUB-2' }
    ),
    (error) => error instanceof DispositionError && error.httpStatus === 409
  );
  assert.throws(
    () => decideDispositionAction({ status: 'ADJUSTMENT_REJECTED' }, null, { type: 'RECYCLE', reference: 'C' }),
    (error) => error instanceof DispositionError && error.httpStatus === 409
  );
});

test('estados no elegibles se rechazan', () => {
  for (const status of ['ACCEPTED', 'RECEIVED', 'INSPECTED', 'ADJUSTMENT_PENDING', 'PAYMENT_PENDING', 'CANCELLED']) {
    assert.throws(
      () => decideDispositionAction({ status }, null, { type: 'RESALE', reference: 'PUB' }),
      (error) => error instanceof DispositionError && error.httpStatus === 409
    );
  }
});

test('reintento sobre orden cerrada es idempotente solo con el mismo tipo', () => {
  const existing = { type: 'RESALE', status: 'COMPLETED' };
  assert.equal(
    decideDispositionAction({ status: 'CLOSED' }, existing, { type: 'RESALE', reference: 'PUB-1' }),
    'ALREADY_REGISTERED'
  );
  assert.throws(
    () => decideDispositionAction({ status: 'CLOSED' }, existing, { type: 'RECYCLE', reference: 'C' }),
    (error) => error instanceof DispositionError && error.httpStatus === 409
  );
  assert.throws(
    () => decideDispositionAction({ status: 'CLOSED' }, null, { type: 'RESALE', reference: 'PUB' }),
    (error) => error instanceof DispositionError && error.httpStatus === 409
  );
});
