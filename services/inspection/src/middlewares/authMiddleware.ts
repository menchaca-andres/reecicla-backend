import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthPayload } from '../types/inspection';

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET debe estar configurado.');
  return secret;
}

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
    const decoded = jwt.verify(token, jwtSecret()) as Partial<AuthPayload>;
    if (decoded.role === 'SUPER_ADMIN' || !decoded.tenantId || !decoded.userId) {
      res.status(403).json({ error: 'La sesión de plataforma no puede acceder a funciones de un negocio.' });
      return;
    }
    // ADR-001: el Gateway inyecta x-tenant-id al resolver el slug de la URL.
    const tenantId = req.header('x-tenant-id');
    if (tenantId && tenantId !== decoded.tenantId) {
      res.status(403).json({ error: 'Tu sesión no pertenece al negocio solicitado.' });
      return;
    }
    req.authUser = decoded as AuthPayload;
    next();
  } catch {
    res.status(403).json({ error: 'Token inválido o expirado.' });
  }
};

export const authorizeRoles = (...allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Usuario no autenticado.' });
      return;
    }

    if (!allowedRoles.includes(req.authUser.role)) {
      res.status(403).json({
        error: `Acceso denegado. Se requiere uno de los siguientes roles: ${allowedRoles.join(', ')}`,
      });
      return;
    }

    next();
  };
};
