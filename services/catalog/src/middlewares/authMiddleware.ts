import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthPayload, UserRole } from '../types/catalog';

const JWT_SECRET = process.env.JWT_SECRET || 'default_jwt_secret_reecicla';

export interface AuthenticatedRequest extends Request {
  user?: AuthPayload;
}

const matchesTenantContext = (req: AuthenticatedRequest, res: Response): boolean => {
  const tenantId = req.header('x-tenant-id');
  if (req.user?.role === 'SUPER_ADMIN') {
    res.status(403).json({ error: 'La sesión de plataforma no puede acceder a funciones de un negocio.' });
    return false;
  }
  if (tenantId && req.user && tenantId !== req.user.tenantId) {
    res.status(403).json({ error: 'Tu sesión no pertenece al negocio solicitado.' });
    return false;
  }
  return true;
};

export const authenticatePlatformAdmin = (
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
    const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload;
    if (decoded.role !== 'SUPER_ADMIN' || decoded.scope !== 'platform') {
      res.status(403).json({ error: 'Se requiere una sesión de administrador de plataforma.' });
      return;
    }
    req.user = decoded;
    next();
  } catch {
    res.status(403).json({ error: 'Token inválido o expirado.' });
  }
};

export const authenticateOptionalToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    next();
    return;
  }

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Token de autenticación inválido.' });
    return;
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET) as AuthPayload;
    if (!matchesTenantContext(req, res)) return;
    next();
  } catch {
    res.status(403).json({ error: 'Token inválido o expirado.' });
  }
};

export const authenticateToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Token de autenticación requerido.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.user = decoded;
    if (!matchesTenantContext(req, res)) return;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Token inválido o expirado.' });
  }
};

export const authorizeRoles = (...allowedRoles: UserRole[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Usuario no autenticado.' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: `Acceso denegado. Se requiere uno de los siguientes roles: ${allowedRoles.join(', ')}`,
      });
      return;
    }

    next();
  };
};
