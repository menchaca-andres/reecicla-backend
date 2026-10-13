// Prueba de punta a punta de HU-015 a través del Gateway.
// Requiere todo el sistema arriba (docker compose up -d) y crea datos reales:
// un inspector, un cliente, una cotización, una orden y una inspección.
//
//   node tests/e2e/hu015-flow.mjs
//
// Variables opcionales: GATEWAY_URL, TENANT_SLUG, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD.
// Las rutas del negocio van por /recicla/{slug}/... (ADR-001); el superadmin es de plataforma.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
const TENANT_SLUG = process.env.TENANT_SLUG || 'demo';
const T = `/recicla/${TENANT_SLUG}`;
const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL || 'superadmin@reecicla.com';
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || 'superadmin123';
const run = randomUUID().slice(0, 8);

let passed = 0;

async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function check(name, condition, detail) {
  assert.ok(condition, `${name}${detail ? ` → ${JSON.stringify(detail)}` : ''}`);
  passed++;
  console.log(`  ok  ${name}`);
}

async function waitFor(description, fn, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Tiempo de espera agotado: ${description}`);
}

function answerFor(criterion) {
  if (criterion.type === 'boolean') return true;
  if (criterion.type === 'number') return 4;
  if (criterion.type === 'select') return criterion.options[0];
  return 'Sin novedad';
}

console.log(`HU-015 E2E contra ${GATEWAY_URL} (corrida ${run})`);

// ── Preparación: usuarios ───────────────────────────────────
const tenant = await call('GET', `/api/auth/tenants/slug/${TENANT_SLUG}`);
assert.equal(tenant.status, 200, `negocio '${TENANT_SLUG}': ${JSON.stringify(tenant.json)}`);
const TENANT_ID = tenant.json.tenant_id;

const platform = await call('POST', '/api/auth/platform/login', {
  body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD },
});
assert.equal(platform.status, 200, `login de plataforma: ${JSON.stringify(platform.json)}`);
const platformToken = platform.json.token;

async function createStaff(role) {
  const email = `${role.toLowerCase()}.${run}@example.invalid`;
  const created = await call('POST', '/api/auth/admin', {
    token: platformToken,
    body: { tenant_id: TENANT_ID, email, password: 'staff12345', name: `${role} ${run}`, role },
  });
  const login = await call('POST', `${T}/auth/login`, { body: { email, password: 'staff12345' } });
  assert.equal(login.status, 200, `login ${role}: ${JSON.stringify(login.json)}`);
  return { created, login };
}

const inspectorAccount = await createStaff('INSPECTOR');
check('se puede crear un usuario con rol INSPECTOR', inspectorAccount.created.status === 201 && inspectorAccount.created.json.user?.role === 'INSPECTOR', inspectorAccount.created.json);
const inspector = inspectorAccount.login;
const inspectorToken = inspector.json.token;
const adminToken = (await createStaff('TENANT_ADMIN')).login.json.token;

const client = await call('POST', `${T}/auth/register`, {
  body: { email: `cliente.${run}@example.invalid`, password: 'cliente123', name: `Cliente ${run}` },
});
assert.equal(client.status, 201, `registro cliente: ${JSON.stringify(client.json)}`);
const clientToken = client.json.token;

// ── Preparación: cotización → orden → recepción (HU-005 a HU-014) ──
const types = await call('GET', `${T}/catalog/device-types`);
const deviceTypes = types.json.device_types || types.json.deviceTypes || [];
assert.ok(deviceTypes.length > 0, 'no hay tipos de dispositivo en el catálogo');

// Cotizar exige una regla de valoración: se usa un tipo que ya la tenga o se crea una.
const rules = await call('GET', `${T}/quotation/rules`, { token: adminToken });
const pricedCodes = new Set((rules.json.rules || []).map((rule) => rule.device_type));
let deviceType = deviceTypes.find((type) => pricedCodes.has(type.code));
if (!deviceType) {
  deviceType = deviceTypes[0];
  const rule = await call('POST', `${T}/quotation/rules`, {
    token: adminToken,
    body: { device_type: deviceType.code, rule_key: 'base_price', rule_value: { amount: 500, currency: 'BOB' } },
  });
  assert.equal(rule.status, 201, `crear regla de valoración: ${JSON.stringify(rule.json)}`);
}

const quote = await call('POST', `${T}/quotation/quotes`, {
  token: clientToken,
  headers: { 'Idempotency-Key': randomUUID() },
  body: { device_type: deviceType.code, brand: 'Marca E2E', model: `Modelo ${run}`, year: 2021, condition: 'working' },
});
assert.equal(quote.status, 201, `crear cotización: ${JSON.stringify(quote.json)}`);
const quoteId = quote.json.quote.id;

const accepted = await call('POST', `${T}/quotation/quotes/${quoteId}/accept`, {
  token: clientToken,
  body: { phone: '70000000', address: `Calle E2E ${run}, La Paz` },
});
assert.equal(accepted.status, 200, `aceptar cotización: ${JSON.stringify(accepted.json)}`);

const order = await waitFor('orden creada desde QuoteAccepted', async () => {
  const res = await call('GET', `${T}/orders`, { token: clientToken });
  return (res.json.orders || []).find((candidate) => candidate.quote_id === quoteId);
});
const orderId = order.id;

const beforeReceipt = await call('GET', `${T}/inspections/pending`, { token: inspectorToken });
check('una orden aún no recibida no aparece como pendiente', beforeReceipt.status === 200 && !beforeReceipt.json.pending.some((d) => d.order_id === orderId));

const notReceived = await call('GET', `${T}/inspections/orders/${orderId}/checklist`, { token: inspectorToken });
check('no hay checklist para una orden no recibida (404)', notReceived.status === 404, notReceived.json);

const dispatched = await call('POST', `${T}/orders/${orderId}/dispatch`, {
  token: adminToken,
  body: { tracking_code: `E2E-${run}`, status: 'IN_TRANSIT' },
});
assert.equal(dispatched.status, 200, `despacho: ${JSON.stringify(dispatched.json)}`);
const received = await call('POST', `${T}/orders/${orderId}/receive`, { token: adminToken });
assert.equal(received.status, 200, `recepción: ${JSON.stringify(received.json)}`);

// ── HU-015 ──────────────────────────────────────────────────
console.log('Autorización');
check('sin token → 401', (await call('GET', `${T}/inspections/pending`)).status === 401);
check('CLIENT no puede consultar pendientes → 403', (await call('GET', `${T}/inspections/pending`, { token: clientToken })).status === 403);

console.log('Pendientes y checklist');
const pendingDevice = await waitFor('equipo recibido visible en Inspection (DeviceReceived)', async () => {
  const res = await call('GET', `${T}/inspections/pending`, { token: inspectorToken });
  return (res.json.pending || []).find((device) => device.order_id === orderId);
});
check('el equipo recibido aparece como pendiente de inspección', pendingDevice.device_type_id === order.device_type_id, pendingDevice);

const checklist = await call('GET', `${T}/inspections/orders/${orderId}/checklist`, { token: inspectorToken });
check('la checklist corresponde al tipo de la orden', checklist.status === 200 && checklist.json.device_type_id === order.device_type_id && checklist.json.checklist.length > 0, checklist.json);

const activeRule = await call('GET', `${T}/catalog/evaluation-rules/active?device_type_id=${order.device_type_id}`);
check('la checklist es la versión vigente del catálogo', checklist.json.evaluation_rule_id === activeRule.json.rule.id && checklist.json.evaluation_rule_version === activeRule.json.rule.version);

const validBody = {
  order_id: orderId,
  evaluation_rule_id: checklist.json.evaluation_rule_id,
  evaluation_rule_version: checklist.json.evaluation_rule_version,
  actual_condition: 'damaged',
  observations: `Inspección E2E ${run}`,
  evidence_refs: [`https://fotos.example/${run}/general.jpg`],
  items: checklist.json.checklist.map((criterion, index) => ({
    criterion_key: criterion.id,
    value: answerFor(criterion),
    ...(index === 0 ? { observation: 'Observación del primer criterio', evidence_refs: [`foto-${run}-01`] } : {}),
  })),
};

