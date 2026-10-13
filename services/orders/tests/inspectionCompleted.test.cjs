const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { validateInspectionCompletedEvent } = require('../dist/domain/inspectionCompleted');

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
      result: 'RESALE',
      justification: 'El equipo funciona y no presenta daños estructurales.',
      completed_by_user_id: randomUUID(),
      completed_at: new Date().toISOString(),
    },
  };
}

test('valida un evento InspectionCompleted completo', () => {
  assert.doesNotThrow(() => validateInspectionCompletedEvent(createEvent()));
});

test('rechaza resultado, identificadores y justificación inválidos', () => {
  const invalidResult = createEvent();
  invalidResult.payload.result = 'REPAIR';
  assert.throws(() => validateInspectionCompletedEvent(invalidResult), /payload.*inválidos/);

  const invalidId = createEvent();
  invalidId.payload.order_id = 'not-a-uuid';
  assert.throws(() => validateInspectionCompletedEvent(invalidId), /Evento InspectionCompleted inválido/);

  const missingReason = createEvent();
  missingReason.payload.justification = '  ';
  assert.throws(() => validateInspectionCompletedEvent(missingReason), /payload.*inválidos/);

  const wrongCorrelation = createEvent();
  wrongCorrelation.correlation_id = randomUUID();
  assert.throws(() => validateInspectionCompletedEvent(wrongCorrelation), /Evento InspectionCompleted inválido/);
});
