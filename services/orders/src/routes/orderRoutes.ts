import { Router } from 'express';
import { OrderController } from '../controllers/orderController';
import { BoxRequestController } from '../controllers/boxRequestController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

router.get('/', authenticateToken, OrderController.listMine);
router.get('/:id', authenticateToken, OrderController.getMine);

router.post('/:id/box-requests', authenticateToken, BoxRequestController.create);
router.get('/:id/box-requests', authenticateToken, BoxRequestController.list);

export default router;