import { Router } from 'express';
import multer from 'multer';
import { PaymentController } from '../controllers/paymentController';
import { authenticateToken, authorizeRoles } from '../middlewares/authMiddleware';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const accepted = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!accepted.includes(file.mimetype)) {
      callback(new Error('La evidencia bancaria opcional debe ser PDF, JPG o PNG.'));
      return;
    }
    callback(null, true);
  },
});

const router = Router();
router.get('/admin', authenticateToken, authorizeRoles('TENANT_ADMIN'), PaymentController.listForTenant);
router.post(
  '/orders/:orderId',
  authenticateToken,
  authorizeRoles('TENANT_ADMIN'),
  upload.single('receipt'),
  PaymentController.create
);
router.get(
  '/orders/:orderId',
  authenticateToken,
  authorizeRoles('CLIENT', 'TENANT_ADMIN'),
  PaymentController.listForOrder
);
router.get(
  '/orders/:orderId/:paymentId/receipt',
  authenticateToken,
  authorizeRoles('CLIENT', 'TENANT_ADMIN'),
  PaymentController.downloadReceipt
);
router.get(
  '/orders/:orderId/:paymentId/external-receipt',
  authenticateToken,
  authorizeRoles('CLIENT', 'TENANT_ADMIN'),
  PaymentController.downloadExternalReceipt
);

export default router;
