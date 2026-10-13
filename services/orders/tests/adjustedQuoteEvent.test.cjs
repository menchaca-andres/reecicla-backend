const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { validateAdjustedQuoteEvent } = require('../dist/domain/adjustedQuoteEvent');

function createEvent(eventType = 'AdjustedQuoteAccepted') {
  const orderId = randomUUID();
  return {
    event_id: randomUUID(),
    correlation_id: orderId,
    tenant_id: randomUUID(),
    event_type: eventType,
    timestamp: new Date().toISOString(),
    payload: {
      order_id: orderId,
      quote_id: randomUUID(),
      parent_quote_id: randomUUID(),
      adjusted_price: 125,
      currency: 'BOB',
      responded_by_user_id: null,
      responded_at: new Date().toISOString(),
    },
  };
}

test('valida creación, aceptación y rechazo de cotización ajustada', () => {
  for (const eventType of ['AdjustedQuoteCreated', 'AdjustedQuoteAccepted', 'AdjustedQuoteRejected']) {
    assert.doesNotThrow(() => validateAdjustedQuoteEvent(createEvent(eventType)));
  }
});

test('rechaza tenant/orden no correlacionados y precios inválidos', () => {
  const wrongCorrelation = createEvent();
  wrongCorrelation.correlation_id = randomUUID();
  assert.throws(() => validateAdjustedQuoteEvent(wrongCorrelation), /evento.*inválido/i);

  const invalidPrice = createEvent();
  invalidPrice.payload.adjusted_price = -1;
  assert.throws(() => validateAdjustedQuoteEvent(invalidPrice), /payload.*inválido/i);
});

test('la creación no exige fecha de respuesta, pero decisiones sí', () => {
  const created = createEvent('AdjustedQuoteCreated');
  delete created.payload.responded_at;
  assert.doesNotThrow(() => validateAdjustedQuoteEvent(created));

  const accepted = createEvent();
  delete accepted.payload.responded_at;
  assert.throws(() => validateAdjustedQuoteEvent(accepted), /fecha válida/);
});
