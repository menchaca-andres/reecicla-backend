import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { OrderModel } from '../models/orderModel';
import { dispatchPendingOrderEvents } from '../messaging/eventPublisher';

export class OrderController {
  static async authorizeAdjustedQuoteResponse(req: Request, res: Response): Promise<void> {
    const trackingToken = req.body?.tracking_token;
    const parentQuoteId = req.body?.parent_quote_id;
    if (typeof trackingToken !== 'string' || typeof parentQuoteId !== 'string') {
      res.status(400).json({ error: 'Se requieren un token de seguimiento y una cotización original.' });
      return;
    }
    try {
      const order = await OrderModel.authorizeAdjustedQuoteResponse(trackingToken, parentQuoteId);
      if (!order) {
        res.status(403).json({ error: 'El enlace no autoriza responder esta cotización ajustada.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ order });
    } catch (error) {
      console.error('[Orders] No se pudo validar el enlace para responder el ajuste:', error);
      res.status(500).json({ error: 'No se pudo validar el enlace de seguimiento.' });
    }
  }

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

  static async resolveAdjustmentAsGuest(req: Request, res: Response): Promise<void> {
    const resolution = req.body?.resolution;
    if (resolution !== 'RETURN' && resolution !== 'RECYCLE') {
      res.status(400).json({ error: 'El destino debe ser RETURN o RECYCLE.' });
      return;
    }
    try {
      const result = await OrderModel.resolveAdjustmentByTrackingToken(req.params.token, resolution);
      res.status(200).json({
        message: result.automatic
          ? 'Venció el plazo de 7 días; se registró el reciclaje sin pago.'
          : 'Se registró el destino seleccionado.',
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo elegir el destino.';
      const status = message.includes('no encontrada') || message.includes('venció') ? 404 : 409;
      res.status(status).json({ error: message });
    }
  }

  static async resolveAdjustmentAsUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.authUser) {
      res.status(401).json({ error: 'Usuario no autenticado.' });
      return;
    }
    const resolution = req.body?.resolution;
    if (resolution !== 'RETURN' && resolution !== 'RECYCLE') {
      res.status(400).json({ error: 'El destino debe ser RETURN o RECYCLE.' });
      return;
    }
    try {
      const result = await OrderModel.resolveAdjustmentForUser(
        req.params.id,
        req.authUser.tenantId,
        req.authUser.userId,
        resolution
      );
      res.status(200).json({
        message: result.automatic
          ? 'Venció el plazo de 7 días; se registró el reciclaje sin pago.'
          : 'Se registró el destino seleccionado.',
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo elegir el destino.';
      const status = message.includes('no encontrada') ? 404 : 409;
      res.status(status).json({ error: message });
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

  static async receive(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.authUser) {
      res.status(401).json({ error: 'Usuario no autenticado.' });
      return;
    }

    try {
      const order = await OrderModel.receiveOrder(
        req.authUser.tenantId,
        req.params.id,
        req.authUser.userId
      );
      try {
        await dispatchPendingOrderEvents();
      } catch (error) {
        console.error('[Orders] Recepción guardada; DeviceReceived permanece en outbox:', error);
      }
      res.status(200).json({
        message: 'Recepción registrada. El catálogo actualizará la última fecha de recepción.',
        order,
      });
    } catch (error: any) {
      const message = error.message || 'No se pudo registrar la recepción.';
      const status = message === 'Orden no encontrada.' ? 404 :
        message.startsWith('No se puede registrar la recepción') ? 409 : 500;
      console.error('[Orders] Error al registrar recepción:', error);
      res.status(status).json({ error: message });
    }
  }
}
