import { Router } from 'express';
import { QuotationController } from '../controllers/quotationController';
import { authenticateOptionalToken, authenticateToken, authorizeRoles } from '../middlewares/authMiddleware';

const router = Router();

router.post('/rules', authenticateToken, authorizeRoles('TENANT_ADMIN', 'CATALOG_ADMIN', 'SUPER_ADMIN'), QuotationController.definePricingRule);
router.get('/rules', authenticateToken, authorizeRoles('TENANT_ADMIN', 'CATALOG_ADMIN', 'SUPER_ADMIN'), QuotationController.getTenantRules);

router.post('/quotes', authenticateOptionalToken, QuotationController.createQuote);

router.get('/quotes/user', authenticateToken, QuotationController.getUserQuotes);
router.post('/quotes/:id/accept', authenticateOptionalToken, QuotationController.acceptQuote);
router.post('/quotes/:id/reject', authenticateOptionalToken, QuotationController.rejectQuote);
router.get('/quotes/:id', QuotationController.getQuote);

export default router;
