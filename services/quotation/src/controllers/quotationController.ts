import { Response } from 'express';
import { QuotationService } from '../services/quotationService';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { dispatchPendingQuoteEvents } from '../messaging/quoteOutbox';
import { assertTenantAccess, gatewayTenantId } from '../utils/tenant';

export class QuotationController {
  static async definePricingRule(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = gatewayTenantId(req) ?? (req.authUser?.role === 'SUPER_ADMIN' ? req.body?.tenant_id : req.authUser?.tenantId);
      if (!tenantId) {
        res.status(400).json({ error: 'No se pudo determinar el contexto del negocio.' });
        return;
      }
      const mismatch = assertTenantAccess(req, tenantId);
      if (mismatch) {
        res.status(403).json({ error: mismatch });
        return;
      }

      const { device_type, brand_id, brand_name, model, min_year, max_year, rule_key, rule_value } = req.body;
      const rule = await QuotationService.definePricingRule({
        tenant_id: tenantId,
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
      const tenantId = gatewayTenantId(req);
      const userId = req.authUser?.userId ?? null;

      if (!tenantId) {
        res.status(400).json({ error: 'No se pudo determinar el contexto del negocio.' });
        return;
      }
      const mismatch = assertTenantAccess(req, tenantId);
      if (mismatch) {
        res.status(403).json({ error: mismatch });
        return;
      }

      const { device_type, brand, model, year, condition } = req.body;
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

  static async getQuote(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = gatewayTenantId(req);
      if (!tenantId) {
        res.status(400).json({ error: 'No se pudo determinar el contexto del negocio.' });
        return;
      }

      let quote = await QuotationService.getQuoteById(id);
      if (!quote || quote.tenant_id !== tenantId) {
        res.status(404).json({ error: 'Cotización no encontrada.' });
        return;
      }
      if (
        (quote.status === 'ANONYMOUS' || quote.status === 'PENDING') &&
        new Date(quote.valid_until).getTime() <= Date.now()
      ) {
        await QuotationService.expireOverdueQuotes();
        quote = await QuotationService.getQuoteById(id);
      }
      if (quote?.status === 'EXPIRED') {
        res.status(410).json({ error: 'La cotización venció.', quote });
        return;
      }
      res.status(200).json({ quote });
    } catch (error: any) {
      res.status(500).json({ error: 'Error al consultar la cotización.' });
    }
  }

  static async acceptQuote(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = gatewayTenantId(req);
      const userId = req.authUser?.userId ?? null;
      const customerName = String(req.body?.customer_name || req.authUser?.name || '').trim();
      const customerEmail = String(req.body?.customer_email || req.authUser?.email || '').trim();
      const phone = String(req.body?.phone || '').trim();
      const address = String(req.body?.address || '').trim();
      const verificationCode = String(req.body?.verification_code || '').trim();

      if (!tenantId) {
        res.status(400).json({ error: 'No se pudo determinar el contexto del negocio.' });
        return;
      }
      const mismatch = assertTenantAccess(req, tenantId);
      if (mismatch) {
        res.status(403).json({ error: mismatch });
        return;
      }

      const result = await QuotationService.acceptQuote({
        quoteId: req.params.id,
        tenantId,
        userId,
        customerName,
        customerEmail,
        phone,
        address,
        authenticated: Boolean(userId),
        verificationCode: verificationCode || undefined,
      });
      if (result.verificationRequired) {
        res.status(202).json({
          verification_required: true,
          message: 'Enviamos un código de verificación a tu correo. Ingrésalo para aceptar la cotización.',
        });
        return;
      }
      dispatchPendingQuoteEvents().catch((error) =>
        console.error('[Quotation] La aceptación quedó en outbox; se reintentará publicar:', error)
      );
      res.status(200).json({
        message: 'Cotización aceptada; se está generando la orden.',
        quote: result.quote,
      });
    } catch (error: any) {
      const message = error.message || 'No se pudo aceptar la cotización.';
      const statusCode = error.status || (message === 'Cotización no encontrada.' ? 404 :
        message.includes('venció') ? 422 :
          message.includes('requerid') || message.includes('no es válido') ? 400 : 409);
      res.status(statusCode).json({ error: message });
    }
  }

  static async rejectQuote(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = gatewayTenantId(req);
      if (!tenantId) {
        res.status(400).json({ error: 'No se pudo determinar el contexto del negocio.' });
        return;
      }
      const mismatch = assertTenantAccess(req, tenantId);
      if (mismatch) {
        res.status(403).json({ error: mismatch });
        return;
      }
      const quote = await QuotationService.rejectQuote(req.params.id, tenantId);
      res.status(200).json({ message: 'Cotización rechazada.', quote });
    } catch (error: any) {
      const message = error.message || 'No se pudo rechazar la cotización.';
      const statusCode = message.includes('no está pendiente') ? 409 : 400;
      res.status(statusCode).json({ error: message });
    }
  }

  static async getUserQuotes(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = gatewayTenantId(req) ?? req.authUser?.tenantId;
      const userId = req.authUser?.userId;

      if (!tenantId || !userId) {
        res.status(400).json({ error: 'No se pudo determinar el usuario o el negocio.' });
        return;
      }
      const mismatch = assertTenantAccess(req, tenantId);
      if (mismatch) {
        res.status(403).json({ error: mismatch });
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
      const tenantId = gatewayTenantId(req)
        ?? (req.authUser?.role === 'SUPER_ADMIN' ? (req.query.tenant_id as string | undefined) : undefined)
        ?? req.authUser?.tenantId;
      if (!tenantId) {
        res.status(400).json({ error: 'No se pudo determinar el contexto del negocio.' });
        return;
      }
      const mismatch = assertTenantAccess(req, tenantId);
      if (mismatch) {
        res.status(403).json({ error: mismatch });
        return;
      }
      const rules = await QuotationService.getTenantRules(tenantId);
      res.status(200).json({ rules });
    } catch (error: any) {
      res.status(500).json({ error: 'Error al obtener las reglas del tenant.' });
    }
  }
}
