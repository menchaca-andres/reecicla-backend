const assert = require('node:assert/strict');
const { test } = require('node:test');
const { AuthService } = require('../dist/services/authService');
const { UserModel } = require('../dist/models/userModel');
const { GuestVerificationModel } = require('../dist/models/guestVerificationModel');
const { EmailService } = require('../dist/services/emailService');

test('sends verification for a customer email even when a tenant account already uses it', async () => {
  const originals = {
    findAnyByEmailAndTenant: UserModel.findAnyByEmailAndTenant,
    create: GuestVerificationModel.create,
    sendGuestVerification: EmailService.sendGuestVerification,
  };
  let deliveredCode;
  let savedDetails;
  UserModel.findAnyByEmailAndTenant = async () => {
    throw new Error('Guest acceptance must not check for or require an account.');
  };
  GuestVerificationModel.create = async (details, code) => {
    deliveredCode = code;
    savedDetails = details;
    return { id: 'verification-id' };
  };
  EmailService.sendGuestVerification = async (_email, _name, code) => {
    deliveredCode = code;
  };

  try {
    await AuthService.requestGuestVerification({
      tenant_id: 'tenant-id',
      quote_id: 'quote-id',
      email: 'customer@example.com',
      name: 'Customer',
      phone: '555-0100',
      address: 'Main Street 123',
    });
    assert.match(deliveredCode, /^\d{6}$/);
    assert.equal(savedDetails.email, 'customer@example.com');
    assert.equal(savedDetails.address, 'Main Street 123');
  } finally {
    Object.assign(UserModel, { findAnyByEmailAndTenant: originals.findAnyByEmailAndTenant });
    Object.assign(GuestVerificationModel, { create: originals.create });
    Object.assign(EmailService, { sendGuestVerification: originals.sendGuestVerification });
  }
});

test('does not create an account when verification fails', async () => {
  const originals = {
    consume: GuestVerificationModel.consume,
    createUser: UserModel.createUser,
  };
  let accountCreated = false;
  GuestVerificationModel.consume = async () => null;
  UserModel.createUser = async () => {
    accountCreated = true;
    throw new Error('Guest acceptance must not create an account.');
  };

  try {
    await assert.rejects(
      AuthService.verifyGuestClient({
        tenant_id: 'tenant-id',
        quote_id: 'quote-id',
        email: 'new@example.com',
        code: '000000',
      }),
      /inválido o venció/
    );
    assert.equal(accountCreated, false);
  } finally {
    Object.assign(UserModel, { createUser: originals.createUser });
    Object.assign(GuestVerificationModel, { consume: originals.consume });
  }
});

test('returns verified contact data without creating an account or JWT', async () => {
  const originals = {
    createUser: UserModel.createUser,
    consume: GuestVerificationModel.consume,
  };
  let accountCreated = false;
  GuestVerificationModel.consume = async () => ({
    tenant_id: 'tenant-id',
    quote_id: 'quote-id',
    email: 'verified@example.com',
    name: 'Verified customer',
    phone: '555-0100',
    address: 'Main Street 123',
  });
  UserModel.createUser = async () => {
    accountCreated = true;
    throw new Error('Guest acceptance must not create an account.');
  };

  try {
    const result = await AuthService.verifyGuestClient({
      tenant_id: 'tenant-id',
      quote_id: 'quote-id',
      email: 'verified@example.com',
      code: '123456',
    });
    assert.deepEqual(result, {
      tenant_id: 'tenant-id',
      quote_id: 'quote-id',
      email: 'verified@example.com',
      name: 'Verified customer',
      phone: '555-0100',
      address: 'Main Street 123',
    });
    assert.equal(accountCreated, false);
  } finally {
    Object.assign(UserModel, { createUser: originals.createUser });
    Object.assign(GuestVerificationModel, { consume: originals.consume });
  }
});
