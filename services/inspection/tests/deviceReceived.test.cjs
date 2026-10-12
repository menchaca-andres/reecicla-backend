const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { validateDeviceReceivedEvent } = require('../dist/domain/deviceReceived');

function createEvent() {
  return {
    event_id: randomUUID(),
    correlation_id: randomUUID(),
    tenant_id: '00000000-0000-0000-0000-000000000001',
    event_type: 'DeviceReceived',
    timestamp: new Date().toISOString(),
    payload: {
      order_id: randomUUID(),
      device_type_id: randomUUID(),
      device_type_name: 'Refrigerador',
      received_at: new Date().toISOString(),
      received_by_user_id: randomUUID(),
    },
  };
}

test('valida un evento DeviceReceived completo', () => {
  assert.doesNotThrow(() => validateDeviceReceivedEvent(createEvent()));
});

test('rechaza un evento de otro tipo', () => {
  const event = createEvent();
  event.event_type = 'QuoteAccepted';
  assert.throws(() => validateDeviceReceivedEvent(event), /Evento DeviceReceived inválido/);
});

test('rechaza identificadores que no son UUID', () => {
  const event = createEvent();
  event.payload.order_id = 'ORD-00000001';
  assert.throws(() => validateDeviceReceivedEvent(event), /Evento DeviceReceived inválido/);
});

test('rechaza un evento sin payload', () => {
  const event = createEvent();
  delete event.payload;
  assert.throws(() => validateDeviceReceivedEvent(event), /Evento DeviceReceived inválido/);
});

test('rechaza fecha de recepción o nombre de tipo inválidos', () => {
  const badDate = createEvent();
  badDate.payload.received_at = 'ayer';
  assert.throws(() => validateDeviceReceivedEvent(badDate), /payload.*inválidos/);

  const noName = createEvent();
  noName.payload.device_type_name = ' ';
  assert.throws(() => validateDeviceReceivedEvent(noName), /payload.*inválidos/);
});
