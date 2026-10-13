const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, test } = require('node:test');

// Requiere reecicla_inspection_db (docker compose up inspection-db).
// Ejecutar con RUN_INSPECTION_INTEGRATION=1.
const skip = process.env.RUN_INSPECTION_INTEGRATION !== '1';
const tenantId = '00000000-0000-0000-0000-000000000001';
const otherTenantId = '00000000-0000-0000-0000-0000000000ff';

function createEvent(tenant = tenantId) {
  const orderId = randomUUID();
  return {
    event_id: randomUUID(),
    correlation_id: orderId,
    tenant_id: tenant,
    event_type: 'DeviceReceived',
    timestamp: new Date().toISOString(),
    payload: {
      order_id: orderId,
      device_type_id: randomUUID(),
      device_type_name: 'Equipo de prueba',
      received_at: new Date().toISOString(),
      received_by_user_id: randomUUID(),
    },
  };
}

function createInput(event, inspectorUserId) {
  return {
    tenantId: event.tenant_id,
    orderId: event.payload.order_id,
    deviceTypeId: event.payload.device_type_id,
    evaluationRuleId: randomUUID(),
    evaluationRuleVersion: 2,
    inspectorUserId,
    data: {
      actual_condition: 'damaged',
      observations: 'Prueba de integración',
      evidence_refs: ['foto-general'],
      items: [
        { criterion_key: 'power_on', criterion_label: '¿Enciende?', criterion_type: 'boolean', value: true, result: 'PASS', observation: null, evidence_refs: [] },
        { criterion_key: 'cosmetic_condition', criterion_label: 'Estado estético', criterion_type: 'number', value: 4, result: null, observation: 'Abolladura', evidence_refs: ['foto-puerta'] },
      ],
    },
  };
}

async function cleanup(pool, event) {
  const params = [event.tenant_id, event.payload.order_id];
  await pool.query(
    `DELETE FROM domain_event_outbox WHERE aggregate_id IN (SELECT id FROM inspections WHERE tenant_id = $1 AND order_id = $2)`,
    params
  );
  await pool.query('DELETE FROM inspections WHERE tenant_id = $1 AND order_id = $2', params);
  await pool.query('DELETE FROM received_devices WHERE tenant_id = $1 AND order_id = $2', params);
  await pool.query('DELETE FROM processed_events WHERE event_id = $1', [event.event_id]);
}

after(async () => {
  if (skip) return;
  const { pool } = require('../dist/config/db');
  await pool.end();
});

test('un DeviceReceived repetido registra el equipo una sola vez', { skip }, async () => {
  const { pool } = require('../dist/config/db');
  const { ReceivedDeviceModel } = require('../dist/models/receivedDeviceModel');
  const event = createEvent();

  try {
    await ReceivedDeviceModel.registerFromEvent(event);
    await ReceivedDeviceModel.registerFromEvent(event);
    // Mismo equipo en un evento distinto (reenvío desde Orders).
    await ReceivedDeviceModel.registerFromEvent({ ...event, event_id: randomUUID() });

    const stored = await pool.query(
      'SELECT device_type_name FROM received_devices WHERE tenant_id = $1 AND order_id = $2',
      [tenantId, event.payload.order_id]
    );
    assert.equal(stored.rowCount, 1);

    const pending = await ReceivedDeviceModel.listPending(tenantId);
    assert.equal(pending.filter((device) => device.order_id === event.payload.order_id).length, 1);
  } finally {
    await pool.query('DELETE FROM processed_events WHERE tenant_id = $1 AND correlation_id = $2', [tenantId, event.correlation_id]);
    await cleanup(pool, event);
  }
});

