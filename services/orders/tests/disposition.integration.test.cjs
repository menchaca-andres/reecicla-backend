const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, test } = require('node:test');

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000002';

after(async () => {
  if (process.env.RUN_ORDERS_INTEGRATION !== '1') return;
  const { pool } = require('../dist/config/db');
  await pool.end();
});

async function insertOrder(pool, status) {
  const orderId = randomUUID();
  await pool.query(
    `INSERT INTO orders (
       id, tenant_id, order_number, user_id, quote_id, device_type_id,
       device_type_name, quoted_price, final_price, status, customer_name, customer_email
     ) VALUES ($1, $2, $3, $4, $5, $6, 'Equipo de prueba', 100, 100, $7, 'Tester', 'test@example.invalid')`,
    [orderId, TENANT_ID, `TEST-${randomUUID().slice(0, 8)}`, randomUUID(), randomUUID(), randomUUID(), status]
  );
  return orderId;
}

async function cleanup(pool, orderIds) {
  for (const orderId of orderIds) {
    await pool.query('DELETE FROM order_status_history WHERE order_id = $1', [orderId]);
    await pool.query('DELETE FROM domain_event_outbox WHERE aggregate_id = $1', [orderId]);
    await pool.query('DELETE FROM dispositions WHERE order_id = $1', [orderId]);
    await pool.query('DELETE FROM orders WHERE id = $1', [orderId]);
  }
}

test('orden PAID: registra RESALE, cierra la orden y publica DispositionCompleted una vez', {
  skip: process.env.RUN_ORDERS_INTEGRATION !== '1',
}, async () => {
  const { pool } = require('../dist/config/db');
  const { OrderModel } = require('../dist/models/orderModel');
  const operatorId = randomUUID();
  const orderId = await insertOrder(pool, 'PAID');

  try {
    const first = await OrderModel.registerDisposition(TENANT_ID, orderId, operatorId, {
      type: 'RESALE',
      reference: 'PUB-2026-001',
    });
    assert.equal(first.already_registered, false);
    assert.equal(first.disposition.status, 'COMPLETED');

    const retry = await OrderModel.registerDisposition(TENANT_ID, orderId, operatorId, {
      type: 'RESALE',
      reference: 'PUB-2026-001',
    });
    assert.equal(retry.already_registered, true);
    assert.equal(retry.disposition.id, first.disposition.id);

    const order = await pool.query('SELECT status FROM orders WHERE id = $1', [orderId]);
    assert.equal(order.rows[0].status, 'CLOSED');

    const dispositions = await pool.query('SELECT type, status, reference FROM dispositions WHERE order_id = $1', [orderId]);
    assert.equal(dispositions.rowCount, 1);
    assert.equal(dispositions.rows[0].type, 'RESALE');
    assert.equal(dispositions.rows[0].reference, 'PUB-2026-001');

    const history = await pool.query(
      'SELECT previous_status, new_status, changed_by_user FROM order_status_history WHERE order_id = $1 ORDER BY created_at, new_status',
      [orderId]
    );
    assert.deepEqual(
      history.rows.map((row) => [row.previous_status, row.new_status]).sort(),
      [['DISPOSED', 'CLOSED'], ['PAID', 'DISPOSED']]
    );
    assert.ok(history.rows.every((row) => row.changed_by_user === operatorId));

    const outbox = await pool.query(
      "SELECT routing_key, payload FROM domain_event_outbox WHERE aggregate_id = $1 AND event_type = 'DispositionCompleted'",
      [orderId]
    );
    assert.equal(outbox.rowCount, 1);
    assert.equal(outbox.rows[0].routing_key, 'disposition.completed');
    assert.equal(outbox.rows[0].payload.type, 'RESALE');
    assert.equal(outbox.rows[0].payload.completed_by_user_id, operatorId);
  } finally {
    await cleanup(pool, [orderId]);
  }
});

test('ajuste rechazado: completa la disposición pendiente y no permite cambiar su tipo', {
  skip: process.env.RUN_ORDERS_INTEGRATION !== '1',
}, async () => {
  const { pool } = require('../dist/config/db');
  const { OrderModel } = require('../dist/models/orderModel');
  const operatorId = randomUUID();
  const orderId = await insertOrder(pool, 'ADJUSTMENT_REJECTED');

  try {
    await assert.rejects(
      OrderModel.registerDisposition(TENANT_ID, orderId, operatorId, { type: 'RECYCLE', reference: 'CERT-1' }),
      /no ha vencido/
    );

    await pool.query(
      "INSERT INTO dispositions (tenant_id, order_id, type, status) VALUES ($1, $2, 'RECYCLE', 'PENDING')",
      [TENANT_ID, orderId]
    );

    await assert.rejects(
      OrderModel.registerDisposition(TENANT_ID, orderId, operatorId, { type: 'RESALE', reference: 'PUB-1' }),
      /no coincide/
    );

    const result = await OrderModel.registerDisposition(TENANT_ID, orderId, operatorId, {
      type: 'RECYCLE',
      reference: 'CERT-DEST-0042',
    });
    assert.equal(result.disposition.status, 'COMPLETED');
    assert.equal(result.disposition.reference, 'CERT-DEST-0042');

    const order = await pool.query('SELECT status FROM orders WHERE id = $1', [orderId]);
    assert.equal(order.rows[0].status, 'CLOSED');
  } finally {
    await cleanup(pool, [orderId]);
  }
});

test('estado no elegible y otro tenant no pueden registrar destino', {
  skip: process.env.RUN_ORDERS_INTEGRATION !== '1',
}, async () => {
  const { pool } = require('../dist/config/db');
  const { OrderModel } = require('../dist/models/orderModel');
  const operatorId = randomUUID();
  const inspectedOrderId = await insertOrder(pool, 'INSPECTED');
  const paidOrderId = await insertOrder(pool, 'PAID');

  try {
    await assert.rejects(
      OrderModel.registerDisposition(TENANT_ID, inspectedOrderId, operatorId, { type: 'RESALE', reference: 'PUB-1' }),
      /debe estar PAID/
    );
    await assert.rejects(
      OrderModel.registerDisposition(OTHER_TENANT_ID, paidOrderId, operatorId, { type: 'RESALE', reference: 'PUB-1' }),
      /Orden no encontrada/
    );
    const untouched = await pool.query('SELECT status FROM orders WHERE id = $1', [paidOrderId]);
    assert.equal(untouched.rows[0].status, 'PAID');
  } finally {
    await cleanup(pool, [inspectedOrderId, paidOrderId]);
  }
});
