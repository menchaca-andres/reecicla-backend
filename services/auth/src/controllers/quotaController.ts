import { Request, Response } from 'express';
import { QuotaModel, TenantPlanCode } from '../models/quotaModel';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

export class QuotaController {
  static async setTenantPlan(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { plan_code } = req.body;
    if (!['FREE', 'PREMIUM'].includes(plan_code)) {
      res.status(400).json({ error: 'plan_code debe ser FREE o PREMIUM.' });
      return;
    }

    try {
      const plan = await QuotaModel.setTenantPlan(req.params.tenantId, plan_code as TenantPlanCode);
      res.status(200).json({ plan });
    } catch (error: any) {
      const status = error.message === 'Tenant no encontrado.' ? 404 : 500;
      res.status(status).json({ error: error.message || 'No se pudo actualizar el plan.' });
    }
  }

  static async reserveQuote(req: Request, res: Response): Promise<void> {
    const { tenant_id, reservation_id } = req.body;
    if (!tenant_id || !reservation_id) {
      res.status(400).json({ error: 'tenant_id y reservation_id son requeridos.' });
      return;
    }

    try {
      const reservation = await QuotaModel.reserveQuote(tenant_id, reservation_id);
      res.status(201).json({ reservation });
    } catch (error: any) {
      const status = error.message?.startsWith('Alcanzaste el límite') ? 429 :
        error.message === 'Tenant no encontrado.' ? 404 : 400;
      res.status(status).json({ error: error.message || 'No se pudo reservar una cotización.' });
    }
  }

  static async finishReservation(req: Request, res: Response): Promise<void> {
    const action = req.method === 'DELETE' ? 'RELEASE' : 'COMMIT';
    try {
      await QuotaModel.finishReservation(req.params.reservationId, action);
      res.status(204).send();
    } catch (error: any) {
      const status = error.message === 'Reserva de cuota no encontrada.' ? 404 : 400;
      res.status(status).json({ error: error.message || 'No se pudo finalizar la reserva.' });
    }
  }
}