import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthPayload } from '../types/orders';

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
    req.authUser = jwt.verify(token, jwtSecret()) as AuthPayload;
    next();
  } catch {
    res.status(403).json({ error: 'Token inválido o expirado.' });
  }
};