const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { pool } = require('../dist/config/db');
const { DeviceTypeModel } = require('../dist/models/deviceTypeModel');
const eventBus = require('../dist/messaging/eventBus');

const originalQuery = pool.query;
const originalConnect = pool.connect;
const originalFetch = global.fetch;
const originalPublishEvent = eventBus.publishEvent;
const originalInternalToken = process.env.INTERNAL_SERVICE_TOKEN;

function staleDeviceType() {
  return {
    id: randomUUID(),
    tenant_id: randomUUID(),
    code: 'INACTIVITY_TEST',
    name: 'Tipo de prueba',
    status: 'ACTIVE',
    created_at: new Date(Date.now() - 14 * 30.4375 * 24 * 60 * 60 * 1000),
    last_received_at: null,
  };
}

async function evaluateWithOrdersResponse(response) {
  const type = staleDeviceType();
  process.env.INTERNAL_SERVICE_TOKEN = 'catalog-test-token';
  pool.query = async (query) => {
    assert.match(query, /SELECT \* FROM device_types/);
    return { rows: [type] };
  };
  global.fetch = async () => response;
  return DeviceTypeModel.evaluateInactivity(type.tenant_id);
}

test('does not recommend deactivation when Orders cannot verify dependencies', async () => {
  try {
    await assert.rejects(
      evaluateWithOrdersResponse({ ok: false, status: 503 }),
      /no se desactivará ningún tipo/
    );
  } finally {
    pool.query = originalQuery;
    global.fetch = originalFetch;
    if (originalInternalToken === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
    else process.env.INTERNAL_SERVICE_TOKEN = originalInternalToken;
  }
});

test('rejects malformed dependency data instead of treating it as empty', async () => {
  try {
    await assert.rejects(
      evaluateWithOrdersResponse({ ok: true, json: async () => ({}) }),
      /no se desactivará ningún tipo/
    );
  } finally {
    pool.query = originalQuery;
    global.fetch = originalFetch;
    if (originalInternalToken === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
    else process.env.INTERNAL_SERVICE_TOKEN = originalInternalToken;
  }
});

test('allows candidates only after a successful empty-dependencies response', async () => {
  try {
    const result = await evaluateWithOrdersResponse({
      ok: true,
      json: async () => ({ dependencies: {} }),
    });
    assert.equal(result.eligible_to_deactivate.length, 1);
    assert.equal(result.blocked_by_dependencies.length, 0);
  } finally {
    pool.query = originalQuery;
    global.fetch = originalFetch;
    if (originalInternalToken === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
    else process.env.INTERNAL_SERVICE_TOKEN = originalInternalToken;
  }
});

test('scheduled deactivation waits 24 hours after notifying administrators', async () => {
  const type = staleDeviceType();
  const warningId = randomUUID();
  let warningRecord = null;
  let warningEmailCount = 0;
  let completionEmailCount = 0;
  process.env.INTERNAL_SERVICE_TOKEN = 'catalog-test-token';
  pool.query = async (query, values = []) => {
    if (/SELECT \* FROM device_types/.test(query)) {
      return { rows: type.status === 'ACTIVE' ? [type] : [] };
    }
    if (/SELECT device_type_id, inactivity_since/.test(query)) {
      return { rows: warningRecord ? [warningRecord] : [] };
    }
    if (/INSERT INTO catalog_inactivity_warnings/.test(query)) {
      warningRecord = {
        id: warningId,
        device_type_id: values[1],
        inactivity_since: values[2],
        status: 'SENDING',
        updated_at: new Date(),
        eligible_after: null,
      };
      return { rows: [{ id: warningId }] };
    }
    if (/UPDATE catalog_inactivity_warnings/.test(query)) {
      warningRecord.status = values[0];
      warningRecord.eligible_after = values[1];
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`Unexpected query: ${query}`);
  };
  pool.connect = async () => ({
    query: async (query) => {
      if (/UPDATE device_types/.test(query)) {
        type.status = 'INACTIVE';
        return { rowCount: 1, rows: [type] };
      }
      if (/INSERT INTO catalog_audit_logs/.test(query)) {
        return { rowCount: 1, rows: [{ id: randomUUID() }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release: () => {},
  });
  global.fetch = async (_url, options) => {
    if (_url.includes('/active-dependencies')) {
      return { ok: true, json: async () => ({ dependencies: {} }) };
    }
    const summary = JSON.parse(options.body).summary;
    if (summary.phase === 'WARNING') warningEmailCount++;
    else completionEmailCount++;
    return { ok: true };
  };
  eventBus.publishEvent = async () => {};

  try {
    const firstRun = await DeviceTypeModel.executeInactivityDeactivation(
      type.tenant_id,
      'SYSTEM_SCHEDULED_JOB'
    );
    assert.equal(firstRun.total_deactivated, 0);
    assert.equal(firstRun.notification_sent, true);
    assert.equal(warningRecord.status, 'SENT');
    assert.ok(new Date(warningRecord.eligible_after).getTime() > Date.now() + 23 * 60 * 60 * 1000);
    assert.equal(warningEmailCount, 1);
    assert.equal(type.status, 'ACTIVE');

    warningRecord.eligible_after = new Date(Date.now() - 1000);
    const secondRun = await DeviceTypeModel.executeInactivityDeactivation(
      type.tenant_id,
      'SYSTEM_SCHEDULED_JOB'
    );
    assert.equal(secondRun.total_deactivated, 1);
    assert.equal(warningEmailCount, 1);
    assert.equal(completionEmailCount, 1);
    assert.equal(type.status, 'INACTIVE');
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    global.fetch = originalFetch;
    eventBus.publishEvent = originalPublishEvent;
    if (originalInternalToken === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
    else process.env.INTERNAL_SERVICE_TOKEN = originalInternalToken;
  }
});
