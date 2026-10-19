import { Router } from 'express';
import { AuthController } from '../controllers/authController';
import { TenantController } from '../controllers/tenantController';
import { QuotaController } from '../controllers/quotaController';
import { authenticateToken, authorizePlatformAdmin } from '../middlewares/authMiddleware';
import { requireInternalService } from '../middlewares/internalServiceMiddleware';

const router = Router();

router.post('/register', AuthController.register);
router.post('/login', AuthController.login);
router.get('/me', authenticateToken, AuthController.getProfile);

router.post('/platform/login', AuthController.platformLogin);
router.get('/platform/me', authenticateToken, authorizePlatformAdmin, AuthController.getPlatformProfile);
router.post('/admin', authenticateToken, authorizePlatformAdmin, AuthController.createAdmin);
router.post('/tenants', authenticateToken, authorizePlatformAdmin, AuthController.createTenant);
router.get('/tenants', authenticateToken, authorizePlatformAdmin, AuthController.listTenants);
router.get('/tenants/slug/:slug', TenantController.getBySlug);
router.patch('/tenants/:tenantId/plan', authenticateToken, authorizePlatformAdmin, QuotaController.setTenantPlan);

router.post('/internal/guest-verifications', requireInternalService, AuthController.requestGuestVerification);
router.post('/internal/guest-verifications/verify', requireInternalService, AuthController.verifyGuestClient);
router.post('/internal/order-tracking-links', requireInternalService, AuthController.sendOrderTrackingLink);
router.post('/internal/notify-catalog-maintenance', requireInternalService, AuthController.notifyCatalogMaintenance);
router.post('/internal/quote-quota/reservations', requireInternalService, QuotaController.reserveQuote);
router.post('/internal/quote-quota/reservations/:reservationId/commit', requireInternalService, QuotaController.finishReservation);
router.delete('/internal/quote-quota/reservations/:reservationId', requireInternalService, QuotaController.finishReservation);

router.get('/internal/tenant/:slug', requireInternalService, TenantController.getBySlug);
router.get('/internal/tenants/slug/:slug', requireInternalService, AuthController.resolveTenantBySlug);

export default router;
