import { Router } from 'express';
import { QuotationController } from '../controllers/quotationController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

router.post('/rules', QuotationController.definePricingRule);

router.post('/quotes', authenticateToken, QuotationController.createQuote);

router.get('/quotes/user', authenticateToken, QuotationController.getUserQuotes);
router.get('/quotes/:id', QuotationController.getQuote);

export default router;
