import { Router } from 'express';
import { AuthController } from '../controllers/authController';
import { QuotaController } from '../controllers/quotaController';
import { TenantController } from '../controllers/tenantController';
import { authenticateToken, authorizeRoles } from '../middlewares/authMiddleware';
import { requireInternalService } from '../middlewares/internalServiceMiddleware';

const router = Router();

router.post('/register', AuthController.register);

router.post('/admin', authenticateToken, authorizeRoles('SUPER_ADMIN'), AuthController.createAdmin);

router.post('/login', AuthController.login);

router.get('/me', authenticateToken, AuthController.getProfile);

router.patch('/tenants/:tenantId/plan', authenticateToken, authorizeRoles('SUPER_ADMIN'), QuotaController.setTenantPlan);
router.post('/internal/guest-verifications', requireInternalService, AuthController.requestGuestVerification);
router.post('/internal/guest-verifications/verify', requireInternalService, AuthController.verifyGuestClient);
router.post('/internal/quote-quota/reservations', requireInternalService, QuotaController.reserveQuote);
router.post('/internal/quote-quota/reservations/:reservationId/commit', requireInternalService, QuotaController.finishReservation);
router.delete('/internal/quote-quota/reservations/:reservationId', requireInternalService, QuotaController.finishReservation);

// Public endpoint to resolve tenant metadata by slug (used by frontend)
router.get('/tenants/slug/:slug', TenantController.getBySlug);

router.get('/internal/tenant/:slug', requireInternalService, TenantController.getBySlug);

export default router;
