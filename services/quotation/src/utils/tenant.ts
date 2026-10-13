import { AuthenticatedRequest } from '../middlewares/authMiddleware';

export function gatewayTenantId(req: AuthenticatedRequest): string | undefined {
  const header = req.header('x-tenant-id')?.trim();
  return header || undefined;
}

export function assertTenantAccess(req: AuthenticatedRequest, tenantId: string): string | null {
  if (req.authUser && req.authUser.role !== 'SUPER_ADMIN' && req.authUser.tenantId !== tenantId) {
    return 'No puedes operar en el contexto de otro tenant.';
  }
  return null;
}
