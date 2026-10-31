import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthPayload } from '../types/reporting';

export interface AuthenticatedRequest extends Request {
  authUser?: AuthPayload;
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET debe estar configurado.');
  return secret;
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
  let payload: AuthPayload;
  try {
    payload = jwt.verify(token, jwtSecret()) as AuthPayload;
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado.' });
    return;
  }
  if (payload.role === 'SUPER_ADMIN') {
    res.status(403).json({ error: 'La sesión de plataforma no puede ver reportes de un negocio.' });
    return;
  }
  if (!payload.tenantId) {
    res.status(403).json({ error: 'Tu sesión no pertenece a ningún negocio.' });
    return;
  }
  // Por las rutas /recicla/:slug/... el gateway resuelve el negocio y envía
  // x-tenant-id; debe coincidir con el tenant del token.
  const tenantHeader = req.header('x-tenant-id');
  if (tenantHeader && tenantHeader !== payload.tenantId) {
    res.status(403).json({ error: 'Tu sesión no pertenece al negocio solicitado.' });
    return;
  }
  req.authUser = payload;
  next();
};

export const authorizeRoles = (...allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Usuario no autenticado.' });
      return;
    }
    if (!allowedRoles.includes(req.authUser.role)) {
      res.status(403).json({ error: 'Solo el administrador del negocio puede ver los reportes.' });
      return;
    }
    next();
  };
};
