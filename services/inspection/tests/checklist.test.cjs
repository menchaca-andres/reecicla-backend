const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateInspectionInput } = require('../dist/domain/checklist');
const { DomainError } = require('../dist/domain/errors');

const checklist = [
  { id: 'power_on', label: '¿El equipo enciende?', type: 'boolean', required: true },
  { id: 'cosmetic_condition', label: 'Estado estético (1-10)', type: 'number', required: true },
  { id: 'color', label: 'Color', type: 'select', options: ['blanco', 'gris'], required: true },
  { id: 'notes', label: 'Detalle adicional', type: 'text', required: false },
];

function createBody(overrides = {}) {
  return {
    actual_condition: 'damaged',
    observations: 'Golpe en la puerta lateral.',
    evidence_refs: ['https://fotos.example/general.jpg'],
    items: [
      { criterion_key: 'power_on', value: true },
      { criterion_key: 'cosmetic_condition', value: 4, observation: 'Abolladura', evidence_refs: ['foto-puerta-01'] },
      { criterion_key: 'color', value: 'gris' },
    ],
    ...overrides,
  };
}

function detailsOf(body) {
  try {
    validateInspectionInput(body, checklist);
  } catch (error) {
    assert.ok(error instanceof DomainError);
    assert.equal(error.status, 400);
    return error.details ?? [];
  }
  assert.fail('Se esperaba un error de validación.');
}

test('acepta una checklist completa y guarda el snapshot de cada criterio', () => {
  const result = validateInspectionInput(createBody(), checklist);

  assert.equal(result.actual_condition, 'damaged');
  assert.equal(result.observations, 'Golpe en la puerta lateral.');
  assert.deepEqual(result.evidence_refs, ['https://fotos.example/general.jpg']);
  assert.equal(result.items.length, 3);

  const cosmetic = result.items.find((item) => item.criterion_key === 'cosmetic_condition');
  assert.equal(cosmetic.criterion_label, 'Estado estético (1-10)');
  assert.equal(cosmetic.criterion_type, 'number');
  assert.equal(cosmetic.value, 4);
  assert.equal(cosmetic.result, null);
  assert.equal(cosmetic.observation, 'Abolladura');
  assert.deepEqual(cosmetic.evidence_refs, ['foto-puerta-01']);
});

test('un criterio boolean se traduce a PASS o FAIL', () => {
  const pass = validateInspectionInput(createBody(), checklist);
  assert.equal(pass.items.find((item) => item.criterion_key === 'power_on').result, 'PASS');

  const body = createBody();
  body.items[0].value = false;
  const fail = validateInspectionInput(body, checklist);
  assert.equal(fail.items.find((item) => item.criterion_key === 'power_on').result, 'FAIL');
});

test('rechaza un ítem obligatorio sin responder', () => {
  const body = createBody();
  body.items = body.items.filter((item) => item.criterion_key !== 'power_on');
  assert.ok(detailsOf(body).some((detail) => /enciende.*obligatorio/.test(detail)));
});

test('permite omitir un ítem opcional', () => {
  const result = validateInspectionInput(createBody(), checklist);
  assert.equal(result.items.some((item) => item.criterion_key === 'notes'), false);
});

test('rechaza valores con el tipo incorrecto', () => {
  const body = createBody();
  body.items = [
    { criterion_key: 'power_on', value: 'sí' },
    { criterion_key: 'cosmetic_condition', value: '4' },
    { criterion_key: 'color', value: 'gris' },
    { criterion_key: 'notes', value: 123 },
  ];
  const details = detailsOf(body);
  assert.ok(details.some((detail) => /enciende.*sí o no/.test(detail)));
  assert.ok(details.some((detail) => /estético.*número/.test(detail)));
  assert.ok(details.some((detail) => /Detalle adicional.*texto/.test(detail)));
});

test('rechaza un número no finito', () => {
  const body = createBody();
  body.items[1].value = Number.NaN;
  assert.ok(detailsOf(body).some((detail) => /número/.test(detail)));
});

test('rechaza un select con un valor fuera de las opciones', () => {
  const body = createBody();
  body.items[2].value = 'rojo';
  assert.ok(detailsOf(body).some((detail) => /Color.*opciones/.test(detail)));
});

test('rechaza claves desconocidas y repetidas', () => {
  const body = createBody();
  body.items.push({ criterion_key: 'no_existe', value: true });
  body.items.push({ criterion_key: 'power_on', value: false });
  const details = detailsOf(body);
  assert.ok(details.some((detail) => /no_existe.*no pertenece/.test(detail)));
  assert.ok(details.some((detail) => /power_on.*repetido/.test(detail)));
});

test('exige una condición real válida', () => {
  assert.ok(detailsOf(createBody({ actual_condition: 'como nuevo' })).some((detail) => /actual_condition/.test(detail)));
  assert.ok(detailsOf(createBody({ actual_condition: undefined })).some((detail) => /actual_condition/.test(detail)));
});

test('limita las referencias de evidencia', () => {
  const tooMany = Array.from({ length: 11 }, (_, index) => `foto-${index}`);
  assert.ok(detailsOf(createBody({ evidence_refs: tooMany })).some((detail) => /máximo 10/.test(detail)));
  assert.ok(detailsOf(createBody({ evidence_refs: [''] })).some((detail) => /texto no vacío/.test(detail)));
  assert.ok(detailsOf(createBody({ evidence_refs: 'foto.jpg' })).some((detail) => /lista/.test(detail)));
});

test('rechaza un cuerpo sin lista de ítems', () => {
  assert.ok(detailsOf(createBody({ items: undefined })).some((detail) => /items/.test(detail)));
  assert.throws(() => validateInspectionInput(null, checklist), DomainError);
});
