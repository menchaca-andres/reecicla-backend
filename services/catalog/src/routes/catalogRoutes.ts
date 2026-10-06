import { Router } from 'express';
import { CatalogController } from '../controllers/catalogController';
import { BrandController } from '../controllers/brandController';
import { DeviceController } from '../controllers/deviceController';
import { EvaluationRuleController } from '../controllers/evaluationRuleController';
import { authenticateOptionalToken, authenticateToken, authorizeRoles } from '../middlewares/authMiddleware';

const router = Router();

router.get('/device-types', authenticateOptionalToken, CatalogController.listDeviceTypes);

router.post('/device-types', authenticateToken, authorizeRoles('CATALOG_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN'), CatalogController.createDeviceType);

router.put('/device-types/:id', authenticateToken, authorizeRoles('CATALOG_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN'), CatalogController.updateDeviceType);

router.patch('/device-types/:id/inactivate', authenticateToken, authorizeRoles('CATALOG_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN'), CatalogController.inactivateDeviceType);

router.get('/brands', BrandController.listBrands);

router.post('/brands', authenticateToken, authorizeRoles('CATALOG_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN'), BrandController.createBrand);

router.patch('/brands/:id', authenticateToken, authorizeRoles('CATALOG_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN'), BrandController.updateBrand);

router.patch('/brands/:id/status', authenticateToken, authorizeRoles('CATALOG_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN'), BrandController.setBrandStatus);

router.get('/devices', DeviceController.listDevices);
router.get('/devices/:id', DeviceController.getDevice);

router.post('/devices', authenticateToken, authorizeRoles('CATALOG_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN'), DeviceController.createDevice);

router.patch('/devices/:id', authenticateToken, authorizeRoles('CATALOG_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN'), DeviceController.updateDevice);

router.patch('/devices/:id/status', authenticateToken, authorizeRoles('CATALOG_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN'), DeviceController.setDeviceStatus);
router.get('/evaluation-rules/active', EvaluationRuleController.getActiveRule);
router.get('/evaluation-rules/history', EvaluationRuleController.getRuleHistory);
router.get('/evaluation-rules/:id', EvaluationRuleController.getRuleById);

router.post('/evaluation-rules', authenticateToken, authorizeRoles('CATALOG_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN'), EvaluationRuleController.createRuleVersion);

export default router;

