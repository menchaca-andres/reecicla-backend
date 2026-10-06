const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { validateQuoteAcceptedEvent } = require('../dist/domain/quoteAccepted');

function createEvent() {
  return {
    event_id: randomUUID(),
    correlation_id: randomUUID(),
    tenant_id: '00000000-0000-0000-0000-000000000001',
    event_type: 'QuoteAccepted',
    timestamp: new Date().toISOString(),
    payload: {
      quote_id: randomUUID(),
      user_id: randomUUID(),
      device_type_id: randomUUID(),
      device_type_name: 'Refrigerador',
      brand: 'Marca de prueba',
      model: 'Modelo de prueba',
      year: 2022,
      condition: 'working',
      quoted_price: 150,
      currency: 'BOB',
      customer_name: 'Cliente de prueba',
      customer_email: 'orders-test@example.invalid',
      accepted_at: new Date().toISOString(),
    },
  };
}

test('valida un evento QuoteAccepted completo', () => {
  assert.doesNotThrow(() => validateQuoteAcceptedEvent(createEvent()));
});

test('rechaza un evento con un tipo desconocido', () => {
  const event = createEvent();
  event.event_type = 'QuoteRejected';
  assert.throws(() => validateQuoteAcceptedEvent(event), /Evento QuoteAccepted inválido/);
});

test('rechaza precio y año fuera de rango', () => {
  const event = createEvent();
  event.payload.quoted_price = -1;
  assert.throws(() => validateQuoteAcceptedEvent(event), /payload.*inválidos/);

  const yearEvent = createEvent();
  yearEvent.payload.year = 2201;
  assert.throws(() => validateQuoteAcceptedEvent(yearEvent), /payload.*inválidos/);
});

test('crea una orden y un solo estado inicial frente a eventos duplicados', { skip: process.env.RUN_ORDERS_INTEGRATION !== '1' }, async () => {
  const { pool } = require('../dist/config/db');
  const { OrderModel } = require('../dist/models/orderModel');
  const event = createEvent();
  const duplicateEvent = { ...event, event_id: randomUUID(), correlation_id: randomUUID() };

  try {
    await OrderModel.createFromAcceptedQuote(event);
    await OrderModel.createFromAcceptedQuote(event);
    await OrderModel.createFromAcceptedQuote(duplicateEvent);

    const orderResult = await pool.query(
      'SELECT * FROM orders WHERE tenant_id = $1 AND quote_id = $2',
      [event.tenant_id, event.payload.quote_id]
    );
    assert.equal(orderResult.rowCount, 1);
    assert.equal(orderResult.rows[0].brand, event.payload.brand);
    assert.equal(orderResult.rows[0].model, event.payload.model);
    assert.equal(orderResult.rows[0].device_year, event.payload.year);
    assert.equal(orderResult.rows[0].declared_condition, event.payload.condition);

    const historyResult = await pool.query(
      'SELECT * FROM order_status_history WHERE tenant_id = $1 AND order_id = $2',
      [event.tenant_id, orderResult.rows[0].id]
    );
    assert.equal(historyResult.rowCount, 1);
    assert.equal(historyResult.rows[0].new_status, 'ACCEPTED');
  } finally {
    await pool.query(
      `DELETE FROM order_status_history WHERE tenant_id = $1 AND order_id IN
       (SELECT id FROM orders WHERE tenant_id = $1 AND quote_id = $2)`,
      [event.tenant_id, event.payload.quote_id]
    );
    await pool.query('DELETE FROM orders WHERE tenant_id = $1 AND quote_id = $2', [event.tenant_id, event.payload.quote_id]);
    await pool.query('DELETE FROM processed_events WHERE event_id = ANY($1::uuid[])', [[event.event_id, duplicateEvent.event_id]]);
    await pool.end();
  }
});