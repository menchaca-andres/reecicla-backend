const assert = require('node:assert/strict');
const { test } = require('node:test');
const { AuthService } = require('../dist/services/authService');
const { UserModel } = require('../dist/models/userModel');

test('updates contact details using the authenticated tenant and returns the saved address', async () => {
  const original = UserModel.updateClientProfile;
  let update;
  UserModel.updateClientProfile = async (userId, tenantId, profile) => {
    update = { userId, tenantId, profile };
    return {
      id: userId,
      tenant_id: tenantId,
      email: 'client@example.com',
      name: profile.name,
      phone: profile.phone,
      pickup_address: profile.pickup_address,
      role: 'CLIENT',
      created_at: new Date(),
    };
  };

  try {
    const result = await AuthService.updateUserProfile('user-id', 'tenant-id', {
      name: '  Client Name  ',
      phone: ' 555-0100 ',
      pickup_address: '  Main Street 123 ',
    });
    assert.deepEqual(update, {
      userId: 'user-id',
      tenantId: 'tenant-id',
      profile: {
        name: 'Client Name',
        phone: '555-0100',
        pickup_address: 'Main Street 123',
      },
    });
    assert.equal(result.pickup_address, 'Main Street 123');
    assert.equal(result.email, 'client@example.com');
  } finally {
    UserModel.updateClientProfile = original;
  }
});

test('rejects invalid profile data without writing it', async () => {
  const original = UserModel.updateClientProfile;
  let updated = false;
  UserModel.updateClientProfile = async () => {
    updated = true;
    return null;
  };

  try {
    await assert.rejects(
      AuthService.updateUserProfile('user-id', 'tenant-id', {
        name: '  ',
        phone: '',
        pickup_address: '',
      }),
      /nombre debe tener/
    );
    assert.equal(updated, false);
  } finally {
    UserModel.updateClientProfile = original;
  }
});
