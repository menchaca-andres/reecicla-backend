import { Request, Response } from 'express';
import { AuthService } from '../services/authService';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

export class AuthController {
  static async platformLogin(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
        res.status(400).json({ error: 'Correo y contraseña son requeridos.' });
        return;
      }
      const result = await AuthService.loginPlatform(email, password);
      res.json({ message: 'Inicio de sesión de plataforma exitoso.', ...result });
    } catch (error: any) {
      res.status(401).json({ error: error.message || 'No se pudo iniciar sesión en la plataforma.' });
    }
  }

  static async getPlatformProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.authUser) {
        res.status(401).json({ error: 'Usuario no autenticado.' });
        return;
      }
      const user = await AuthService.getPlatformAdminProfile(req.authUser.userId);
      res.json({ user });
    } catch (error: any) {
      res.status(404).json({ error: error.message || 'Administrador de plataforma no encontrado.' });
    }
  }

  static async register(req: Request, res: Response): Promise<void> {
    try {
      const tenant_id = req.header('x-tenant-id') || req.body.tenant_id;
      const { email, password, name, phone } = req.body;
      if (!tenant_id || !email || !password) {
        res.status(400).json({ error: 'tenant_id, email y password son requeridos.' });
        return;
      }
      const result = await AuthService.register({ tenant_id, email, password, name, phone });
      res.status(201).json({ message: 'Usuario cliente registrado exitosamente.', ...result });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Error al registrar el usuario.' });
    }
  }

  static async createAdmin(req: Request, res: Response): Promise<void> {
    try {
      const { tenant_id, email, password, name, phone, role } = req.body;
      if (!tenant_id || !email || !password) {
        res.status(400).json({ error: 'tenant_id, email y password son requeridos.' });
        return;
      }
      const user = await AuthService.createAdmin({ tenant_id, email, password, name, phone, role });
      res.status(201).json({ message: 'Administrador de tenant creado exitosamente.', user });
    } catch (error: any) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'Ya existe un usuario con ese correo para este negocio.' });
        return;
      }
      res.status(400).json({ error: error.message || 'Error al crear el administrador.' });
    }
  }

  static async createTenant(req: Request, res: Response): Promise<void> {
    try {
      const { name, slug, email, password, admin_name, phone } = req.body;
      if (![name, slug, email, password].every((value) => typeof value === 'string' && value.trim())) {
        res.status(400).json({ error: 'Nombre, slug, correo y contraseña del administrador son requeridos.' });
        return;
      }
      const result = await AuthService.createTenantWithAdmin({ name, slug, email, password, admin_name, phone });
      res.status(201).json({ message: 'Negocio y administrador principal creados.', ...result });
    } catch (error: any) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'Ya existe un negocio con ese nombre/slug o un usuario con ese correo.' });
        return;
      }
      res.status(400).json({ error: error.message || 'Error al crear el negocio.' });
    }
  }

  static async listTenants(_req: Request, res: Response): Promise<void> {
    try {
      const tenants = await AuthService.listTenants();
      res.json({ tenants });
    } catch (error) {
      console.error('[AuthController.listTenants] Error:', error);
      res.status(500).json({ error: 'Error al consultar los negocios.' });
    }
  }

  static async getTenantBySlug(req: Request, res: Response): Promise<void> {
    try {
      const tenant = await AuthService.findActiveTenantBySlug(req.params.slug);
      if (!tenant) {
        res.status(404).json({ error: 'Negocio no encontrado.' });
        return;
      }
      res.json({ tenant: { name: tenant.name, slug: tenant.slug } });
    } catch (error) {
      console.error('[AuthController.getTenantBySlug] Error:', error);
      res.status(500).json({ error: 'Error al consultar el negocio.' });
    }
  }

  static async resolveTenantBySlug(req: Request, res: Response): Promise<void> {
    try {
      const tenant = await AuthService.findActiveTenantBySlug(req.params.slug);
      if (!tenant) {
        res.status(404).json({ error: 'Negocio no encontrado.' });
        return;
      }
      res.json({ tenant_id: tenant.id });
    } catch (error) {
      console.error('[AuthController.resolveTenantBySlug] Error:', error);
      res.status(500).json({ error: 'Error al resolver el negocio.' });
    }
  }

  static async login(req: Request, res: Response): Promise<void> {
    try {
      const tenant_id = req.header('x-tenant-id') || req.body.tenant_id;
      const { email, password } = req.body;
      if (!tenant_id || !email || !password) {
        res.status(400).json({ error: 'tenant_id, email y password son requeridos.' });
        return;
      }
      const result = await AuthService.login({ tenant_id, email, password });
      res.status(200).json({ message: 'Inicio de sesión exitoso.', ...result });
    } catch (error: any) {
      res.status(401).json({ error: error.message || 'Error al iniciar sesión.' });
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
