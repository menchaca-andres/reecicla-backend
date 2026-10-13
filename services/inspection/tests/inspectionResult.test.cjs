const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateInspectionResult } = require('../dist/domain/inspectionResult');
const { DomainError } = require('../dist/domain/errors');

test('acepta un resultado válido y normaliza la justificación', () => {
  assert.deepEqual(
    validateInspectionResult({ result: 'RESALE', justification: '  Equipo funcional  ' }),
    { result: 'RESALE', justification: 'Equipo funcional' }
  );
});

test('rechaza un resultado desconocido', () => {
  assert.throws(
    () => validateInspectionResult({ result: 'REPAIR', justification: 'Motivo' }),
    (error) => error instanceof DomainError && error.status === 400
  );
});

test('requiere una justificación no vacía y limita su longitud', () => {
  assert.throws(
    () => validateInspectionResult({ result: 'RECYCLE', justification: '  ' }),
    /justificación.*obligatoria/
  );
  assert.throws(
    () => validateInspectionResult({ result: 'RECYCLE', justification: 'x'.repeat(2001) }),
    /no puede superar/
  );
});
