import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { DeviceModel } from '../models/deviceModel';
import { resolveTenantId } from '../utils/tenant';

export class DeviceController {
  static async listDevices(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const deviceTypeId = req.query.device_type_id as string | undefined;
      const brandId = req.query.brand_id as string | undefined;
      const includeInactive = req.query.include_inactive === 'true';

      if (!tenantId) {
        res.status(400).json({ error: 'tenant_id es requerido.' });
        return;
      }

      const devices = await DeviceModel.getDevices(tenantId, deviceTypeId, brandId, includeInactive);
      res.json({ devices });
    } catch (error: any) {
      console.error('[DeviceController.listDevices] Error:', error);
      res.status(500).json({ error: 'Error interno al consultar dispositivos.' });
    }
  }

  static async getDevice(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        res.status(400).json({ error: 'tenant_id es requerido.' });
        return;
      }
      const device = await DeviceModel.getById(id, tenantId);
      if (!device) {
        res.status(404).json({ error: 'Dispositivo no encontrado.' });
        return;
      }
      res.json({ device });
    } catch (error: any) {
      console.error('[DeviceController.getDevice] Error:', error);
      res.status(500).json({ error: 'Error interno al obtener dispositivo.' });
    }
  }

  static async createDevice(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { device_type_id, brand_id, model, year, description } = req.body;

      if (!tenantId || !device_type_id || !brand_id || !model) {
        res.status(400).json({ error: 'tenant_id, device_type_id, brand_id y model son requeridos.' });
        return;
      }

      const device = await DeviceModel.createDevice({
        tenant_id: tenantId,
        device_type_id,
        brand_id,
        model,
        year: year ? parseInt(year, 10) : null,
        description: description || null,
      });

      res.status(201).json({ message: 'Dispositivo registrado exitosamente.', device });
    } catch (error: any) {
      console.error('[DeviceController.createDevice] Error:', error);
      if (error.code === '23505') {
        res.status(409).json({ error: 'Ya existe un dispositivo con esos datos.' });
        return;
      }
      if (error.code === '23503') {
        res.status(400).json({ error: 'El tipo de dispositivo o marca no existe en este tenant.' });
        return;
      }
      res.status(500).json({ error: 'Error interno al registrar el dispositivo.' });
    }
  }

  static async updateDevice(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = resolveTenantId(req);
      const { model, year, description, brand_id } = req.body;

      if (!tenantId) {
        res.status(400).json({ error: 'tenant_id es requerido.' });
        return;
      }

      const updated = await DeviceModel.updateDevice(id, tenantId, {
        model, year, description, brand_id,
      });

      if (!updated) {
        res.status(404).json({ error: 'Dispositivo no encontrado.' });
        return;
      }

      res.json({ message: 'Dispositivo actualizado exitosamente.', device: updated });
    } catch (error: any) {
      console.error('[DeviceController.updateDevice] Error:', error);
      res.status(500).json({ error: 'Error interno al actualizar dispositivo.' });
    }
  }

  static async setDeviceStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = resolveTenantId(req);
      const { status } = req.body;

      if (!tenantId || !status || !['ACTIVE', 'INACTIVE'].includes(status)) {
        res.status(400).json({ error: 'status válido (ACTIVE/INACTIVE) es requerido.' });
        return;
      }

      const device = await DeviceModel.setStatus(id, tenantId, status);
      if (!device) {
        res.status(404).json({ error: 'Dispositivo no encontrado.' });
        return;
      }

      res.json({
        message: `Dispositivo ${status === 'ACTIVE' ? 'activado' : 'inactivado'} exitosamente.`,
        device,
      });
    } catch (error: any) {
      console.error('[DeviceController.setDeviceStatus] Error:', error);
      res.status(500).json({ error: 'Error interno al cambiar estado del dispositivo.' });
    }
  }
}
