import { Request, Response } from 'express';
import { AuthService } from '../services/authService';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

export class AuthController {
  // Public client self-registration (ALWAYS forces role = 'CLIENT')
  static async register(req: Request, res: Response): Promise<void> {
    try {
      const tenant_id = req.header('x-tenant-id')?.trim();
      const { email, password, name, phone } = req.body;

      if (!tenant_id || !email || !password) {
        res.status(400).json({ error: 'email, password y el contexto del negocio son requeridos.' });
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
        message: 'Usuario cliente registrado exitosamente.',
        ...result,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Error al registrar el usuario.' });
    }
  }

  // Superadmin endpoint to create a Tenant Admin
  static async createAdmin(req: Request, res: Response): Promise<void> {
    try {
      const { tenant_id, email, password, name, phone } = req.body;

      if (!tenant_id || !email || !password) {
        res.status(400).json({ error: 'tenant_id, email y password son requeridos.' });
        return;
      }

      const adminUser = await AuthService.createAdmin({
        tenant_id,
        email,
        password,
        name,
        phone,
      });

      res.status(201).json({
        message: 'Administrador de tenant creado exitosamente.',
        user: adminUser,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Error al crear el administrador.' });
    }
  }

  static async login(req: Request, res: Response): Promise<void> {
    try {
      const tenant_id = req.header('x-tenant-id')?.trim();
      const { email, password } = req.body;

      if (!tenant_id || !email || !password) {
        res.status(400).json({ error: 'email, password y el contexto del negocio son requeridos.' });
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

  static async requestGuestVerification(req: Request, res: Response): Promise<void> {
    try {
      const tenant_id = req.header('x-tenant-id')?.trim() || req.body?.tenant_id;
      const { email, name, phone, address, quote_id } = req.body ?? {};
      await AuthService.requestGuestVerification({
        tenant_id: tenant_id || '',
        quote_id: quote_id || '',
        email: email || '',
        name: name || '',
        phone: phone || '',
        address: address || '',
      });
      res.status(202).json({
        verification_required: true,
        message: 'Enviamos un código de verificación a tu correo.',
      });
    } catch (error: any) {
      const message = error.message || 'No se pudo enviar el código de verificación.';
      const statusCode = message.includes('ya tiene una cuenta') || message.includes('usuario interno') ? 409 :
        message.includes('Espera un minuto') ? 429 :
          message.includes('SMTP_') || message.includes('verificar correos') ? 503 : 400;
      res.status(statusCode).json({ error: message });
    }
  }

  static async verifyGuestClient(req: Request, res: Response): Promise<void> {
    try {
      const tenant_id = req.header('x-tenant-id')?.trim() || req.body?.tenant_id;
      const { email, code, quote_id } = req.body ?? {};
      const result = await AuthService.verifyGuestClient({
        tenant_id: tenant_id || '',
        quote_id: quote_id || '',
        email: email || '',
        code: code || '',
      });
      res.status(200).json({
        message: 'Correo verificado.',
        ...result,
      });
    } catch (error: any) {
      const message = error.message || 'No se pudo verificar el correo.';
      const statusCode = message.includes('inválido o venció') ? 422 :
          message.includes('requeridos') || message.includes('no es válido') ? 400 : 503;
      res.status(statusCode).json({ error: message });
    }
  }

  static async getProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.authUser) {
        res.status(401).json({ error: 'Usuario no autenticado.' });
        return;
      }

      const user = await AuthService.getUserProfile(req.authUser.userId);
      res.status(200).json({ user });
    } catch (error: any) {
      res.status(404).json({ error: error.message || 'Error al obtener el perfil.' });
    }
  }
}
