import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { OrderModel } from '../models/orderModel';

export class OrderController {
  static async track(req: Request, res: Response): Promise<void> {
    try {
      const order = await OrderModel.getByTrackingToken(req.params.token);
      if (!order) {
        res.status(404).json({ error: 'El enlace de seguimiento no es válido o venció.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.status(200).json({ order });
    } catch (error) {
      console.error('[Orders] Error consultando seguimiento de invitado:', error);
      res.status(500).json({ error: 'No se pudo consultar el seguimiento del pedido.' });
    }
  }

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

  static async listAll(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.authUser) {
      res.status(401).json({ error: 'Usuario no autenticado.' });
      return;
    }
    try {
      const orders = await OrderModel.listAllForTenant(req.authUser.tenantId);
      res.status(200).json({ orders });
    } catch (error) {
      console.error('[Orders] Error consultando órdenes para el tenant:', error);
      res.status(500).json({ error: 'No se pudieron consultar las órdenes.' });
    }
  }

  static async dispatch(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.authUser) {
      res.status(401).json({ error: 'Usuario no autenticado.' });
      return;
    }
    const { tracking_code, label_url, status } = req.body;
    if (!tracking_code || typeof tracking_code !== 'string' || !tracking_code.trim()) {
      res.status(400).json({ error: 'El número de guía (tracking_code) es obligatorio.' });
      return;
    }
    const newStatus = status === 'IN_TRANSIT' ? 'IN_TRANSIT' : 'BOX_SHIPPED';

    try {
      const result = await OrderModel.dispatchOrder(
        req.authUser.tenantId,
        req.params.id,
        req.authUser.userId,
        tracking_code.trim(),
        label_url,
        newStatus
      );
      res.status(200).json({ message: 'Envío registrado y número de guía asignado.', result });
    } catch (error: any) {
      console.error('[Orders] Error al despachar la orden:', error);
      res.status(400).json({ error: error.message || 'Error al despachar la orden.' });
    }
  }
}