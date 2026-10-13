import { Request, Response, NextFunction } from 'express';

export const requireInternalService = (req: Request, res: Response, next: NextFunction): void => {
  const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
  const suppliedToken = req.header('x-internal-service-token');

  if (!expectedToken || suppliedToken !== expectedToken) {
    res.status(403).json({ error: 'Acceso restringido a servicios internos.' });
    return;
  }

  next();
};