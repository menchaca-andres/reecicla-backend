import { Router } from 'express';
import { ReportController } from '../controllers/reportController';
import { authenticateToken, authorizeRoles } from '../middlewares/authMiddleware';

const router = Router();

router.get('/summary', authenticateToken, authorizeRoles('TENANT_ADMIN'), ReportController.summary);
router.get('/summary.csv', authenticateToken, authorizeRoles('TENANT_ADMIN'), ReportController.summaryCsv);

export default router;
