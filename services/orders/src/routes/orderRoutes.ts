import { Router } from 'express';
import { OrderController } from '../controllers/orderController';
import { BoxRequestController } from '../controllers/boxRequestController';
import { authenticateInternalService, authenticateToken, authorizeRoles } from '../middlewares/authMiddleware';

const router = Router();
const logisticsRoles = ['TENANT_ADMIN', 'SUPER_ADMIN', 'INSPECTOR'];

router.post('/internal/adjusted-quote/authorize', authenticateInternalService, OrderController.authorizeAdjustedQuoteResponse);
router.post('/internal/payments/authorize', authenticateInternalService, OrderController.authorizePayment);
router.post('/tracking/:token/adjustment-resolution', OrderController.resolveAdjustmentAsGuest);
router.get('/tracking/:token', OrderController.track);
router.get('/admin/all', authenticateToken, authorizeRoles(...logisticsRoles), OrderController.listAll);
router.get('/', authenticateToken, OrderController.listMine);
router.post('/:id/adjustment-resolution', authenticateToken, OrderController.resolveAdjustmentAsUser);
router.get('/:id', authenticateToken, OrderController.getMine);

router.post('/:id/box-requests', authenticateToken, BoxRequestController.create);
router.get('/:id/box-requests', authenticateToken, BoxRequestController.list);
router.post('/:id/dispatch', authenticateToken, authorizeRoles(...logisticsRoles), OrderController.dispatch);
router.post('/:id/receive', authenticateToken, authorizeRoles(...logisticsRoles), OrderController.receive);

export default router;
