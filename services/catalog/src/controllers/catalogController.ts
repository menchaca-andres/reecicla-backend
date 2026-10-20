import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { DeviceTypeModel } from '../models/deviceTypeModel';
import { resolveTenantId } from '../utils/tenant';
import { paginationMeta, parsePagination } from '../utils/pagination';

export class CatalogController {
  static async bootstrapTenant(req: AuthenticatedRequest, res: Response): Promise<void> {
    const tenantId = req.body.tenant_id;
    if (!tenantId) {
      res.status(400).json({ error: 'tenant_id es requerido.' });
      return;
    }
    try {
      await DeviceTypeModel.bootstrapDefaults(tenantId);
      res.json({ message: 'Catálogo inicializado.' });
    } catch (error) {
      console.error('[CatalogController.bootstrapTenant] Error:', error);
      res.status(500).json({ error: 'No se pudo inicializar el catálogo del negocio.' });
    }
  }
  static async listDeviceTypes(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const user = req.user;
      const includeInactive = req.query.include_inactive === 'true';
      const tenantId = resolveTenantId(req);

      if (user && user.role !== 'SUPER_ADMIN' && tenantId && tenantId !== user.tenantId) {
        res.status(403).json({ error: 'No puedes consultar el catálogo de otro tenant.' });
        return;
      }

      if (includeInactive && (!user || !['CATALOG_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN'].includes(user.role))) {
        res.status(403).json({ error: 'Solo un administrador puede consultar tipos inactivos.' });
        return;
      }

      if (!tenantId) {
        res.status(400).json({ error: 'No se pudo determinar el contexto del negocio.' });
        return;
      }

      const pagination = parsePagination(req.query);
      if (pagination === null) {
        res.status(400).json({ error: 'La paginación debe usar página positiva y page_size entre 1 y 100.' });
        return;
      }
      if (!pagination) {
        const deviceTypes = await DeviceTypeModel.getDeviceTypes(tenantId, includeInactive);
        res.json({ deviceTypes });
        return;
      }
      const result = await DeviceTypeModel.getDeviceTypes(tenantId, includeInactive, pagination);
      res.json({
        deviceTypes: result.items,
        pagination: paginationMeta(pagination, result.total_items),
      });
    } catch (error: any) {
      console.error('[CatalogController.listDeviceTypes] Error:', error);
      res.status(500).json({ error: 'Error interno al consultar tipos de dispositivo.' });
    }
  }

  static async createDeviceType(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { code, name, description, accepts_quotes } = req.body;

      if (!tenantId || !code || !name) {
        res.status(400).json({ error: 'code, name y el contexto del negocio son requeridos.' });
        return;
      }

      const deviceType = await DeviceTypeModel.createDeviceType({
        tenant_id: tenantId,
        code,
        name,
        description,
        accepts_quotes,
      });

      res.status(201).json({
        message: 'Tipo de dispositivo creado exitosamente.',
        deviceType,
      });
    } catch (error: any) {
      console.error('[CatalogController.createDeviceType] Error:', error);
      if (error.code === '23505') {
        res.status(409).json({ error: 'Ya existe un tipo de dispositivo con ese código en este tenant.' });
        return;
      }
      res.status(500).json({ error: 'Error interno al crear el tipo de dispositivo.' });
    }
  }

  static async updateDeviceType(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = resolveTenantId(req);
      const { name, description, accepts_quotes, status } = req.body;

      if (!tenantId) {
        res.status(400).json({ error: 'No se pudo determinar el contexto del negocio.' });
        return;
      }

      const updated = await DeviceTypeModel.updateDeviceType(id, tenantId, {
        name,
        description,
        accepts_quotes,
        status,
      });

      if (!updated) {
        res.status(404).json({ error: 'Tipo de dispositivo no encontrado.' });
        return;
      }

      res.json({
        message: 'Tipo de dispositivo actualizado exitosamente.',
        deviceType: updated,
      });
    } catch (error: any) {
      console.error('[CatalogController.updateDeviceType] Error:', error);
      res.status(500).json({ error: 'Error interno al actualizar el tipo de dispositivo.' });
    }
  }

  static async inactivateDeviceType(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = resolveTenantId(req);

      if (!tenantId) {
        res.status(400).json({ error: 'No se pudo determinar el contexto del negocio.' });
        return;
      }

      const inactivated = await DeviceTypeModel.inactivateDeviceType(id, tenantId);
      if (!inactivated) {
        res.status(404).json({ error: 'Tipo de dispositivo no encontrado.' });
        return;
      }

      res.json({
        message: 'Tipo de dispositivo inactivado exitosamente.',
        deviceType: inactivated,
      });
    } catch (error: any) {
      console.error('[CatalogController.inactivateDeviceType] Error:', error);
      res.status(500).json({ error: 'Error interno al inactivar el tipo de dispositivo.' });
    }
  }

  static async evaluateInactivity(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        res.status(400).json({ error: 'No se pudo determinar el contexto del negocio.' });
        return;
      }
      const cutoffMonths = req.query.cutoff_months ? Number(req.query.cutoff_months) : 12;
      const summary = await DeviceTypeModel.evaluateInactivity(tenantId, cutoffMonths);
      res.status(200).json(summary);
    } catch (error: any) {
      console.error('[CatalogController.evaluateInactivity] Error:', error);
      res.status(500).json({ error: error.message || 'Error evaluando inactividad de tipos.' });
    }
  }

  static async executeInactivityMaintenance(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        res.status(400).json({ error: 'No se pudo determinar el contexto del negocio.' });
        return;
      }
      const cutoffMonths = req.body?.cutoff_months ? Number(req.body.cutoff_months) : 12;
      const user = req.user;
      const executedBy = user ? `${user.name || user.email || 'Admin'} (${user.role})` : 'ADMIN_MANUAL';

      const result = await DeviceTypeModel.executeInactivityDeactivation(tenantId, executedBy, cutoffMonths);
      res.status(200).json(result);
    } catch (error: any) {
      console.error('[CatalogController.executeInactivityMaintenance] Error:', error);
      res.status(500).json({ error: error.message || 'Error ejecutando mantenimiento de inactividad.' });
    }
  }

  static async listAuditLogs(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        res.status(400).json({ error: 'No se pudo determinar el contexto del negocio.' });
        return;
      }
      const pagination = parsePagination(req.query);
      if (pagination === null) {
        res.status(400).json({ error: 'La paginación debe usar página positiva y page_size entre 1 y 100.' });
        return;
      }
      if (!pagination) {
        const limit = req.query.limit ? Number(req.query.limit) : 50;
        const auditLogs = await DeviceTypeModel.getAuditLogs(tenantId, limit);
        res.status(200).json({ audit_logs: auditLogs });
        return;
      }
      const result = await DeviceTypeModel.getAuditLogs(tenantId, pagination.limit, pagination);
      res.status(200).json({
        audit_logs: result.items,
        pagination: paginationMeta(pagination, result.total_items),
      });
    } catch (error: any) {
      console.error('[CatalogController.listAuditLogs] Error:', error);
      res.status(500).json({ error: error.message || 'Error consultando auditoría de catálogo.' });
    }
  }
}
