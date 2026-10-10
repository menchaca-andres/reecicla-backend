import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { DeviceTypeModel } from '../models/deviceTypeModel';

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
      const requestedTenantId = req.header('x-tenant-id') || req.query.tenant_id as string | undefined;
      const user = req.user;
      const includeInactive = req.query.include_inactive === 'true';

      if (user && user.role !== 'SUPER_ADMIN' && requestedTenantId && requestedTenantId !== user.tenantId) {
        res.status(403).json({ error: 'No puedes consultar el catálogo de otro tenant.' });
        return;
      }

      if (includeInactive && (!user || !['CATALOG_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN'].includes(user.role))) {
        res.status(403).json({ error: 'Solo un administrador puede consultar tipos inactivos.' });
        return;
      }

      const tenantId = requestedTenantId || user?.tenantId;
      if (!tenantId) {
        res.status(400).json({ error: 'tenant_id es requerido.' });
        return;
      }

      const deviceTypes = await DeviceTypeModel.getDeviceTypes(tenantId, includeInactive);
      res.json({ deviceTypes });
    } catch (error: any) {
      console.error('[CatalogController.listDeviceTypes] Error:', error);
      res.status(500).json({ error: 'Error interno al consultar tipos de dispositivo.' });
    }
  }

  static async createDeviceType(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.header('x-tenant-id') || req.user?.tenantId;
      const { code, name, description, accepts_quotes } = req.body;

      if (!tenantId || !code || !name) {
        res.status(400).json({ error: 'tenant_id, code y name son requeridos.' });
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
      const tenantId = req.header('x-tenant-id') || req.user?.tenantId;
      const { name, description, accepts_quotes, status } = req.body;

      if (!tenantId) {
        res.status(400).json({ error: 'tenant_id es requerido.' });
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
      const tenantId = req.header('x-tenant-id') || req.user?.tenantId;

      if (!tenantId) {
        res.status(400).json({ error: 'tenant_id es requerido.' });
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
}
