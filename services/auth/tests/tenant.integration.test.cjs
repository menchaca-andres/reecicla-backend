const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { AuthService } = require('../dist/services/authService');
const { pool } = require('../dist/config/db');

test('crea tenant y administrador principal de forma atómica', { skip: process.env.RUN_AUTH_INTEGRATION !== '1' }, async () => {
  const slug = `tenant-${randomUUID().slice(0, 8)}`;
  let tenantId;
  try {
    const created = await AuthService.createTenantWithAdmin({
      name: `Tenant integration ${slug}`,
      slug,
      email: `${slug}@example.test`,
      password: 'integration-password',
      admin_name: 'Integration Admin',
    });
    tenantId = created.tenant.id;

    assert.equal(created.tenant.slug, slug);
    assert.equal(created.admin.tenant_id, tenantId);
    assert.equal(created.admin.role, 'TENANT_ADMIN');

    const plan = await pool.query(
      'SELECT plan_code FROM tenant_plans WHERE tenant_id = $1',
      [tenantId]
    );
    assert.equal(plan.rows[0].plan_code, 'FREE');

    await assert.rejects(
      AuthService.createTenantWithAdmin({
        name: `Duplicate ${slug}`,
        slug,
        email: `duplicate-${slug}@example.test`,
        password: 'integration-password',
      }),
      /duplicate key/i
    );
    const duplicateTenants = await pool.query('SELECT id FROM tenants WHERE name = $1', [`Duplicate ${slug}`]);
    assert.equal(duplicateTenants.rowCount, 0);
  } finally {
    if (tenantId) await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await pool.end();
  }
});
