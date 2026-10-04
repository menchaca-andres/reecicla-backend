import { Router } from 'express';
import { AuthController } from '../controllers/authController';
import { authenticateToken, authorizeRoles } from '../middlewares/authMiddleware';

const router = Router();

router.post('/register', AuthController.register);

router.post('/admin', authenticateToken, authorizeRoles('SUPER_ADMIN'), AuthController.createAdmin);

router.post('/login', AuthController.login);

router.get('/me', authenticateToken, AuthController.getProfile);

export default router;
