import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { OrderModel } from '../models/orderModel';

export class OrderController {
  static async listMine(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.authUser) {
      res.status(401).json({ error: 'Usuario no autenticado.' });
      return;
    }
    try {
      const orders = await OrderModel.listForUser(req.authUser.tenantId, req.authUser.userId);
      res.status(200).json({ orders });
    } catch (error) {
      console.error('[Orders] Error consultando órdenes:', error);
      res.status(500).json({ error: 'No se pudieron consultar las órdenes.' });
    }
  }

  static async getMine(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.authUser) {
      res.status(401).json({ error: 'Usuario no autenticado.' });
      return;
    }
    try {
      const order = await OrderModel.findForUser(req.params.id, req.authUser.tenantId, req.authUser.userId);
      if (!order) {
        res.status(404).json({ error: 'Orden no encontrada.' });
        return;
      }
      res.status(200).json({ order });
    } catch (error) {
      console.error('[Orders] Error consultando orden:', error);
      res.status(500).json({ error: 'No se pudo consultar la orden.' });
    }
  }
}