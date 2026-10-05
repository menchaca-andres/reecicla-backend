import { Request, Response } from 'express';
import { EvaluationRuleModel } from '../models/evaluationRuleModel';

export class EvaluationRuleController {
  static async getActiveRule(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = (req.headers['x-tenant-id'] as string) || (req as any).user?.tenantId || '00000000-0000-0000-0000-000000000001';
      const deviceTypeId = req.query.device_type_id as string;

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
      const tenantId = (req.headers['x-tenant-id'] as string) || (req as any).user?.tenantId || '00000000-0000-0000-0000-000000000001';
      const deviceTypeId = req.query.device_type_id as string;

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
      const tenantId = (req.headers['x-tenant-id'] as string) || (req as any).user?.tenantId || '00000000-0000-0000-0000-000000000001';
      const { id } = req.params;

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
      const tenantId = (req as any).user?.tenantId || (req.headers['x-tenant-id'] as string) || '00000000-0000-0000-0000-000000000001';
      const { device_type_id, checklist, resale_criteria, recycle_criteria } = req.body;

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
