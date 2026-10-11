const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');

test('registra la recepción una vez y crea un DeviceReceived en outbox', {
  skip: process.env.RUN_ORDERS_INTEGRATION !== '1',
}, async () => {
  const { pool } = require('../dist/config/db');
  const { OrderModel } = require('../dist/models/orderModel');
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const orderId = randomUUID();
  const userId = randomUUID();
  const quoteId = randomUUID();
  const deviceTypeId = randomUUID();
  const orderNumber = `TEST-${randomUUID().slice(0, 8)}`;

  try {
    await pool.query(
      `INSERT INTO orders (
         id, tenant_id, order_number, user_id, quote_id, device_type_id,
         device_type_name, quoted_price, status, customer_name, customer_email
       ) VALUES ($1, $2, $3, $4, $5, $6, 'Equipo de prueba', 100, 'IN_TRANSIT', 'Tester', 'test@example.invalid')`,
      [orderId, tenantId, orderNumber, userId, quoteId, deviceTypeId]
    );

    const firstReceipt = await OrderModel.receiveOrder(tenantId, orderId, userId);
    const retryReceipt = await OrderModel.receiveOrder(tenantId, orderId, userId);

    assert.equal(firstReceipt.status, 'RECEIVED');
    assert.equal(retryReceipt.received_at.toISOString(), firstReceipt.received_at.toISOString());

    const history = await pool.query(
      'SELECT previous_status, new_status, changed_by_user, reason FROM order_status_history WHERE tenant_id = $1 AND order_id = $2',
      [tenantId, orderId]
    );
    assert.equal(history.rowCount, 1);
    assert.equal(history.rows[0].previous_status, 'IN_TRANSIT');
    assert.equal(history.rows[0].new_status, 'RECEIVED');
    assert.equal(history.rows[0].changed_by_user, userId);
    assert.equal(history.rows[0].reason, 'Equipo recibido en almacén');

    const outbox = await pool.query(
      "SELECT event_type, routing_key FROM domain_event_outbox WHERE aggregate_id = $1",
      [orderId]
    );
    assert.equal(outbox.rowCount, 1);
    assert.equal(outbox.rows[0].event_type, 'DeviceReceived');
    assert.equal(outbox.rows[0].routing_key, 'device.received');
  } finally {
    await pool.query('DELETE FROM order_status_history WHERE tenant_id = $1 AND order_id = $2', [tenantId, orderId]);
    await pool.query('DELETE FROM domain_event_outbox WHERE tenant_id = $1 AND aggregate_id = $2', [tenantId, orderId]);
    await pool.query('DELETE FROM orders WHERE tenant_id = $1 AND id = $2', [tenantId, orderId]);
    await pool.end();
  }
});
