import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { DomainError } from '../domain/errors';
import { InspectionModel } from '../models/inspectionModel';
import { ReceivedDeviceModel } from '../models/receivedDeviceModel';
import { InspectionService } from '../services/inspectionService';
import { dispatchPendingInspectionEvents } from '../messaging/eventPublisher';
import { paginationMeta, parsePagination } from '../utils/pagination';

function handleError(res: Response, error: unknown, context: string, fallback: string): void {
  if (error instanceof DomainError) {
    res.status(error.status).json({ error: error.message, ...(error.details ? { details: error.details } : {}) });
    return;
  }
  console.error(`[Inspection] ${context}:`, error);
  res.status(500).json({ error: fallback });
}

export class InspectionController {
  static async listPending(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.authUser) {
      res.status(401).json({ error: 'Usuario no autenticado.' });
      return;
    }
    try {
      const pagination = parsePagination(req.query);
      if (pagination === null) {
        res.status(400).json({ error: 'La paginación debe usar página positiva y page_size entre 1 y 100.' });
        return;
      }
      if (!pagination) {
        const pending = await ReceivedDeviceModel.listPending(req.authUser.tenantId);
        res.status(200).json({ pending });
        return;
      }
      const result = await ReceivedDeviceModel.listPending(req.authUser.tenantId, pagination);
      res.status(200).json({
        pending: result.items,
        pagination: paginationMeta(pagination, result.total_items),
      });
    } catch (error) {
      handleError(res, error, 'Error consultando equipos pendientes', 'No se pudieron consultar los equipos pendientes de inspección.');
    }
  }

  static async getChecklist(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.authUser) {
      res.status(401).json({ error: 'Usuario no autenticado.' });
      return;
    }
    try {
      const { device, rule } = await InspectionService.getChecklistForOrder(req.authUser.tenantId, req.params.orderId);
      res.status(200).json({
        order_id: device.order_id,
        device_type_id: device.device_type_id,
        device_type_name: device.device_type_name,
        received_at: device.received_at,
        evaluation_rule_id: rule.id,
        evaluation_rule_version: rule.version,
        checklist: rule.checklist,
      });
    } catch (error) {
      handleError(res, error, 'Error consultando la checklist', 'No se pudo consultar la checklist.');
    }
  }

  static async register(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.authUser) {
      res.status(401).json({ error: 'Usuario no autenticado.' });
      return;
    }
    try {
      const inspection = await InspectionService.register(req.authUser.tenantId, req.authUser.userId, req.body);
      try {
        await dispatchPendingInspectionEvents();
      } catch (error) {
        console.error('[Inspection] Inspección guardada; InspectionRegistered permanece en outbox:', error);
      }
      res.status(201).json({ message: 'Inspección registrada correctamente.', inspection });
    } catch (error) {
      handleError(res, error, 'Error registrando la inspección', 'No se pudo registrar la inspección.');
    }
  }

  static async getByOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.authUser) {
      res.status(401).json({ error: 'Usuario no autenticado.' });
      return;
    }
    try {
      const inspection = await InspectionService.getByOrder(req.authUser.tenantId, req.params.orderId);
      res.status(200).json({ inspection });
    } catch (error) {
      handleError(res, error, 'Error consultando la inspección', 'No se pudo consultar la inspección.');
    }
  }

  static async complete(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.authUser) {
      res.status(401).json({ error: 'Usuario no autenticado.' });
      return;
    }
    try {
      const inspection = await InspectionService.complete(
        req.authUser.tenantId,
        req.authUser.userId,
        req.params.orderId,
        req.body
      );
      try {
        await dispatchPendingInspectionEvents();
      } catch (error) {
        console.error('[Inspection] Resultado guardado; InspectionCompleted permanece en outbox:', error);
      }
      res.status(200).json({ message: 'Resultado de inspección guardado correctamente.', inspection });
    } catch (error) {
      handleError(res, error, 'Error completando la inspección', 'No se pudo completar la inspección.');
    }
  }

  static async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.authUser) {
      res.status(401).json({ error: 'Usuario no autenticado.' });
      return;
    }
    try {
      const pagination = parsePagination(req.query);
      if (pagination === null) {
        res.status(400).json({ error: 'La paginación debe usar página positiva y page_size entre 1 y 100.' });
        return;
      }
      if (!pagination) {
        const inspections = await InspectionModel.listForTenant(req.authUser.tenantId);
        res.status(200).json({ inspections });
        return;
      }
      const result = await InspectionModel.listForTenant(req.authUser.tenantId, pagination);
      res.status(200).json({
        inspections: result.items,
        pagination: paginationMeta(pagination, result.total_items),
      });
    } catch (error) {
      handleError(res, error, 'Error consultando inspecciones', 'No se pudieron consultar las inspecciones.');
    }
  }
}
