import { Request, Response } from 'express';
import { QuotationService } from '../services/quotationService';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

export class QuotationController {
  static async definePricingRule(req: Request, res: Response): Promise<void> {
    try {
      const { tenant_id, device_type, rule_key, rule_value } = req.body;
      const rule = await QuotationService.definePricingRule({
        tenant_id,
        device_type,
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
      const { tenant_id, device_type, brand, model, year, condition } = req.body;
      const userId = req.user?.userId || req.body.user_id;

      if (!userId) {
        res.status(401).json({ error: 'user_id es requerido o debe estar autenticado.' });
        return;
      }

      const quote = await QuotationService.createQuote({
        tenant_id,
        user_id: userId,
        device_type,
        brand,
        model,
        year,
        condition,
      });

      res.status(201).json({
        message: 'Cotización calculada y registrada exitosamente.',
        quote,
      });
    } catch (error: any) {
      const message = error.message || 'Error al solicitar la cotización.';
      const statusCode = message.includes('tipo de equipo no está activo') ? 422 :
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

  static async getUserQuotes(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = (req.query.tenant_id as string) || req.user?.tenantId;
      const userId = req.user?.userId;

      if (!tenantId || !userId) {
        res.status(400).json({ error: 'tenant_id y user_id son requeridos.' });
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
      const tenantId = (req.query.tenant_id as string) || req.user?.tenantId;
      if (!tenantId) {
        res.status(400).json({ error: 'tenant_id es requerido.' });
        return;
      }
      const rules = await QuotationService.getTenantRules(tenantId);
      res.status(200).json({ rules });
    } catch (error: any) {
      res.status(500).json({ error: 'Error al obtener las reglas del tenant.' });
    }
  }
}
