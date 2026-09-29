import { Request, Response } from 'express';
import { AuthService } from '../services/authService';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

export class AuthController {
  static async register(req: Request, res: Response): Promise<void> {
    try {
      const { tenant_id, email, password, name, phone } = req.body;

      if (!tenant_id || !email || !password) {
        res.status(400).json({ error: 'tenant_id, email y password son requeridos.' });
        return;
      }

      const result = await AuthService.register({
        tenant_id,
        email,
        password,
        name,
        phone,
      });

      res.status(201).json({
        message: 'Usuario registrado exitosamente.',
        ...result,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Error al registrar el usuario.' });
    }
  }

  static async login(req: Request, res: Response): Promise<void> {
    try {
      const { tenant_id, email, password } = req.body;

      if (!tenant_id || !email || !password) {
        res.status(400).json({ error: 'tenant_id, email y password son requeridos.' });
        return;
      }

      const result = await AuthService.login({ tenant_id, email, password });

      res.status(200).json({
        message: 'Inicio de sesión exitoso.',
        ...result,
      });
    } catch (error: any) {
      res.status(401).json({ error: error.message || 'Error al iniciar sesión.' });
    }
  }

  static async getProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Usuario no autenticado.' });
        return;
      }

      const user = await AuthService.getUserProfile(req.user.userId);
      res.status(200).json({ user });
    } catch (error: any) {
      res.status(404).json({ error: error.message || 'Error al obtener el perfil.' });
    }
  }
}
