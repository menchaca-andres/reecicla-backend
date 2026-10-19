import { createHash, randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { pool } from '../config/db';
import { Payment, PaymentCompletedPayload, PaymentMethod } from '../types/payment';
import { generatePaymentReceipt } from '../domain/paymentReceiptGenerator';

const RECEIPT_DIRECTORY = process.env.PAYMENT_RECEIPT_DIR || '/data/payment-receipts';

export interface CreatePaymentInput {
  tenantId: string;
  orderId: string;
  idempotencyKey: string;
  amount: number;
  currency: string;
  orderNumber: string;
  method: PaymentMethod;
  reference: string | null;
  userId: string;
  userName?: string;
  paidAt: Date;
  externalReceipt?: {
    buffer: Buffer;
    mimeType: string;
    sha256: string;
    extension: string;
  };
}

export interface CreatePaymentResult {
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

  static async createCompleted(input: CreatePaymentInput): Promise<CreatePaymentResult> {
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

      const paymentId = randomUUID();
      const eventId = randomUUID();
      await mkdir(RECEIPT_DIRECTORY, { recursive: true });
      const internalReceipt = await generatePaymentReceipt({
        paymentId,
        tenantId: input.tenantId,
        orderNumber: input.orderNumber,
        amount: input.amount,
        currency: input.currency,
        method: input.method,
        reference: input.reference,
        paidByUserId: input.userId,
        paidByUserName: input.userName,
        paidAt: input.paidAt,
      });
      const internalReceiptPath = path.join(RECEIPT_DIRECTORY, `${paymentId}.pdf`);
      await writeFile(internalReceiptPath, internalReceipt, { flag: 'wx', mode: 0o600 });
      writtenPaths.push(internalReceiptPath);
      const internalReceiptSha256 = createHash('sha256').update(internalReceipt).digest('hex');
      const externalReceiptPath = input.externalReceipt
        ? path.join(RECEIPT_DIRECTORY, `${paymentId}-evidence.${input.externalReceipt.extension}`)
        : null;
      if (externalReceiptPath && input.externalReceipt) {
        await writeFile(externalReceiptPath, input.externalReceipt.buffer, { flag: 'wx', mode: 0o600 });
        writtenPaths.push(externalReceiptPath);
      }

      const inserted = await client.query<Payment>(
        `INSERT INTO payments (
           id, tenant_id, order_id, idempotency_key, amount, currency,
           method, status, reference, internal_receipt_path, internal_receipt_mime_type,
           internal_receipt_sha256, external_receipt_path, external_receipt_mime_type,
           external_receipt_sha256, paid_by_user_id, paid_by_user_name, paid_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'COMPLETED', $8, $9, 'application/pdf',
                   $10, $11, $12, $13, $14, $15, $16)
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
          internalReceiptPath,
          internalReceiptSha256,
          externalReceiptPath,
          input.externalReceipt?.mimeType ?? null,
          input.externalReceipt?.sha256 ?? null,
          input.userId,
          input.userName ?? null,
          input.paidAt,
        ]
      );
      const payment = inserted.rows[0];
      const payload: PaymentCompletedPayload = {
        payment_id: payment.id,
        order_id: payment.order_id,
        amount: Number(payment.amount),
        currency: payment.currency.trim(),
        method: payment.method,
        reference: payment.reference,
        paid_by_user_id: payment.paid_by_user_id,
        paid_at: payment.paid_at ?? new Date().toISOString(),
      };
      await client.query(
        `INSERT INTO payment_event_outbox (
           event_id, tenant_id, aggregate_id, correlation_id, event_type, routing_key, payload
         ) VALUES ($1, $2, $3, $4, 'PaymentCompleted', 'payment.completed', $5)`,
        [eventId, input.tenantId, payment.id, input.orderId, JSON.stringify(payload)]
      );
      await client.query('COMMIT');
      return { payment, created: true };
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

  static async findForOrder(tenantId: string, orderId: string): Promise<Payment[]> {
    const { rows } = await pool.query<Payment>(
      `SELECT id, tenant_id, order_id, amount, currency, method, status,
              reference, paid_by_user_id, paid_at, created_at,
              internal_receipt_path, internal_receipt_mime_type,
              external_receipt_path, external_receipt_mime_type
       FROM payments
       WHERE tenant_id = $1 AND order_id = $2
       ORDER BY created_at DESC`,
      [tenantId, orderId]
    );
    return rows;
  }

  static async findForTenant(tenantId: string): Promise<Payment[]> {
    const { rows } = await pool.query<Payment>(
      `SELECT id, tenant_id, order_id, amount, currency, method, status,
              reference, paid_by_user_id, paid_at, created_at,
              internal_receipt_path, internal_receipt_mime_type,
              external_receipt_path, external_receipt_mime_type
       FROM payments
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId]
    );
    return rows;
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
