import { AuthenticatedRequest } from '../middlewares/authMiddleware';

export function resolveTenantId(req: AuthenticatedRequest): string | undefined {
  const header = req.header('x-tenant-id')?.trim();
  if (header) return header;
  return req.user?.tenantId;
}