console.log('Registro');
const asPlatform = await call('POST', `${T}/inspections`, { token: platformToken, body: validBody });
check('la sesión de plataforma (SUPER_ADMIN) no puede registrar → 403', asPlatform.status === 403, asPlatform.json);
const asAdmin = await call('POST', `${T}/inspections`, { token: adminToken, body: validBody });
check('TENANT_ADMIN no puede registrar → 403', asAdmin.status === 403, asAdmin.json);
const asClient = await call('POST', `${T}/inspections`, { token: clientToken, body: validBody });
check('CLIENT no puede registrar → 403', asClient.status === 403, asClient.json);

const unknownOrder = await call('POST', `${T}/inspections`, { token: inspectorToken, body: { ...validBody, order_id: randomUUID() } });
check('orden sin equipo recibido → 404', unknownOrder.status === 404, unknownOrder.json);

const staleVersion = await call('POST', `${T}/inspections`, {
  token: inspectorToken,
  body: { ...validBody, evaluation_rule_version: validBody.evaluation_rule_version + 1 },
});
check('versión de checklist desactualizada → 409', staleVersion.status === 409 && /checklist cambió/.test(staleVersion.json.error), staleVersion.json);

const requiredCriterion = checklist.json.checklist.find((criterion) => criterion.required);
const missingItem = await call('POST', `${T}/inspections`, {
  token: inspectorToken,
  body: { ...validBody, items: validBody.items.filter((item) => item.criterion_key !== requiredCriterion.id) },
});
check('ítem obligatorio sin responder → 400 con detalle', missingItem.status === 400 && missingItem.json.details?.some((d) => d.includes('obligatorio')), missingItem.json);

