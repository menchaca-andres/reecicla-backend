import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthPayload } from '../types/quotation';

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET debe estar configurado.');
  return secret;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthPayload;
}

export const authenticateOptionalToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    next();
    return;
  }

  try {
    req.authUser = jwt.verify(token, jwtSecret()) as AuthPayload;
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
    const decoded = jwt.verify(token, jwtSecret()) as AuthPayload;
    req.authUser = decoded;
    next();
  } catch (error) {
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
        error: `Acceso denegado. Se requiere rol: ${allowedRoles.join(', ')}`,
      });
      return;
    }

    next();
  };
};
