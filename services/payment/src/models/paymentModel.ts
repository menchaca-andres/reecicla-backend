import { createHash, randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { pool } from '../config/db';
import type { PageResult, PaginationRequest } from '../utils/pagination';
import { Payment, PaymentCompletedPayload, PaymentFailedPayload, PaymentMethod } from '../types/payment';
import { generatePaymentReceipt } from '../domain/paymentReceiptGenerator';

const RECEIPT_DIRECTORY = process.env.PAYMENT_RECEIPT_DIR || '/data/payment-receipts';

export interface CreatePaymentInput {
  tenantId: string;
  orderId: string;
  idempotencyKey: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  reference: string | null;
  userId: string;
  userName?: string;
  externalReceipt?: {
    buffer: Buffer;
    mimeType: string;
    sha256: string;
    extension: string;
  };
}

export interface PaymentAttemptResult {
  payment: Payment;
  created: boolean;
}

export class PaymentModel {
  static async findIdempotent(
    tenantId: string,
    idempotencyKey: string,
    orderId: string,
    method: PaymentMethod,
    reference: string | null,
    externalReceiptSha256: string | null
  ): Promise<Payment | null> {
    const { rows } = await pool.query<Payment>(
      `SELECT * FROM payments
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, idempotencyKey]
    );
    const payment = rows[0];
    if (!payment) return null;
    if (
      payment.order_id !== orderId ||
      payment.method !== method ||
      payment.reference !== reference ||
      payment.external_receipt_sha256 !== externalReceiptSha256
    ) {
      throw new Error('La clave de idempotencia ya fue usada para otra operación.');
    }
    return payment;
  }

  static async createAttempt(input: CreatePaymentInput): Promise<PaymentAttemptResult> {
    const client = await pool.connect();
    const writtenPaths: string[] = [];
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`idempotency:${input.tenantId}:${input.idempotencyKey}`]
      );
      const existing = await client.query<Payment>(
        `SELECT * FROM payments
         WHERE tenant_id = $1 AND idempotency_key = $2
         FOR UPDATE`,
        [input.tenantId, input.idempotencyKey]
      );
      if (existing.rows[0]) {
        const payment = existing.rows[0];
        if (
          payment.order_id !== input.orderId ||
          payment.method !== input.method ||
          payment.reference !== input.reference ||
          payment.external_receipt_sha256 !== (input.externalReceipt?.sha256 ?? null)
        ) {
          throw new Error('La clave de idempotencia ya fue usada para otra operación.');
        }
        await client.query('COMMIT');
        return { payment, created: false };
      }

      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`completed-order:${input.tenantId}:${input.orderId}`]
      );
      const completed = await client.query(
        `SELECT id FROM payments
         WHERE tenant_id = $1 AND order_id = $2 AND status = 'COMPLETED'
         LIMIT 1`,
        [input.tenantId, input.orderId]
      );
      if (completed.rows[0]) {
        throw new Error('La orden ya tiene un pago completado.');
      }

      const pending = await client.query(
        `SELECT id FROM payments
         WHERE tenant_id = $1 AND order_id = $2
           AND status IN ('PENDING', 'PROCESSING')
         LIMIT 1`,
        [input.tenantId, input.orderId]
      );
      if (pending.rows[0]) {
        throw new Error('Ya hay un intento de pago en proceso para esta orden.');
      }

      const paymentId = randomUUID();
      const externalReceiptPath = input.externalReceipt
        ? path.join(RECEIPT_DIRECTORY, `${paymentId}-evidence.${input.externalReceipt.extension}`)
        : null;
      if (externalReceiptPath && input.externalReceipt) {
        await mkdir(RECEIPT_DIRECTORY, { recursive: true });
        await writeFile(externalReceiptPath, input.externalReceipt.buffer, { flag: 'wx', mode: 0o600 });
        writtenPaths.push(externalReceiptPath);
      }

      const inserted = await client.query<Payment>(
        `INSERT INTO payments (
           id, tenant_id, order_id, idempotency_key, amount, currency,
           method, status, reference, external_receipt_path, external_receipt_mime_type,
           external_receipt_sha256, paid_by_user_id, paid_by_user_name, paid_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8, $9, $10, $11, $12, $13, NULL)
         RETURNING *`,
        [
          paymentId,
          input.tenantId,
          input.orderId,
          input.idempotencyKey,
          input.amount,
          input.currency,
          input.method,
          input.reference,
          externalReceiptPath,
          input.externalReceipt?.mimeType ?? null,
          input.externalReceipt?.sha256 ?? null,
          input.userId,
          input.userName ?? null,
        ]
      );
      await client.query('COMMIT');
      return { payment: inserted.rows[0], created: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      await Promise.all(writtenPaths.map((filePath) =>
        unlink(filePath).catch((cleanupError) =>
          console.error('[Payment] No se pudo eliminar un archivo temporal:', cleanupError)
        )
      ));
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new Error('La orden ya tiene un pago completado.');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  static async completeAttempt(
    tenantId: string,
    paymentId: string,
    orderNumber: string,
    paidAt: Date
  ): Promise<Payment> {
    const client = await pool.connect();
    let receiptPath: string | null = null;
    try {
      await client.query('BEGIN');
      const selected = await client.query<Payment>(
        `SELECT * FROM payments
         WHERE tenant_id = $1 AND id = $2
         FOR UPDATE`,
        [tenantId, paymentId]
      );
      const payment = selected.rows[0];
      if (!payment) throw new Error('El intento de pago no existe.');
      if (payment.status === 'COMPLETED') {
        await client.query('COMMIT');
        return payment;
      }
      if (payment.status !== 'PENDING' && payment.status !== 'PROCESSING') {
        throw new Error('El intento de pago ya no puede completarse.');
      }

      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`completed-order:${tenantId}:${payment.order_id}`]
      );
      const completed = await client.query(
        `SELECT id FROM payments
         WHERE tenant_id = $1 AND order_id = $2 AND status = 'COMPLETED'
         LIMIT 1`,
        [tenantId, payment.order_id]
      );
      if (completed.rows[0] && completed.rows[0].id !== paymentId) {
        throw new Error('La orden ya tiene un pago completado.');
      }

      const internalReceipt = await generatePaymentReceipt({
        paymentId: payment.id,
        tenantId: payment.tenant_id,
        orderNumber,
        amount: Number(payment.amount),
        currency: payment.currency.trim(),
        method: payment.method,
        reference: payment.reference,
        paidByUserId: payment.paid_by_user_id,
        paidByUserName: payment.paid_by_user_name ?? undefined,
        paidAt,
      });
      await mkdir(RECEIPT_DIRECTORY, { recursive: true });
      receiptPath = path.join(RECEIPT_DIRECTORY, `${payment.id}.pdf`);
      await writeFile(receiptPath, internalReceipt, { flag: 'wx', mode: 0o600 });
      const internalReceiptSha256 = createHash('sha256').update(internalReceipt).digest('hex');
      const updated = await client.query<Payment>(
        `UPDATE payments
         SET status = 'COMPLETED',
             failure_reason = NULL,
             internal_receipt_path = $1,
             internal_receipt_mime_type = 'application/pdf',
             internal_receipt_sha256 = $2,
             paid_at = $3,
             updated_at = NOW()
         WHERE tenant_id = $4 AND id = $5
         RETURNING *`,
        [receiptPath, internalReceiptSha256, paidAt, tenantId, paymentId]
      );
      const completedPayment = updated.rows[0];
      const payload: PaymentCompletedPayload = {
        payment_id: completedPayment.id,
        order_id: completedPayment.order_id,
        amount: Number(completedPayment.amount),
        currency: completedPayment.currency.trim(),
        method: completedPayment.method,
        reference: completedPayment.reference,
        paid_by_user_id: completedPayment.paid_by_user_id,
        paid_at: completedPayment.paid_at ?? paidAt.toISOString(),
      };
      await client.query(
        `INSERT INTO payment_event_outbox (
           event_id, tenant_id, aggregate_id, correlation_id, event_type, routing_key, payload
         ) VALUES ($1, $2, $3, $4, 'PaymentCompleted', 'payment.completed', $5)`,
        [randomUUID(), tenantId, paymentId, payment.order_id, JSON.stringify(payload)]
      );
      await client.query('COMMIT');
      return completedPayment;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (receiptPath) {
        await unlink(receiptPath).catch((cleanupError) =>
          console.error('[Payment] No se pudo eliminar un comprobante generado temporal:', cleanupError)
        );
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new Error('La orden ya tiene un pago completado.');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  static async failAttempt(
    tenantId: string,
    paymentId: string,
    failureReason: string
  ): Promise<Payment> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<Payment>(
        `SELECT * FROM payments
         WHERE tenant_id = $1 AND id = $2
         FOR UPDATE`,
        [tenantId, paymentId]
      );
      const payment = selected.rows[0];
      if (!payment) throw new Error('El intento de pago no existe.');
      if (payment.status === 'FAILED') {
        await client.query('COMMIT');
        return payment;
      }
      if (payment.status !== 'PENDING' && payment.status !== 'PROCESSING') {
        throw new Error('El intento de pago ya fue procesado.');
      }

      const failedAt = new Date();
      const reason = failureReason.slice(0, 500);
      const updated = await client.query<Payment>(
        `UPDATE payments
         SET status = 'FAILED', failure_reason = $1, updated_at = NOW()
         WHERE tenant_id = $2 AND id = $3
         RETURNING *`,
        [reason, tenantId, paymentId]
      );
      const failedPayment = updated.rows[0];
      const payload: PaymentFailedPayload = {
        payment_id: failedPayment.id,
        order_id: failedPayment.order_id,
        amount: Number(failedPayment.amount),
        currency: failedPayment.currency.trim(),
        method: failedPayment.method,
        failure_reason: reason,
        failed_at: failedAt.toISOString(),
      };
      await client.query(
        `INSERT INTO payment_event_outbox (
           event_id, tenant_id, aggregate_id, correlation_id, event_type, routing_key, payload
         ) VALUES ($1, $2, $3, $4, 'PaymentFailed', 'payment.failed', $5)`,
        [randomUUID(), tenantId, paymentId, failedPayment.order_id, JSON.stringify(payload)]
      );
      await client.query('COMMIT');
      return failedPayment;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  static findForOrder(tenantId: string, orderId: string): Promise<Payment[]>;
  static findForOrder(
    tenantId: string,
    orderId: string,
    pagination: PaginationRequest
  ): Promise<PageResult<Payment>>;
  static async findForOrder(
    tenantId: string,
    orderId: string,
    pagination?: PaginationRequest
  ): Promise<Payment[] | PageResult<Payment>> {
    const { rows } = await pool.query<Payment>(
      `SELECT id, tenant_id, order_id, amount, currency, method, status,
              reference, failure_reason, paid_by_user_id, paid_by_user_name, paid_at, created_at,
              internal_receipt_path, internal_receipt_mime_type,
              external_receipt_path, external_receipt_mime_type
       FROM payments
       WHERE tenant_id = $1 AND order_id = $2
       ORDER BY created_at DESC, id DESC
       ${pagination ? 'LIMIT $3 OFFSET $4' : ''}`,
      pagination
        ? [tenantId, orderId, pagination.limit, pagination.offset]
        : [tenantId, orderId]
    );
    if (!pagination) return rows;
    const count = await pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM payments WHERE tenant_id = $1 AND order_id = $2',
      [tenantId, orderId]
    );
    return { items: rows, total_items: Number(count.rows[0].count) };
  }

  static findForTenant(tenantId: string): Promise<Payment[]>;
  static findForTenant(
    tenantId: string,
    pagination: PaginationRequest
  ): Promise<PageResult<Payment>>;
  static async findForTenant(
    tenantId: string,
    pagination?: PaginationRequest
  ): Promise<Payment[] | PageResult<Payment>> {
    const { rows } = await pool.query<Payment>(
      `SELECT id, tenant_id, order_id, amount, currency, method, status,
              reference, failure_reason, paid_by_user_id, paid_by_user_name, paid_at, created_at,
              internal_receipt_path, internal_receipt_mime_type,
              external_receipt_path, external_receipt_mime_type
       FROM payments
       WHERE tenant_id = $1
       ORDER BY created_at DESC, id DESC
       ${pagination ? 'LIMIT $2 OFFSET $3' : ''}`,
      pagination
        ? [tenantId, pagination.limit, pagination.offset]
        : [tenantId]
    );
    if (!pagination) return rows;
    const count = await pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM payments WHERE tenant_id = $1',
      [tenantId]
    );
    return { items: rows, total_items: Number(count.rows[0].count) };
  }

  static async findReceipt(
    tenantId: string,
    orderId: string,
    paymentId: string
  ): Promise<Payment | null> {
    const { rows } = await pool.query<Payment>(
      `SELECT *
       FROM payments
       WHERE tenant_id = $1 AND order_id = $2 AND id = $3`,
      [tenantId, orderId, paymentId]
    );
    return rows[0] ?? null;
  }

  static async ensureInternalReceipt(payment: Payment, orderNumber: string): Promise<Payment> {
    if (payment.status !== 'COMPLETED') {
      throw new Error('Solo los pagos completados tienen comprobante Reecicla.');
    }
    if (payment.internal_receipt_path && payment.internal_receipt_mime_type) return payment;
    const receipt = await generatePaymentReceipt({
      paymentId: payment.id,
      tenantId: payment.tenant_id,
      orderNumber,
      amount: Number(payment.amount),
      currency: payment.currency.trim(),
      method: payment.method,
      reference: payment.reference,
      paidByUserId: payment.paid_by_user_id,
      paidByUserName: payment.paid_by_user_name ?? undefined,
      paidAt: new Date(payment.paid_at ?? payment.created_at),
    });
    await mkdir(RECEIPT_DIRECTORY, { recursive: true });
    const receiptPath = path.join(RECEIPT_DIRECTORY, `${payment.id}-${randomUUID()}.pdf`);
    await writeFile(receiptPath, receipt, { flag: 'wx', mode: 0o600 });
    try {
      const receiptSha256 = createHash('sha256').update(receipt).digest('hex');
      const { rows } = await pool.query<Payment>(
        `UPDATE payments
         SET internal_receipt_path = COALESCE(internal_receipt_path, $1),
             internal_receipt_mime_type = COALESCE(internal_receipt_mime_type, 'application/pdf'),
             internal_receipt_sha256 = COALESCE(internal_receipt_sha256, $2)
         WHERE id = $3 AND tenant_id = $4
         RETURNING *`,
        [receiptPath, receiptSha256, payment.id, payment.tenant_id]
      );
      if (!rows[0]) throw new Error('No se pudo guardar el comprobante interno.');
      if (rows[0].internal_receipt_path !== receiptPath) await unlink(receiptPath);
      return rows[0];
    } catch (error) {
      await unlink(receiptPath).catch((cleanupError) =>
        console.error('[Payment] No se pudo eliminar un comprobante generado temporal:', cleanupError)
      );
      throw error;
    }
  }
}
