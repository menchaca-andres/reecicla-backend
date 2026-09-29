import { Router } from 'express';
import { AuthController } from '../controllers/authController';
import { authenticateToken, authorizeRoles } from '../middlewares/authMiddleware';

const router = Router();

// HU-002: Registrar una cuenta de cliente pública (Fuerza rol = 'CLIENT')
router.post('/register', AuthController.register);

// Endpoint exclusivo Superadmin: Crear Administrador de un Tenant
router.post('/admin', authenticateToken, authorizeRoles('SUPER_ADMIN'), AuthController.createAdmin);

// HU-003: Iniciar sesión en la plataforma (Retorna JWT con su respectivo rol)
router.post('/login', AuthController.login);

// HU-001: Obtener contexto de identidad del usuario
router.get('/me', authenticateToken, AuthController.getProfile);

export default router;
