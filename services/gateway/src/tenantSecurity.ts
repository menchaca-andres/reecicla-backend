import jwt from 'jsonwebtoken';

const TENANT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const RESERVED_TENANT_SLUGS = new Set([
  'admin', 'api', 'auth', 'catalogo', 'health', 'historial', 'inspeccion',
  'logistica', 'quote', 'recicla', 'reglas', 'seguimiento', 'www',
]);

export class TenantTokenError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 401 | 403
  ) {
    super(message);
  }
}

export function isValidTenantSlug(slug: string): boolean {
  return slug.length <= 60 &&
    TENANT_SLUG_PATTERN.test(slug) &&
    !RESERVED_TENANT_SLUGS.has(slug);
}

export function assertTenantToken(
  authorization: string | undefined,
  tenantId: string,
  secret: string
): void {
  if (!authorization) return;
  const [scheme, token, ...extra] = authorization.trim().split(/\s+/);
  if (scheme !== 'Bearer' || !token || extra.length > 0) {
    throw new TenantTokenError('Token de autenticación inválido.', 401);
  }

  let decoded: jwt.JwtPayload;
  try {
    const verified = jwt.verify(token, secret);
    if (typeof verified === 'string') throw new Error('Invalid token payload');
    decoded = verified;
  } catch {
    throw new TenantTokenError('Token inválido o expirado.', 401);
  }

  if (
    decoded.scope === 'platform' ||
    decoded.role === 'SUPER_ADMIN' ||
    decoded.tenantId !== tenantId
  ) {
    throw new TenantTokenError('La sesión no pertenece a este negocio.', 403);
  }
}
