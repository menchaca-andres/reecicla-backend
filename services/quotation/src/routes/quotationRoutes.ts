import { Router } from 'express';
import { QuotationController } from '../controllers/quotationController';
import { authenticateToken, authorizeRoles } from '../middlewares/authMiddleware';

const router = Router();

router.post('/rules', authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'), QuotationController.definePricingRule);
router.get('/rules', authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'), QuotationController.getTenantRules);

router.post('/quotes', authenticateToken, QuotationController.createQuote);

router.get('/quotes/user', authenticateToken, QuotationController.getUserQuotes);
router.get('/quotes/:id', QuotationController.getQuote);

export default router;
