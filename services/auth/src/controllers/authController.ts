import { Request, Response } from 'express';
import { pool } from '../config/db';
import { AuthService } from '../services/authService';
import { EmailService } from '../services/emailService';
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
      const tenant_id = req.header('x-tenant-id')?.trim();
      const { email, password, name, phone } = req.body;
      if (!tenant_id || !email || !password) {
        res.status(400).json({ error: 'email, password y el contexto del negocio son requeridos.' });
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
      const tenant_id = req.header('x-tenant-id')?.trim();
      const { email, password } = req.body;
      if (!tenant_id || !email || !password) {
        res.status(400).json({ error: 'email, password y el contexto del negocio son requeridos.' });
        return;
      }
      const result = await AuthService.login({ tenant_id, email, password });
      res.status(200).json({ message: 'Inicio de sesión exitoso.', ...result });
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
      const statusCode = message.includes('Espera un minuto') ? 429 :
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

  static async sendOrderTrackingLink(req: Request, res: Response): Promise<void> {
    try {
      const { email, customer_name, order_number, tracking_url } = req.body ?? {};
      if (
        typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof customer_name !== 'string' || !customer_name.trim() ||
        typeof order_number !== 'string' || !order_number.trim() ||
        typeof tracking_url !== 'string'
      ) {
        res.status(400).json({ error: 'email, customer_name, order_number y tracking_url son requeridos.' });
        return;
      }
      let url: URL;
      try {
        url = new URL(tracking_url);
      } catch {
        res.status(400).json({ error: 'La URL de seguimiento no es válida.' });
        return;
      }
      const allowedOrigins = (process.env.TRACKING_LINK_ALLOWED_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
      if (!allowedOrigins.includes(url.origin) || !/^\/seguimiento\/[0-9a-f]{64}$/i.test(url.pathname)) {
        res.status(400).json({ error: 'La URL de seguimiento no es válida.' });
        return;
      }
      await EmailService.sendOrderTrackingLink(
        email.trim(),
        customer_name.trim(),
        order_number.trim(),
        url.toString()
      );
      res.status(202).json({ message: 'Enlace de seguimiento enviado.' });
    } catch (error: any) {
      console.error('[Auth] No se pudo enviar el enlace de seguimiento:', error);
      res.status(503).json({ error: error.message || 'No se pudo enviar el enlace de seguimiento.' });
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

  static async notifyCatalogMaintenance(req: Request, res: Response): Promise<void> {
    try {
      const { tenant_id, summary } = req.body;
      if (!tenant_id || !summary) {
        res.status(400).json({ error: 'tenant_id y summary son requeridos.' });
        return;
      }
      const client = await pool.query(
        `SELECT email, name FROM users WHERE tenant_id = $1 AND role IN ('TENANT_ADMIN', 'CATALOG_ADMIN')`,
        [tenant_id]
      );
      if (client.rows.length === 0) {
        res.status(200).json({ message: 'No hay administradores registrados para este tenant.' });
        return;
      }
      for (const admin of client.rows) {
        try {
          await EmailService.sendCatalogMaintenanceSummary(admin.email, admin.name || 'Administrador', summary);
        } catch (emailErr) {
          console.error(`[Auth] Error enviando email de mantenimiento a ${admin.email}:`, emailErr);
        }
      }
      res.status(200).json({ message: 'Notificaciones de mantenimiento enviadas a los administradores.' });
    } catch (error: any) {
      console.error('[Auth] Error procesando notificación de mantenimiento:', error);
      res.status(500).json({ error: error.message || 'Error procesando notificación de mantenimiento.' });
    }
  }
}