const badCondition = await call('POST', `${T}/inspections`, { token: inspectorToken, body: { ...validBody, actual_condition: 'como nuevo' } });
check('condición real inválida → 400', badCondition.status === 400, badCondition.json);

const stillPending = await call('GET', `${T}/inspections/pending`, { token: inspectorToken });
check('los intentos rechazados no registran nada', stillPending.json.pending.some((device) => device.order_id === orderId));

const created = await call('POST', `${T}/inspections`, { token: inspectorToken, body: validBody });
check('el INSPECTOR registra la inspección → 201', created.status === 201 && created.json.inspection?.status === 'REGISTERED', created.json);
const inspection = created.json.inspection;
check('se guardan todos los ítems de la checklist', inspection.items.length === checklist.json.checklist.length);
check('se guarda quién inspeccionó, tomado del token', inspection.inspected_by_user === inspector.json.user.id);
check('se guardan observaciones y evidencia', inspection.observations === validBody.observations
  && inspection.evidence_refs.length === 1
  && inspection.items.some((item) => item.observation === 'Observación del primer criterio' && item.evidence_refs[0] === `foto-${run}-01`));
check('el resultado queda pendiente para HU-016', inspection.result === null);

const duplicate = await call('POST', `${T}/inspections`, { token: inspectorToken, body: validBody });
check('segundo registro de la misma orden → 409', duplicate.status === 409, duplicate.json);

console.log('Consulta');
const direct = await call('GET', '/api/inspections', { token: inspectorToken });
check('la ruta sin slug funciona con el tenant del token', direct.status === 200 && direct.json.inspections.some((i) => i.id === inspection.id));
const detail = await call('GET', `${T}/inspections/orders/${orderId}`, { token: inspectorToken });
check('la inspección se puede consultar con sus ítems', detail.status === 200 && detail.json.inspection.id === inspection.id && detail.json.inspection.items.length === inspection.items.length);
const adminList = await call('GET', `${T}/inspections`, { token: adminToken });
check('el administrador del negocio puede consultar las inspecciones', adminList.status === 200 && adminList.json.inspections.some((i) => i.id === inspection.id));
const afterPending = await call('GET', `${T}/inspections/pending`, { token: inspectorToken });
check('la orden inspeccionada deja de estar pendiente', !afterPending.json.pending.some((device) => device.order_id === orderId));
const badId = await call('GET', `${T}/inspections/orders/no-es-uuid`, { token: inspectorToken });
check('identificador de orden inválido → 400', badId.status === 400, badId.json);

console.log(`\n${passed} verificaciones correctas. Orden ${order.order_number} (${orderId}), inspección ${inspection.id}.`);
