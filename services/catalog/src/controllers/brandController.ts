import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { DeviceBrandModel } from '../models/deviceBrandModel';
import { resolveTenantId } from '../utils/tenant';

export class BrandController {
  static async listBrands(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const deviceTypeId = req.query.device_type_id as string;
      const includeInactive = req.query.include_inactive === 'true';

      if (!tenantId) {
        res.status(400).json({ error: 'tenant_id es requerido.' });
        return;
      }

      const brands = await DeviceBrandModel.getBrands(tenantId, deviceTypeId, includeInactive);
      res.json({ brands });
    } catch (error: any) {
      console.error('[BrandController.listBrands] Error:', error);
      res.status(500).json({ error: 'Error interno al consultar las marcas.' });
    }
  }

  static async createBrand(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { device_type_id, name } = req.body;

      if (!tenantId || !device_type_id || !name) {
        res.status(400).json({ error: 'tenant_id, device_type_id y name son requeridos.' });
        return;
      }

      const brand = await DeviceBrandModel.createBrand(tenantId, device_type_id, name.trim());
      res.status(201).json({
        message: 'Marca creada exitosamente.',
        brand,
      });
    } catch (error: any) {
      console.error('[BrandController.createBrand] Error:', error);
      if (error.code === '23505') {
        res.status(409).json({ error: 'Ya existe esa marca para este tipo de dispositivo.' });
        return;
      }
      res.status(500).json({ error: 'Error interno al crear la marca.' });
    }
  }

  static async updateBrand(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = resolveTenantId(req);
      const { name } = req.body;

      if (!tenantId || !name) {
        res.status(400).json({ error: 'tenant_id y name son requeridos.' });
        return;
      }

      const brand = await DeviceBrandModel.updateBrand(id, tenantId, name.trim());
      if (!brand) {
        res.status(404).json({ error: 'Marca no encontrada.' });
        return;
      }

      res.json({
        message: 'Marca actualizada exitosamente.',
        brand,
      });
    } catch (error: any) {
      console.error('[BrandController.updateBrand] Error:', error);
      res.status(500).json({ error: 'Error interno al actualizar la marca.' });
    }
  }

  static async setBrandStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = resolveTenantId(req);
      const { status } = req.body;

      if (!tenantId || !status || !['ACTIVE', 'INACTIVE'].includes(status)) {
        res.status(400).json({ error: 'tenant_id y status válido (ACTIVE/INACTIVE) son requeridos.' });
        return;
      }

      const brand = await DeviceBrandModel.setBrandStatus(id, tenantId, status);
      if (!brand) {
        res.status(404).json({ error: 'Marca no encontrada.' });
        return;
      }

      res.json({
        message: `Marca ${status === 'ACTIVE' ? 'activada' : 'inactivada'} exitosamente.`,
        brand,
      });
    } catch (error: any) {
      console.error('[BrandController.setBrandStatus] Error:', error);
      res.status(500).json({ error: 'Error interno al cambiar estado de la marca.' });
    }
  }
}
