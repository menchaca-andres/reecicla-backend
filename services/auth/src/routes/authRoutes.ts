import { Router } from 'express';
import { AuthController } from '../controllers/authController';
import { QuotaController } from '../controllers/quotaController';
import { authenticateToken, authorizePlatformAdmin } from '../middlewares/authMiddleware';
import { requireInternalService } from '../middlewares/internalServiceMiddleware';

const router = Router();

router.post('/register', AuthController.register);

router.post('/platform/login', AuthController.platformLogin);
router.get('/platform/me', authenticateToken, authorizePlatformAdmin, AuthController.getPlatformProfile);
router.post('/admin', authenticateToken, authorizePlatformAdmin, AuthController.createAdmin);
router.post('/tenants', authenticateToken, authorizePlatformAdmin, AuthController.createTenant);
router.get('/tenants', authenticateToken, authorizePlatformAdmin, AuthController.listTenants);
router.get('/tenants/slug/:slug', AuthController.getTenantBySlug);
router.get('/internal/tenants/slug/:slug', requireInternalService, AuthController.resolveTenantBySlug);

router.post('/login', AuthController.login);

router.get('/me', authenticateToken, AuthController.getProfile);

router.patch('/tenants/:tenantId/plan', authenticateToken, authorizePlatformAdmin, QuotaController.setTenantPlan);
router.post('/internal/quote-quota/reservations', requireInternalService, QuotaController.reserveQuote);
router.post('/internal/quote-quota/reservations/:reservationId/commit', requireInternalService, QuotaController.finishReservation);
router.delete('/internal/quote-quota/reservations/:reservationId', requireInternalService, QuotaController.finishReservation);

export default router;
