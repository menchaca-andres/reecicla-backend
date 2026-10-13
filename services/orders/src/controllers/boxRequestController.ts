import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { BoxRequestModel } from '../models/boxRequestModel';
import { CreateBoxRequestInput } from '../types/orders';

export class BoxRequestController {
  static async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.authUser) {
      res.status(401).json({ error: 'Usuario no autenticado.' });
      return;
    }

    const { id: orderId } = req.params;
    const { street, city, state, zip_code, country, notes } = req.body;

    if (!street?.trim() || !city?.trim()) {
      res.status(400).json({ error: 'La dirección de recogida requiere al menos calle (street) y ciudad (city).' });
      return;
    }

    const address: CreateBoxRequestInput = {
      street: street.trim(),
      city: city.trim(),
      state: state?.trim(),
      zip_code: zip_code?.trim(),
      country: country?.trim() || 'Bolivia',
      notes: notes?.trim(),
    };

    try {
      const boxRequest = await BoxRequestModel.create(
        req.authUser.tenantId,
        orderId,
        req.authUser.userId,
        address
      );
      res.status(201).json({ box_request: boxRequest, message: 'Solicitud de caja registrada exitosamente.' });
    } catch (err: any) {
      const status = err.message.includes('no encontrada') ? 404
        : err.message.includes('No se puede') ? 422
        : 500;
      console.error('[BoxRequestController.create] Error:', err);
      res.status(status).json({ error: err.message || 'Error al registrar la solicitud de caja.' });
    }
  }

  static async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.authUser) {
      res.status(401).json({ error: 'Usuario no autenticado.' });
      return;
    }

    const { id: orderId } = req.params;

    try {
      const boxRequests = await BoxRequestModel.listForOrder(orderId, req.authUser.tenantId);
      res.status(200).json({ box_requests: boxRequests });
    } catch (err: any) {
      console.error('[BoxRequestController.list] Error:', err);
      res.status(500).json({ error: 'Error al consultar las solicitudes de caja.' });
    }
  }
}
