import { Request, Response } from 'express';
import { EvaluationRuleModel } from '../models/evaluationRuleModel';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { resolveTenantId } from '../utils/tenant';

export class EvaluationRuleController {
  static async getActiveRule(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req as AuthenticatedRequest);
      const deviceTypeId = req.query.device_type_id as string;

      if (!tenantId) {
        res.status(400).json({ error: 'No se pudo determinar el contexto del negocio.' });
        return;
      }
      if (!deviceTypeId) {
        res.status(400).json({ error: 'device_type_id es requerido.' });
        return;
      }

      const rule = await EvaluationRuleModel.getActiveRule(tenantId, deviceTypeId);
      res.json({ rule });
    } catch (err: any) {
      console.error('[EvaluationRuleController.getActiveRule] Error:', err);
      res.status(500).json({ error: 'Error al consultar la regla de evaluación activa.' });
    }
  }

  static async getRuleHistory(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req as AuthenticatedRequest);
      const deviceTypeId = req.query.device_type_id as string;

      if (!tenantId) {
        res.status(400).json({ error: 'No se pudo determinar el contexto del negocio.' });
        return;
      }
      if (!deviceTypeId) {
        res.status(400).json({ error: 'device_type_id es requerido.' });
        return;
      }

      const rules = await EvaluationRuleModel.getRuleHistory(tenantId, deviceTypeId);
      res.json({ rules });
    } catch (err: any) {
      console.error('[EvaluationRuleController.getRuleHistory] Error:', err);
      res.status(500).json({ error: 'Error al consultar el historial de reglas.' });
    }
  }

  static async getRuleById(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req as AuthenticatedRequest);
      const { id } = req.params;
      if (!tenantId) {
        res.status(400).json({ error: 'No se pudo determinar el contexto del negocio.' });
        return;
      }

      const rule = await EvaluationRuleModel.getRuleById(tenantId, id);
      if (!rule) {
        res.status(404).json({ error: 'Regla de evaluación no encontrada.' });
        return;
      }

      res.json({ rule });
    } catch (err: any) {
      console.error('[EvaluationRuleController.getRuleById] Error:', err);
      res.status(500).json({ error: 'Error al consultar la regla de evaluación.' });
    }
  }

  static async createRuleVersion(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req as AuthenticatedRequest);
      const { device_type_id, checklist, resale_criteria, recycle_criteria } = req.body;
      if (!tenantId) {
        res.status(400).json({ error: 'No se pudo determinar el contexto del negocio.' });
        return;
      }

      if (!device_type_id || !checklist || !Array.isArray(checklist)) {
        res.status(400).json({ error: 'device_type_id y un checklist (array) válidos son requeridos.' });
        return;
      }

      const rule = await EvaluationRuleModel.createRuleVersion(
        tenantId,
        device_type_id,
        checklist,
        resale_criteria || {},
        recycle_criteria || {}
      );

      res.status(201).json({ rule, message: 'Nueva versión de regla de evaluación creada exitosamente.' });
    } catch (err: any) {
      console.error('[EvaluationRuleController.createRuleVersion] Error:', err);
      res.status(500).json({ error: 'Error al crear la versión de regla de evaluación.' });
    }
  }
}
