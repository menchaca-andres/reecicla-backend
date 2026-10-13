import { DomainError } from './errors';
import { InspectionResult } from '../types/inspection';

export interface ValidatedInspectionResult {
  result: InspectionResult;
  justification: string;
}

export function validateInspectionResult(input: unknown): ValidatedInspectionResult {
  if (!input || typeof input !== 'object') {
    throw new DomainError(400, 'Debes indicar el resultado y su justificación.');
  }

  const body = input as Record<string, unknown>;
  if (body.result !== 'RESALE' && body.result !== 'RECYCLE') {
    throw new DomainError(400, 'El resultado debe ser RESALE o RECYCLE.');
  }
  if (typeof body.justification !== 'string' || !body.justification.trim()) {
    throw new DomainError(400, 'La justificación del resultado es obligatoria.');
  }
  if (body.justification.trim().length > 2000) {
    throw new DomainError(400, 'La justificación no puede superar los 2000 caracteres.');
  }

  return {
    result: body.result,
    justification: body.justification.trim(),
  };
}
