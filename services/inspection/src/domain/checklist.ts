import {
  ChecklistItem,
  ItemResult,
  ItemValue,
  ValidatedInspection,
  ValidatedItem,
} from '../types/inspection';
import { DomainError } from './errors';

// Mismo vocabulario que la condición declarada al cotizar (Quotation).
export const ACTUAL_CONDITIONS = ['working', 'damaged', 'broken'];

export const MAX_EVIDENCE_REFS = 10;
export const MAX_EVIDENCE_REF_LENGTH = 500;
export const MAX_OBSERVATION_LENGTH = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readObservation(raw: unknown, where: string, errors: string[]): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    errors.push(`${where}: la observación debe ser texto.`);
    return null;
  }
  const text = raw.trim();
  if (text.length > MAX_OBSERVATION_LENGTH) {
    errors.push(`${where}: la observación supera los ${MAX_OBSERVATION_LENGTH} caracteres.`);
  }
  return text || null;
}

function readEvidenceRefs(raw: unknown, where: string, errors: string[]): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push(`${where}: las referencias de evidencia deben ser una lista.`);
    return [];
  }
  if (raw.length > MAX_EVIDENCE_REFS) {
    errors.push(`${where}: se permiten como máximo ${MAX_EVIDENCE_REFS} referencias de evidencia.`);
  }
  const refs: string[] = [];
  for (const ref of raw) {
    if (typeof ref !== 'string' || !ref.trim()) {
      errors.push(`${where}: cada referencia de evidencia debe ser un texto no vacío.`);
    } else if (ref.trim().length > MAX_EVIDENCE_REF_LENGTH) {
      errors.push(`${where}: una referencia de evidencia supera los ${MAX_EVIDENCE_REF_LENGTH} caracteres.`);
    } else {
      refs.push(ref.trim());
    }
  }
  return refs;
}

function readValue(criterion: ChecklistItem, raw: unknown, errors: string[]): ItemValue | undefined {
  const where = `"${criterion.label}"`;
  switch (criterion.type) {
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      errors.push(`${where}: se espera sí o no.`);
      return undefined;
    case 'number':
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      errors.push(`${where}: se espera un número.`);
      return undefined;
    case 'text':
      if (typeof raw === 'string' && raw.trim()) return raw.trim();
      errors.push(`${where}: se espera un texto no vacío.`);
      return undefined;
    case 'select':
      if (typeof raw === 'string' && (criterion.options ?? []).includes(raw)) return raw;
      errors.push(`${where}: se espera una de las opciones de la checklist.`);
      return undefined;
    default:
      errors.push(`${where}: tipo de criterio no soportado.`);
      return undefined;
  }
}

function isAnswered(raw: unknown): boolean {
  return raw !== undefined && raw !== null && !(typeof raw === 'string' && !raw.trim());
}

/**
 * Valida el registro de una inspección contra la checklist vigente del tipo.
 * No toca la base de datos: recibe el body tal cual llegó y la checklist de Catalog.
 */
export function validateInspectionInput(body: unknown, checklist: ChecklistItem[]): ValidatedInspection {
  if (!isRecord(body)) {
    throw new DomainError(400, 'El cuerpo de la solicitud es inválido.');
  }

  const errors: string[] = [];

  const actualCondition = typeof body.actual_condition === 'string' ? body.actual_condition.trim().toLowerCase() : '';
  if (!ACTUAL_CONDITIONS.includes(actualCondition)) {
    errors.push(`La condición real (actual_condition) debe ser una de: ${ACTUAL_CONDITIONS.join(', ')}.`);
  }

  const observations = readObservation(body.observations, 'Inspección', errors);
  const evidenceRefs = readEvidenceRefs(body.evidence_refs, 'Inspección', errors);

  if (!Array.isArray(body.items)) {
    throw new DomainError(400, 'Los datos de la inspección no son válidos.', [
      ...errors,
      'Se requiere la lista de ítems (items) de la checklist.',
    ]);
  }

  const criteriaByKey = new Map(checklist.map((criterion) => [criterion.id, criterion]));
  const answers = new Map<string, Record<string, unknown>>();

  for (const rawItem of body.items) {
    if (!isRecord(rawItem) || typeof rawItem.criterion_key !== 'string' || !rawItem.criterion_key) {
      errors.push('Cada ítem debe indicar su criterio (criterion_key).');
      continue;
    }
    const key = rawItem.criterion_key;
    if (!criteriaByKey.has(key)) {
      errors.push(`El criterio "${key}" no pertenece a la checklist vigente.`);
      continue;
    }
    if (answers.has(key)) {
      errors.push(`El criterio "${key}" está repetido.`);
      continue;
    }
    answers.set(key, rawItem);
  }

  const items: ValidatedItem[] = [];
  for (const criterion of checklist) {
    const answer = answers.get(criterion.id);
    if (!answer || !isAnswered(answer.value)) {
      if (criterion.required) {
        errors.push(`"${criterion.label}": es obligatorio.`);
      }
      continue;
    }

    const value = readValue(criterion, answer.value, errors);
    const where = `"${criterion.label}"`;
    const observation = readObservation(answer.observation, where, errors);
    const itemEvidence = readEvidenceRefs(answer.evidence_refs, where, errors);
    if (value === undefined) continue;

    let result: ItemResult | null = null;
    if (criterion.type === 'boolean') result = value ? 'PASS' : 'FAIL';

    items.push({
      criterion_key: criterion.id,
      criterion_label: criterion.label,
      criterion_type: criterion.type,
      value,
      result,
      observation,
      evidence_refs: itemEvidence,
    });
  }

  if (errors.length > 0) {
    throw new DomainError(400, 'Los datos de la inspección no son válidos.', errors);
  }

  return {
    actual_condition: actualCondition,
    observations,
    evidence_refs: evidenceRefs,
    items,
  };
}
