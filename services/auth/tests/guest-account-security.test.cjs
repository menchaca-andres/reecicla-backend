const assert = require('node:assert/strict');
const { test } = require('node:test');
const bcrypt = require('bcrypt');
const { AuthService } = require('../dist/services/authService');
const { UserModel } = require('../dist/models/userModel');
const { GuestVerificationModel } = require('../dist/models/guestVerificationModel');
const { EmailService } = require('../dist/services/emailService');
const EventBus = require('../dist/messaging/eventBus');

test('does not send a verification code or create a token for an existing account', async () => {
  const originals = {
    findAnyByEmailAndTenant: UserModel.findAnyByEmailAndTenant,
    create: GuestVerificationModel.create,
    sendGuestVerification: EmailService.sendGuestVerification,
  };
  let emailSent = false;
  UserModel.findAnyByEmailAndTenant = async () => ({
    id: 'existing-user',
    tenant_id: 'tenant-id',
    email: 'customer@example.com',
    name: 'Existing customer',
    role: 'CLIENT',
    is_active: true,
  });
  GuestVerificationModel.create = async () => {
    throw new Error('A verification must not be created for an existing account.');
  };
  EmailService.sendGuestVerification = async () => {
    emailSent = true;
  };

  try {
    await assert.rejects(
      AuthService.requestGuestVerification({
        tenant_id: 'tenant-id',
        quote_id: 'quote-id',
        email: 'customer@example.com',
        name: 'Impersonator',
        phone: '555-0100',
      }),
      /Inicia sesión para aceptar la cotización/
    );
    assert.equal(emailSent, false);
  } finally {
    Object.assign(UserModel, { findAnyByEmailAndTenant: originals.findAnyByEmailAndTenant });
    Object.assign(GuestVerificationModel, { create: originals.create });
    Object.assign(EmailService, { sendGuestVerification: originals.sendGuestVerification });
  }
});

test('does not create an account before a valid verification code is supplied', async () => {
  const originals = {
    findAnyByEmailAndTenant: UserModel.findAnyByEmailAndTenant,
    create: GuestVerificationModel.create,
    consume: GuestVerificationModel.consume,
    sendGuestVerification: EmailService.sendGuestVerification,
    createUser: UserModel.createUser,
  };
  let deliveredCode;
  let accountCreated = false;
  UserModel.findAnyByEmailAndTenant = async () => null;
  GuestVerificationModel.create = async (_details, code) => {
    deliveredCode = code;
    return { id: 'verification-id' };
  };
  GuestVerificationModel.consume = async () => null;
  EmailService.sendGuestVerification = async (_email, _name, code) => {
    deliveredCode = code;
  };
  UserModel.createUser = async () => {
    accountCreated = true;
    throw new Error('Account creation should wait for code verification.');
  };

  try {
    await AuthService.requestGuestVerification({
      tenant_id: 'tenant-id',
      quote_id: 'quote-id',
      email: 'new@example.com',
      name: 'New customer',
      phone: '555-0100',
    });
    assert.match(deliveredCode, /^\d{6}$/);
    await assert.rejects(
      AuthService.verifyGuestClient({
        tenant_id: 'tenant-id',
        quote_id: 'quote-id',
        email: 'new@example.com',
        code: '000000',
        password: 'password-test',
      }),
      /inválido o venció/
    );
    assert.equal(accountCreated, false);
  } finally {
    Object.assign(UserModel, {
      findAnyByEmailAndTenant: originals.findAnyByEmailAndTenant,
      createUser: originals.createUser,
    });
    Object.assign(GuestVerificationModel, {
      create: originals.create,
      consume: originals.consume,
    });
    Object.assign(EmailService, { sendGuestVerification: originals.sendGuestVerification });
  }
});

test('creates a client and returns a JWT only after code verification', async () => {
  const originals = {
    findAnyByEmailAndTenant: UserModel.findAnyByEmailAndTenant,
    createUser: UserModel.createUser,
    consume: GuestVerificationModel.consume,
    publishEvent: EventBus.publishEvent,
    jwtSecret: process.env.JWT_SECRET,
  };
  let createdPasswordHash;
  UserModel.findAnyByEmailAndTenant = async () => null;
  GuestVerificationModel.consume = async () => ({
    tenant_id: 'tenant-id',
    quote_id: 'quote-id',
    email: 'verified@example.com',
    name: 'Verified customer',
    phone: '555-0100',
  });
  UserModel.createUser = async (user, passwordHash) => {
    createdPasswordHash = passwordHash;
    return {
      id: 'created-user',
      ...user,
      password_hash: passwordHash,
      created_at: new Date(),
    };
  };
  EventBus.publishEvent = async () => ({});
  process.env.JWT_SECRET = 'test-jwt-secret';

  try {
    const result = await AuthService.verifyGuestClient({
      tenant_id: 'tenant-id',
      quote_id: 'quote-id',
      email: 'verified@example.com',
      code: '123456',
      password: 'password-test',
    });
    assert.equal(result.created, true);
    assert.equal(result.user.email, 'verified@example.com');
    assert.ok(result.token);
    assert.notEqual(createdPasswordHash, 'password-test');
    assert.equal(await bcrypt.compare('password-test', createdPasswordHash), true);
  } finally {
    Object.assign(UserModel, {
      findAnyByEmailAndTenant: originals.findAnyByEmailAndTenant,
      createUser: originals.createUser,
    });
    Object.assign(GuestVerificationModel, { consume: originals.consume });
    Object.assign(EventBus, { publishEvent: originals.publishEvent });
    if (originals.jwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originals.jwtSecret;
  }
});
