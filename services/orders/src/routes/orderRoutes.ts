import { Router } from 'express';
import { OrderController } from '../controllers/orderController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

router.get('/', authenticateToken, OrderController.listMine);
router.get('/:id', authenticateToken, OrderController.getMine);

export default router;