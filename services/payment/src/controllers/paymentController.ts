import { createReadStream } from 'fs';
import { Request, Response } from 'express';
import { authorizeOrder } from '../clients/ordersClient';
import { identifyReceipt, validateIdempotencyKey } from '../domain/paymentReceipt';
import { SimulatedPayoutAdapter } from '../domain/payoutAdapter';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { PaymentModel } from '../models/paymentModel';
import { dispatchPendingPaymentEvents } from '../messaging/eventPublisher';

const payoutAdapter = new SimulatedPayoutAdapter();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tenantId(req: AuthenticatedRequest): string {
  if (!req.authUser) throw new Error('Usuario no autenticado.');
  return req.authUser.tenantId;
}

function publicPayment(payment: Awaited<ReturnType<typeof PaymentModel.findForOrder>>[number]) {
  return {
    id: payment.id,
    tenant_id: payment.tenant_id,
    order_id: payment.order_id,
    amount: Number(payment.amount),
    currency: payment.currency.trim(),
    method: payment.method,
    status: payment.status,
    reference: payment.reference,
    paid_at: payment.paid_at,
    created_at: payment.created_at,
    receipt_available: true,
    external_receipt_available: Boolean(payment.external_receipt_path),
  };
}

export class PaymentController {
  static async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.authUser) {
        res.status(401).json({ error: 'Usuario no autenticado.' });
        return;
      }
      const orderId = req.params.orderId;
      if (!UUID_PATTERN.test(orderId)) {
        res.status(400).json({ error: 'El identificador de la orden no es válido.' });
        return;
      }
      const method = req.body?.method;
      const reference = typeof req.body?.reference === 'string' ? req.body.reference.trim() : '';
      const idempotencyKey = validateIdempotencyKey(req.header('idempotency-key'));
      if (method !== 'BANK_TRANSFER' && method !== 'CHECK') {
        res.status(400).json({ error: 'El método debe ser BANK_TRANSFER o CHECK.' });
        return;
      }
      if (reference.length > 150) {
        res.status(400).json({ error: 'La referencia no puede superar 150 caracteres.' });
        return;
      }
      const externalReceipt = req.file
        ? { ...identifyReceipt(req.file.buffer), buffer: req.file.buffer }
        : undefined;
      const existing = await PaymentModel.findIdempotent(
        req.authUser.tenantId,
        idempotencyKey,
        orderId,
        method,
        reference || null,
        externalReceipt?.sha256 ?? null
      );
      if (existing) {
        res.status(200).json({
          message: 'La operación ya estaba registrada.',
          payment: publicPayment(existing),
        });
        return;
      }
      const order = await authorizeOrder(orderId, req.authUser.tenantId);
      const amount = Number(order.amount);
      if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(order.currency.trim())) {
        throw new Error('La orden no tiene un monto final válido para pagar.');
      }
      const confirmation = await payoutAdapter.confirm(method, reference);
      const result = await PaymentModel.createCompleted({
        tenantId: req.authUser.tenantId,
        orderId,
        idempotencyKey,
        amount,
        currency: order.currency.trim(),
        orderNumber: order.order_number,
        method,
        reference: confirmation.reference,
        userId: req.authUser.userId,
        userName: req.authUser.name,
        paidAt: confirmation.paidAt,
        ...(externalReceipt ? { externalReceipt } : {}),
      });
      if (result.created) {
        dispatchPendingPaymentEvents().catch((error) =>
          console.error('[Payment] El pago quedó registrado; el evento se reintentará desde el outbox:', error)
        );
      }
      res.status(result.created ? 201 : 200).json({
        message: result.created ? 'Pago registrado y comprobante guardado.' : 'La operación ya estaba registrada.',
        payment: publicPayment(result.payment),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo registrar el pago.';
      const status = message.includes('autenticado') ? 401 :
        message.includes('no está habilitada') || message.includes('no tiene un pago') ||
        message.includes('ya tiene un pago') || message.includes('idempotencia') ||
        message.includes('monto o moneda') ? 409 :
        message.includes('Orders no está disponible') || message.includes('validar la orden') ? 503 :
        message.includes('no existe o no está disponible') ? 404 :
        message.includes('referencia o número') || message.includes('no puede superar') ||
        message.includes('Idempotency-Key') || message.includes('evidencia bancaria') ||
        message.includes('comprobante') ? 400 : 500;
      if (status >= 500) {
        console.error('[Payment] Error registrando pago:', error);
        res.status(status).json({ error: 'No se pudo registrar el pago.' });
        return;
      }
      res.status(status).json({ error: message });
    }
  }

  static async listForOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.authUser) {
        res.status(401).json({ error: 'Usuario no autenticado.' });
        return;
      }
      const orderId = req.params.orderId;
      if (!UUID_PATTERN.test(orderId)) {
        res.status(400).json({ error: 'El identificador de la orden no es válido.' });
        return;
      }
      await authorizeOrder(
        orderId,
        req.authUser.tenantId,
        req.authUser.role === 'CLIENT' ? req.authUser.userId : undefined,
        'READ'
      );
      const payments = await PaymentModel.findForOrder(req.authUser.tenantId, orderId);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ payments: payments.map(publicPayment) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron consultar los pagos.';
      const status = message.includes('no encontrada') || message.includes('no existe') ? 404 :
        message.includes('no corresponde') || message.includes('no autorizada') ? 403 :
        message.includes('Orders no está disponible') || message.includes('validar la orden') ? 503 : 500;
      if (status === 500) {
        console.error('[Payment] Error consultando pagos de la orden:', error);
        res.status(status).json({ error: 'No se pudieron consultar los pagos.' });
        return;
      }
      res.status(status).json({ error: message });
    }
  }

  static async listForTenant(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const payments = await PaymentModel.findForTenant(tenantId(req));
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ payments: payments.map(publicPayment) });
    } catch (error) {
      console.error('[Payment] Error consultando pagos del negocio:', error);
      res.status(500).json({ error: 'No se pudieron consultar los pagos.' });
    }
  }

  static async downloadReceipt(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.authUser) {
        res.status(401).json({ error: 'Usuario no autenticado.' });
        return;
      }
      if (!UUID_PATTERN.test(req.params.orderId) || !UUID_PATTERN.test(req.params.paymentId)) {
        res.status(400).json({ error: 'El identificador del pago o de la orden no es válido.' });
        return;
      }
      const order = await authorizeOrder(
        req.params.orderId,
        req.authUser.tenantId,
        req.authUser.role === 'CLIENT' ? req.authUser.userId : undefined,
        'READ'
      );
      const payment = await PaymentModel.findReceipt(
        req.authUser.tenantId,
        req.params.orderId,
        req.params.paymentId
      );
      if (!payment) {
        res.status(404).json({ error: 'Comprobante no encontrado.' });
        return;
      }
      const receipt = await PaymentModel.ensureInternalReceipt(payment, order.order_number);
      if (!receipt.internal_receipt_path) {
        throw new Error('No se pudo recuperar la ruta del comprobante interno.');
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', receipt.internal_receipt_mime_type ?? 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="comprobante-reecicla-${req.params.paymentId}.pdf"`
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const stream = createReadStream(receipt.internal_receipt_path);
      stream.on('error', (error) => {
        console.error('[Payment] No se pudo leer el comprobante:', error);
        if (!res.headersSent) res.status(404).json({ error: 'El archivo del comprobante no está disponible.' });
        else res.destroy(error);
      });
      stream.pipe(res);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo descargar el comprobante.';
      const status = message.includes('no encontrada') || message.includes('no existe') ? 404 :
        message.includes('no corresponde') || message.includes('no autorizada') ? 403 :
        message.includes('Orders no está disponible') || message.includes('validar la orden') ? 503 : 500;
      if (status === 500) {
        console.error('[Payment] Error descargando comprobante:', error);
        res.status(status).json({ error: 'No se pudo descargar el comprobante.' });
        return;
      }
      res.status(status).json({ error: message });
    }
  }

  static async downloadExternalReceipt(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.authUser) {
        res.status(401).json({ error: 'Usuario no autenticado.' });
        return;
      }
      if (!UUID_PATTERN.test(req.params.orderId) || !UUID_PATTERN.test(req.params.paymentId)) {
        res.status(400).json({ error: 'El identificador del pago o de la orden no es válido.' });
        return;
      }
      await authorizeOrder(
        req.params.orderId,
        req.authUser.tenantId,
        req.authUser.role === 'CLIENT' ? req.authUser.userId : undefined,
        'READ'
      );
      const receipt = await PaymentModel.findReceipt(
        req.authUser.tenantId,
        req.params.orderId,
        req.params.paymentId
      );
      if (!receipt?.external_receipt_path || !receipt.external_receipt_mime_type) {
        res.status(404).json({ error: 'No hay evidencia bancaria adjunta para este pago.' });
        return;
      }
      const extension = receipt.external_receipt_mime_type === 'application/pdf'
        ? 'pdf'
        : receipt.external_receipt_mime_type === 'image/png'
          ? 'png'
          : 'jpg';
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', receipt.external_receipt_mime_type);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="evidencia-bancaria-${req.params.paymentId}.${extension}"`
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const stream = createReadStream(receipt.external_receipt_path);
      stream.on('error', (error) => {
        console.error('[Payment] No se pudo leer la evidencia bancaria:', error);
        if (!res.headersSent) res.status(404).json({ error: 'El archivo de evidencia bancaria no está disponible.' });
        else res.destroy(error);
      });
      stream.pipe(res);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo descargar la evidencia bancaria.';
      const status = message.includes('no existe') ? 404 :
        message.includes('no corresponde') || message.includes('no autorizada') ? 403 :
        message.includes('Orders no está disponible') || message.includes('validar la orden') ? 503 : 500;
      if (status === 500) {
        console.error('[Payment] Error descargando evidencia bancaria:', error);
        res.status(status).json({ error: 'No se pudo descargar la evidencia bancaria.' });
        return;
      }
      res.status(status).json({ error: message });
    }
  }
}