test('registrar la inspección guarda ítems y un InspectionRegistered en outbox', { skip }, async () => {
  const { pool } = require('../dist/config/db');
  const { ReceivedDeviceModel } = require('../dist/models/receivedDeviceModel');
  const { InspectionModel } = require('../dist/models/inspectionModel');
  const event = createEvent();
  const inspectorUserId = randomUUID();

  try {
    await ReceivedDeviceModel.registerFromEvent(event);
    const inspection = await InspectionModel.create(createInput(event, inspectorUserId));

    assert.equal(inspection.status, 'REGISTERED');
    assert.equal(inspection.result, null);
    assert.equal(inspection.actual_condition, 'damaged');
    assert.equal(inspection.evaluation_rule_version, 2);
    assert.equal(inspection.inspected_by_user, inspectorUserId);
    assert.equal(inspection.device_type_name, 'Equipo de prueba');
    assert.deepEqual(inspection.evidence_refs, ['foto-general']);
    assert.equal(inspection.items.length, 2);

    const cosmetic = inspection.items.find((item) => item.criterion_key === 'cosmetic_condition');
    assert.equal(cosmetic.value, 4);
    assert.equal(cosmetic.observation, 'Abolladura');
    assert.deepEqual(cosmetic.evidence_refs, ['foto-puerta']);
    assert.equal(inspection.items.find((item) => item.criterion_key === 'power_on').value, true);

    const outbox = await pool.query(
      'SELECT event_type, routing_key, correlation_id, payload FROM domain_event_outbox WHERE aggregate_id = $1',
      [inspection.id]
    );
    assert.equal(outbox.rowCount, 1);
    assert.equal(outbox.rows[0].event_type, 'InspectionRegistered');
    assert.equal(outbox.rows[0].routing_key, 'inspection.registered');
    assert.equal(outbox.rows[0].correlation_id, event.payload.order_id);
    assert.equal(outbox.rows[0].payload.order_id, event.payload.order_id);

    const pending = await ReceivedDeviceModel.listPending(tenantId);
    assert.equal(pending.some((device) => device.order_id === event.payload.order_id), false);
  } finally {
    await cleanup(pool, event);
  }
});

test('una segunda inspección de la misma orden es rechazada sin duplicar', { skip }, async () => {
  const { pool } = require('../dist/config/db');
  const { ReceivedDeviceModel } = require('../dist/models/receivedDeviceModel');
  const { InspectionModel } = require('../dist/models/inspectionModel');
  const event = createEvent();

  try {
    await ReceivedDeviceModel.registerFromEvent(event);
    const first = await InspectionModel.create(createInput(event, randomUUID()));

    await assert.rejects(
      InspectionModel.create(createInput(event, randomUUID())),
      (error) => error.status === 409 && /ya tiene una inspección/.test(error.message)
    );

    const inspections = await pool.query(
      'SELECT id FROM inspections WHERE tenant_id = $1 AND order_id = $2',
      [tenantId, event.payload.order_id]
    );
    assert.equal(inspections.rowCount, 1);
    const items = await pool.query('SELECT id FROM inspection_items WHERE inspection_id = $1', [first.id]);
    assert.equal(items.rowCount, 2);
  } finally {
    await cleanup(pool, event);
  }
});

test('si un ítem falla no queda una inspección a medias', { skip }, async () => {
  const { pool } = require('../dist/config/db');
  const { ReceivedDeviceModel } = require('../dist/models/receivedDeviceModel');
  const { InspectionModel } = require('../dist/models/inspectionModel');
  const event = createEvent();
  const input = createInput(event, randomUUID());
  input.data.items[1].criterion_type = 'tipo-inexistente';

  try {
    await ReceivedDeviceModel.registerFromEvent(event);
    await assert.rejects(InspectionModel.create(input));

    const inspections = await pool.query(
      'SELECT id FROM inspections WHERE tenant_id = $1 AND order_id = $2',
      [tenantId, event.payload.order_id]
    );
    assert.equal(inspections.rowCount, 0);
  } finally {
    await cleanup(pool, event);
  }
});

test('un tenant no ve equipos ni inspecciones de otro', { skip }, async () => {
  const { pool } = require('../dist/config/db');
  const { ReceivedDeviceModel } = require('../dist/models/receivedDeviceModel');
  const { InspectionModel } = require('../dist/models/inspectionModel');
  const event = createEvent(otherTenantId);

  try {
    await ReceivedDeviceModel.registerFromEvent(event);
    await InspectionModel.create(createInput(event, randomUUID()));

    assert.equal(await ReceivedDeviceModel.findByOrder(tenantId, event.payload.order_id), null);
    assert.equal(await InspectionModel.findByOrder(tenantId, event.payload.order_id), null);
    const listed = await InspectionModel.listForTenant(tenantId);
    assert.equal(listed.some((inspection) => inspection.order_id === event.payload.order_id), false);

    assert.ok(await InspectionModel.findByOrder(otherTenantId, event.payload.order_id));
  } finally {
    await cleanup(pool, event);
  }
});
