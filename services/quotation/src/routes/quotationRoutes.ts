import { Router } from 'express';
import { QuotationController } from '../controllers/quotationController';
import { authenticateToken, authorizeRoles } from '../middlewares/authMiddleware';

const router = Router();

router.post('/rules', authenticateToken, authorizeRoles('TENANT_ADMIN', 'CATALOG_ADMIN', 'SUPER_ADMIN'), QuotationController.definePricingRule);
router.get('/rules', authenticateToken, authorizeRoles('TENANT_ADMIN', 'CATALOG_ADMIN', 'SUPER_ADMIN'), QuotationController.getTenantRules);

router.post('/quotes', authenticateToken, QuotationController.createQuote);

router.get('/quotes/user', authenticateToken, QuotationController.getUserQuotes);
router.post('/quotes/:id/accept', authenticateToken, QuotationController.acceptQuote);
router.post('/quotes/:id/reject', authenticateToken, QuotationController.rejectQuote);
router.get('/quotes/:id', authenticateToken, QuotationController.getQuote);

export default router;
