import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { timingSafeEqual } from 'crypto';
import { AuthPayload } from '../types/payment';

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
  try {
    const payload = jwt.verify(token, jwtSecret()) as AuthPayload;
    if (payload.role === 'SUPER_ADMIN') {
      res.status(403).json({ error: 'La sesión de plataforma no puede acceder a pagos de un negocio.' });
      return;
    }
    const tenantId = req.header('x-tenant-id');
    if (!tenantId || tenantId !== payload.tenantId) {
      res.status(403).json({ error: 'Tu sesión no pertenece al negocio solicitado.' });
      return;
    }
    req.authUser = payload;
    next();
  } catch {
    res.status(403).json({ error: 'Token inválido o expirado.' });
  }
};

export const authenticateInternalService = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  const provided = req.header('x-internal-service-token');
  if (!expected || !provided) {
    res.status(403).json({ error: 'Autenticación de servicio requerida.' });
    return;
  }
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    res.status(403).json({ error: 'Autenticación de servicio inválida.' });
    return;
  }
  next();
};

export const authorizeRoles = (...allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Usuario no autenticado.' });
      return;
    }
    if (!allowedRoles.includes(req.authUser.role)) {
      res.status(403).json({ error: 'No tienes permisos para registrar pagos.' });
      return;
    }
    next();
  };
};
