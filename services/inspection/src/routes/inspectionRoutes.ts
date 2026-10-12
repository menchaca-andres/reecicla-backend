import { Router } from 'express';
import { InspectionController } from '../controllers/inspectionController';
import { authenticateToken, authorizeRoles } from '../middlewares/authMiddleware';

const router = Router();
const viewerRoles = ['INSPECTOR', 'TENANT_ADMIN', 'SUPER_ADMIN'];

router.get('/pending', authenticateToken, authorizeRoles(...viewerRoles), InspectionController.listPending);
router.get('/orders/:orderId/checklist', authenticateToken, authorizeRoles(...viewerRoles), InspectionController.getChecklist);
router.get('/orders/:orderId', authenticateToken, authorizeRoles(...viewerRoles), InspectionController.getByOrder);
router.get('/', authenticateToken, authorizeRoles(...viewerRoles), InspectionController.list);

// HU-015: solo el inspector registra.
router.post('/', authenticateToken, authorizeRoles('INSPECTOR'), InspectionController.register);

export default router;
