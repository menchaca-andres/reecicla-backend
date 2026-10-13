const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { test } = require('node:test');
const {
  assertTenantToken,
  isValidTenantSlug,
  TenantTokenError,
} = require('../dist/tenantSecurity');

test('accepts valid route slugs and blocks reserved paths', () => {
  assert.equal(isValidTenantSlug('tienda-demo'), true);
  assert.equal(isValidTenantSlug('admin'), false);
  assert.equal(isValidTenantSlug('Uppercase'), false);
  assert.equal(isValidTenantSlug('bad--slug'), false);
});

test('allows anonymous requests but rejects a tenant token used under another slug', () => {
  assert.doesNotThrow(() => assertTenantToken(undefined, 'tenant-a', 'secret'));
  const token = jwt.sign({ tenantId: 'tenant-a', role: 'CLIENT' }, 'secret');
  assert.throws(
    () => assertTenantToken(`Bearer ${token}`, 'tenant-b', 'secret'),
    (error) => error instanceof TenantTokenError && error.statusCode === 403
  );
});

test('rejects invalid and platform tokens on tenant routes', () => {
  assert.throws(
    () => assertTenantToken('Bearer invalid', 'tenant-a', 'secret'),
    (error) => error instanceof TenantTokenError && error.statusCode === 401
  );
  const token = jwt.sign({ tenantId: 'tenant-a', role: 'SUPER_ADMIN', scope: 'platform' }, 'secret');
  assert.throws(
    () => assertTenantToken(`Bearer ${token}`, 'tenant-a', 'secret'),
    (error) => error instanceof TenantTokenError && error.statusCode === 403
  );
});
