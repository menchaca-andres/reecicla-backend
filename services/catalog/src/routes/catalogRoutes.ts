import { Router } from 'express';
import { CatalogController } from '../controllers/catalogController';
import { authenticateToken, authorizeRoles } from '../middlewares/authMiddleware';

const router = Router();

// Public / Client endpoint to fetch device types (reads tenant_id from query or token)
router.get('/device-types', CatalogController.listDeviceTypes);

// Admin endpoints (CATALOG_ADMIN, TENANT_ADMIN, SUPER_ADMIN)
router.post(
  '/device-types',
  authenticateToken,
  authorizeRoles('CATALOG_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN'),
  CatalogController.createDeviceType
);

router.put(
  '/device-types/:id',
  authenticateToken,
  authorizeRoles('CATALOG_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN'),
  CatalogController.updateDeviceType
);

router.patch(
  '/device-types/:id/inactivate',
  authenticateToken,
  authorizeRoles('CATALOG_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN'),
  CatalogController.inactivateDeviceType
);

export default router;
