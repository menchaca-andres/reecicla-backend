import { Router } from 'express';
import { AuthController } from '../controllers/authController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

router.post('/register', AuthController.register);

router.post('/login', AuthController.login);

router.get('/me', authenticateToken, AuthController.getProfile);

export default router;
