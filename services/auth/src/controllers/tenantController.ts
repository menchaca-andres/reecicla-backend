import { Request, Response } from 'express';
import { TenantModel } from '../models/tenantModel';

export class TenantController {
  static async getBySlug(req: Request, res: Response): Promise<void> {
    try {
      const { slug } = req.params;
      const tenant = await TenantModel.findBySlug(slug);

      if (!tenant) {
        res.status(404).json({ error: 'Tenant no encontrado.' });
        return;
      }

      res.status(200).json({ tenant_id: tenant.id, slug: tenant.slug, name: tenant.name });
    } catch (error: any) {
      console.error('[TenantController.getBySlug] Error:', error);
      res.status(500).json({ error: 'Error al resolver el tenant.', details: error?.message });
    }
  }
}
