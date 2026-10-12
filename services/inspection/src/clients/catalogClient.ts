import { DomainError } from '../domain/errors';
import { EvaluationRule } from '../types/inspection';

const CATALOG_SERVICE_URL = process.env.CATALOG_SERVICE_URL || 'http://localhost:3003';
const TIMEOUT_MS = 5000;

/** Checklist vigente del tipo en Catalog (HU-008). Devuelve null si el tipo no tiene regla activa. */
export async function getActiveEvaluationRule(tenantId: string, deviceTypeId: string): Promise<EvaluationRule | null> {
  const url = new URL('/api/catalog/evaluation-rules/active', CATALOG_SERVICE_URL);
  url.searchParams.set('device_type_id', deviceTypeId);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'x-tenant-id': tenantId },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new DomainError(502, 'No se pudo consultar la checklist en el catálogo. Inténtalo de nuevo.');
  }
  if (!response.ok) {
    throw new DomainError(502, 'No se pudo consultar la checklist en el catálogo. Inténtalo de nuevo.');
  }

  const body = (await response.json()) as { rule?: EvaluationRule | null };
  const rule = body.rule ?? null;
  if (!rule) return null;
  if (!Array.isArray(rule.checklist)) {
    throw new DomainError(502, 'El catálogo devolvió una checklist con formato inválido.');
  }
  return rule;
}
