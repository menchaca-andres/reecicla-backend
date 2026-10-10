import { Request, Response } from 'express';
import { QuotationService } from '../services/quotationService';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { dispatchPendingQuoteEvents } from '../messaging/quoteOutbox';

export class QuotationController {
  static async definePricingRule(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { device_type, brand_id, brand_name, model, min_year, max_year, rule_key, rule_value } = req.body;
      const tenant_id = req.header('x-tenant-id') || req.body.tenant_id;
      if (!req.authUser || (req.authUser.role !== 'SUPER_ADMIN' && tenant_id !== req.authUser.tenantId)) {
        res.status(403).json({ error: 'No puedes modificar reglas de otro tenant.' });
        return;
      }
      const rule = await QuotationService.definePricingRule({
        tenant_id: req.authUser.role === 'SUPER_ADMIN' ? tenant_id : req.authUser.tenantId,
        device_type,
        brand_id,
        brand_name,
        model,
        min_year,
        max_year,
        rule_key,
        rule_value,
      });
      res.status(201).json({
        message: 'Regla de valoración configurada exitosamente.',
        rule,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Error al definir regla de valoración.' });
    }
  }

  static async createQuote(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { tenant_id: requestedTenantId, device_type, brand, model, year, condition } = req.body;
      const tenantId = req.authUser?.tenantId;
      const userId = req.authUser?.userId;

      if (!tenantId || !userId) {
        res.status(401).json({ error: 'Se requiere una sesión autenticada.' });
        return;
      }
      if (requestedTenantId && requestedTenantId !== tenantId) {
        res.status(403).json({ error: 'No puedes solicitar cotizaciones en otro tenant.' });
        return;
      }
      const reservationId = req.header('Idempotency-Key');
      if (reservationId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reservationId)) {
        res.status(400).json({ error: 'Idempotency-Key debe ser un UUID válido.' });
        return;
      }

      const quote = await QuotationService.createQuote({
        tenant_id: tenantId,
        user_id: userId,
        device_type,
        brand,
        model,
        year,
        condition,
      }, reservationId);

      res.status(201).json({
        message: 'Cotización calculada y registrada exitosamente.',
        quote,
      });
    } catch (error: any) {
      const message = error.message || 'Error al solicitar la cotización.';
      const statusCode = message.includes('límite de 20 cotizaciones') ? 429 :
        message.includes('tipo de equipo no está activo') ? 422 :
        message.includes('validar el tipo de equipo') ? 503 : 400;
      res.status(statusCode).json({ error: message });
    }
  }

  static async getQuote(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const quote = await QuotationService.getQuoteById(id);
      if (!quote) {
        res.status(404).json({ error: 'Cotización no encontrada.' });
        return;
      }
      res.status(200).json({ quote });
    } catch (error: any) {
      res.status(500).json({ error: 'Error al consultar la cotización.' });
    }
  }

  static async acceptQuote(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.authUser;
    if (!user) {
      res.status(401).json({ error: 'Se requiere una sesión autenticada.' });
      return;
    }

    try {
      const quote = await QuotationService.acceptQuote(
        req.params.id,
        user.tenantId,
        user.userId,
        user.name || user.email,
        user.email
      );
      dispatchPendingQuoteEvents().catch((error) =>
        console.error('[Quotation] La aceptación quedó en outbox; se reintentará publicar:', error)
      );
      res.status(200).json({ message: 'Cotización aceptada; se está generando la orden.', quote });
    } catch (error: any) {
      const message = error.message || 'No se pudo aceptar la cotización.';
      const statusCode = message === 'Cotización no encontrada.' ? 404 :
        message.includes('venció') ? 422 : 409;
      res.status(statusCode).json({ error: message });
    }
  }

  static async getUserQuotes(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const requestedTenantId = req.query.tenant_id as string | undefined;
      const tenantId = req.authUser?.tenantId;
      const userId = req.authUser?.userId;

      if (!tenantId || !userId) {
        res.status(400).json({ error: 'tenant_id y user_id son requeridos.' });
        return;
      }
      if (requestedTenantId && requestedTenantId !== tenantId) {
        res.status(403).json({ error: 'No puedes consultar cotizaciones de otro tenant.' });
        return;
      }

      const quotes = await QuotationService.getUserQuotes(tenantId, userId);
      res.status(200).json({ quotes });
    } catch (error: any) {
      res.status(500).json({ error: 'Error al consultar las cotizaciones del usuario.' });
    }
  }

  static async getTenantRules(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const requestedTenantId = req.query.tenant_id as string | undefined;
      const scopedTenantId = req.header('x-tenant-id') || requestedTenantId;
      const tenantId = req.authUser?.role === 'SUPER_ADMIN'
        ? scopedTenantId || req.authUser.tenantId
        : req.authUser?.tenantId;
      if (!tenantId) {
        res.status(400).json({ error: 'tenant_id es requerido.' });
        return;
      }
      if (requestedTenantId && req.authUser?.role !== 'SUPER_ADMIN' && requestedTenantId !== tenantId) {
        res.status(403).json({ error: 'No puedes consultar reglas de otro tenant.' });
        return;
      }
      const rules = await QuotationService.getTenantRules(tenantId);
      res.status(200).json({ rules });
    } catch (error: any) {
      res.status(500).json({ error: 'Error al obtener las reglas del tenant.' });
    }
  }
}
