const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const {
  buildAdjustmentJustification,
  calculateAdjustedPrice,
  validateInspectionCompletedEvent,
} = require('../dist/domain/inspectionCompleted');

function createEvent() {
  const orderId = randomUUID();
  return {
    event_id: randomUUID(),
    correlation_id: orderId,
    tenant_id: randomUUID(),
    event_type: 'InspectionCompleted',
    timestamp: new Date().toISOString(),
    payload: {
      inspection_id: randomUUID(),
      order_id: orderId,
      quote_id: randomUUID(),
      actual_condition: 'damaged',
      result: 'RESALE',
      justification: 'La pantalla presenta rayones.',
      completed_by_user_id: randomUUID(),
      completed_at: new Date().toISOString(),
    },
  };
}

test('valida el contrato de InspectionCompleted requerido para recotizar', () => {
  assert.doesNotThrow(() => validateInspectionCompletedEvent(createEvent()));

  const missingQuote = createEvent();
  missingQuote.payload.quote_id = null;
  assert.throws(() => validateInspectionCompletedEvent(missingQuote), /Evento InspectionCompleted inválido/);
});

test('calcula el precio ajustado con la regla original y limita el precio mínimo a cero', () => {
  assert.deepEqual(calculateAdjustedPrice(150, { damaged: -40 }, 'damaged'), {
    adjustment: -40,
    finalPrice: 110,
  });
  assert.deepEqual(calculateAdjustedPrice(50, { broken: -80 }, 'broken'), {
    adjustment: -80,
    finalPrice: 0,
  });
});

test('genera una justificación auditable con ambas condiciones', () => {
  assert.equal(
    buildAdjustmentJustification('working', 'damaged'),
    'La condición declarada (working) difiere de la condición real verificada (damaged).'
  );
});

test('rechaza condiciones y montos no válidos', () => {
  const event = createEvent();
  event.payload.actual_condition = 'unknown';
  assert.throws(() => validateInspectionCompletedEvent(event), /payload.*inválidos/);
  assert.throws(
    () => calculateAdjustedPrice(100, { broken: 'no-number' }, 'broken'),
    /precios inválidos/
  );
});
