const assert = require('node:assert/strict');
const { test } = require('node:test');
const { AuthService } = require('../dist/services/authService');
const { UserModel } = require('../dist/models/userModel');
const { ClientRegistrationModel } = require('../dist/models/clientRegistrationModel');
const { EmailService } = require('../dist/services/emailService');
const eventBus = require('../dist/messaging/eventBus');

test('requests a registration OTP scoped to the route tenant and creates no account yet', async () => {
  const originals = {
    findAnyByEmailAndTenant: UserModel.findAnyByEmailAndTenant,
    create: ClientRegistrationModel.create,
    send: EmailService.sendClientRegistrationVerification,
  };
  let saved;
  let mailed;
  UserModel.findAnyByEmailAndTenant = async () => null;
  ClientRegistrationModel.create = async (dto, passwordHash, code) => {
    saved = { dto, passwordHash, code };
  };
  EmailService.sendClientRegistrationVerification = async (_email, _name, code) => {
    mailed = code;
  };
  try {
    await AuthService.register({
      tenant_id: 'tenant-from-route',
      email: ' Client@Example.com ',
      password: 'correct-horse-battery-staple',
      name: 'Client',
    });
    assert.equal(saved.dto.tenant_id, 'tenant-from-route');
    assert.equal(saved.dto.email, 'client@example.com');
    assert.match(saved.passwordHash, /^\$2/);
    assert.match(saved.code, /^\d{6}$/);
    assert.equal(mailed, saved.code);
  } finally {
    Object.assign(UserModel, { findAnyByEmailAndTenant: originals.findAnyByEmailAndTenant });
    Object.assign(ClientRegistrationModel, { create: originals.create });
    Object.assign(EmailService, { sendClientRegistrationVerification: originals.send });
  }
});

test('does not send an OTP or create a second account for an existing tenant email', async () => {
  const originals = {
    findAnyByEmailAndTenant: UserModel.findAnyByEmailAndTenant,
    create: ClientRegistrationModel.create,
    send: EmailService.sendClientRegistrationVerification,
  };
  let touched = false;
  UserModel.findAnyByEmailAndTenant = async () => ({ id: 'existing-user' });
  ClientRegistrationModel.create = async () => { touched = true; };
  EmailService.sendClientRegistrationVerification = async () => { touched = true; };
  try {
    await AuthService.register({
      tenant_id: 'tenant-a',
      email: 'client@example.com',
      password: 'correct-horse-battery-staple',
    });
    assert.equal(touched, false);
  } finally {
    Object.assign(UserModel, { findAnyByEmailAndTenant: originals.findAnyByEmailAndTenant });
    Object.assign(ClientRegistrationModel, { create: originals.create });
    Object.assign(EmailService, { sendClientRegistrationVerification: originals.send });
  }
});

test('creates a tenant account and signs in only after OTP verification', async () => {
  const originals = {
    verifyAndCreateUser: ClientRegistrationModel.verifyAndCreateUser,
    publishEvent: eventBus.publishEvent,
    jwtSecret: process.env.JWT_SECRET,
  };
  const user = {
    id: 'user-id',
    tenant_id: 'tenant-a',
    email: 'client@example.com',
    name: 'Client',
    role: 'CLIENT',
    created_at: new Date(),
  };
  ClientRegistrationModel.verifyAndCreateUser = async (tenantId, email, code) => {
    assert.equal(tenantId, 'tenant-a');
    assert.equal(email, 'client@example.com');
    assert.equal(code, '123456');
    return user;
  };
  eventBus.publishEvent = async () => ({});
  process.env.JWT_SECRET = 'test-jwt-secret';
  try {
    const result = await AuthService.verifyClientRegistration('tenant-a', 'CLIENT@example.com', '123456');
    assert.equal(result.user.tenant_id, 'tenant-a');
    assert.ok(result.token);
  } finally {
    Object.assign(ClientRegistrationModel, { verifyAndCreateUser: originals.verifyAndCreateUser });
    Object.assign(eventBus, { publishEvent: originals.publishEvent });
    if (originals.jwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originals.jwtSecret;
  }
});
