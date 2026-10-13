const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { QuotaModel } = require('../dist/models/quotaModel');
const { pool } = require('../dist/config/db');

test('aplica el límite mensual y no limita Premium', { skip: process.env.RUN_AUTH_INTEGRATION !== '1' }, async () => {
  const tenantId = randomUUID();
  const reservationIds = [];
  let tenantCreated = false;
  try {
    await pool.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [tenantId, `quota-test-${tenantId}`]);
    tenantCreated = true;

    const candidateIds = Array.from({ length: 25 }, () => randomUUID());
    const reservationResults = await Promise.allSettled(
      candidateIds.map((reservationId) => QuotaModel.reserveQuote(tenantId, reservationId))
    );
    reservationResults.forEach((result, index) => {
      if (result.status === 'fulfilled') reservationIds.push(candidateIds[index]);
    });
    assert.equal(reservationIds.length, 20);

    const repeatedReservation = await QuotaModel.reserveQuote(tenantId, reservationIds[0]);
    assert.equal(repeatedReservation.quote_count, 20);
    await assert.rejects(
      QuotaModel.reserveQuote(tenantId, randomUUID()),
      /límite de 20 cotizaciones mensuales/
    );

    await QuotaModel.finishReservation(reservationIds[0], 'RELEASE');
    await QuotaModel.reserveQuote(tenantId, randomUUID());
    await QuotaModel.setTenantPlan(tenantId, 'PREMIUM');

    for (let index = 0; index < 25; index++) {
      await QuotaModel.reserveQuote(tenantId, randomUUID());
    }

    const countResult = await pool.query(
      `SELECT quote_count FROM quote_usage_counters
       WHERE tenant_id = $1 AND period_start = date_trunc('month', now() AT TIME ZONE 'UTC')::date`,
      [tenantId]
    );
    assert.equal(countResult.rows[0].quote_count, 45);
  } finally {
    try {
      if (tenantCreated) await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    } finally {
      await pool.end();
    }
  }
});