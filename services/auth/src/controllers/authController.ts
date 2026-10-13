import { Request, Response } from 'express';
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
      const { email, password, name, phone } = req.body ?? {};
      if (
        !tenant_id ||
        typeof email !== 'string' ||
        typeof password !== 'string'
      ) {
        res.status(400).json({ error: 'email, password y el contexto del negocio son requeridos.' });
        return;
      }
      await AuthService.register({ tenant_id, email, password, name, phone });
      res.status(202).json({
        verification_required: true,
        message: 'Si puedes crear una cuenta con ese correo, recibirás un código de verificación.',
      });
    } catch (error: any) {
      const message = error.message || 'Error al iniciar el registro.';
      if (message.includes('Espera un minuto')) {
        res.status(429).json({ error: message });
        return;
      }
      if (
        message.includes('SMTP_') ||
        message.includes('verificar correos') ||
        error.code === '42P01' ||
        String(error.code || '').startsWith('08')
      ) {
        console.error('[AuthController.register] No se pudo iniciar el registro:', error);
        res.status(503).json({ error: 'No se pudo iniciar el registro en este momento.' });
        return;
      }
      res.status(400).json({ error: message });
    }
  }

  static async verifyRegistration(req: Request, res: Response): Promise<void> {
    try {
      const tenant_id = req.header('x-tenant-id')?.trim();
      const { email, code } = req.body ?? {};
      if (!tenant_id || typeof email !== 'string' || typeof code !== 'string') {
        res.status(400).json({ error: 'Correo, código y contexto del negocio son requeridos.' });
        return;
      }
      const result = await AuthService.verifyClientRegistration(tenant_id, email, code);
      res.status(201).json({ message: 'Cuenta verificada y creada exitosamente.', ...result });
    } catch (error: any) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'Ya existe una cuenta con ese correo en este negocio.' });
        return;
      }
      const message = error.message || 'No se pudo verificar el correo.';
      if (message.includes('inválido o venció')) {
        res.status(422).json({ error: message });
        return;
      }
      if (error.code === '42P01' || String(error.code || '').startsWith('08')) {
        console.error('[AuthController.verifyRegistration] No se pudo verificar el registro:', error);
        res.status(503).json({ error: 'No se pudo verificar el registro en este momento.' });
        return;
      }
      res.status(400).json({ error: message });
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
      if (!req.authUser.tenantId) {
        res.status(403).json({ error: 'La sesión no pertenece a un negocio.' });
        return;
      }
      const user = await AuthService.getUserProfile(req.authUser.userId, req.authUser.tenantId);
      res.status(200).json({ user });
    } catch (error: any) {
      res.status(404).json({ error: error.message || 'Error al obtener el perfil.' });
    }
  }

  static async updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const authUser = req.authUser;
      if (!authUser?.tenantId) {
        res.status(403).json({ error: 'La sesión no pertenece a un negocio.' });
        return;
      }
      const { name, phone, pickup_address } = req.body ?? {};
      if (
        typeof name !== 'string' ||
        typeof phone !== 'string' ||
        typeof pickup_address !== 'string'
      ) {
        res.status(400).json({ error: 'Nombre, teléfono y dirección son requeridos.' });
        return;
      }
      const user = await AuthService.updateUserProfile(authUser.userId, authUser.tenantId, {
        name,
        phone,
        pickup_address,
      });
      res.status(200).json({ message: 'Datos de contacto actualizados.', user });
    } catch (error: any) {
      if (error.code === '42703' || error.code === '42P01') {
        console.error('[AuthController.updateProfile] La base Auth requiere una migración:', error);
        res.status(503).json({ error: 'La base de datos necesita actualizarse antes de guardar los datos de contacto.' });
        return;
      }
      const message = error.message || 'No se pudo actualizar el perfil.';
      const statusCode = message.includes('no encontrado') ? 404 : 400;
      res.status(statusCode).json({ error: message });
    }
  }
}
