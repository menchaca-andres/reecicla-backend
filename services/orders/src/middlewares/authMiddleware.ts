import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthPayload } from '../types/orders';

const JWT_SECRET = process.env.JWT_SECRET || 'default_jwt_secret_reecicla';

export interface AuthenticatedRequest extends Request {
  authUser?: AuthPayload;
}

export const authenticateToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const token = req.header('authorization')?.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'Token de autenticación requerido.' });
    return;
  }

  try {
    req.authUser = jwt.verify(token, JWT_SECRET) as AuthPayload;
    const tenantId = req.header('x-tenant-id');
    if (tenantId && req.authUser.role !== 'SUPER_ADMIN' && tenantId !== req.authUser.tenantId) {
      res.status(403).json({ error: 'Tu sesión no pertenece al negocio solicitado.' });
      return;
    }
    next();
  } catch {
    res.status(403).json({ error: 'Token inválido o expirado.' });
  }
};