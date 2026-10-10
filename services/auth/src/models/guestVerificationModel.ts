import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { pool } from '../config/db';

export interface GuestVerificationDetails {
  tenant_id: string;
  quote_id: string;
  email: string;
  name: string;
  phone: string;
}

const CODE_TTL_MINUTES = 10;
const SEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export class GuestVerificationModel {
  static async create(
    details: GuestVerificationDetails,
    code: string
  ): Promise<{ id: string }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
        [details.tenant_id, details.email.toLowerCase()]
      );
      await client.query(
        `DELETE FROM guest_email_verifications
         WHERE expires_at < NOW() - INTERVAL '1 day'
            OR consumed_at < NOW() - INTERVAL '30 days'`
      );
      const recent = await client.query(
        `SELECT 1 FROM guest_email_verifications
         WHERE tenant_id = $1 AND lower(email) = lower($2)
           AND last_sent_at > NOW() - ($3::int * INTERVAL '1 second')
         LIMIT 1`,
        [details.tenant_id, details.email, SEND_COOLDOWN_SECONDS]
      );
      if (recent.rowCount) {
        await client.query('ROLLBACK');
        throw new Error('Espera un minuto antes de solicitar otro código.');
      }

      const id = randomUUID();
      await client.query(
        `INSERT INTO guest_email_verifications (
           id, tenant_id, quote_id, email, name, phone, code_hash, expires_at,
           attempts, last_sent_at, verified_at, consumed_at
         ) VALUES ($1, $2, $3, lower($4), $5, $6, $7,
                   NOW() + ($8::int * INTERVAL '1 minute'), 0, NOW(), NULL, NULL)
         ON CONFLICT (tenant_id, quote_id) DO UPDATE
         SET id = EXCLUDED.id,
             email = EXCLUDED.email,
             name = EXCLUDED.name,
             phone = EXCLUDED.phone,
             code_hash = EXCLUDED.code_hash,
             expires_at = EXCLUDED.expires_at,
             attempts = 0,
             last_sent_at = NOW(),
             verified_at = NULL,
             consumed_at = NULL`,
        [
          id,
          details.tenant_id,
          details.quote_id,
          details.email,
          details.name,
          details.phone,
          hashCode(code),
          CODE_TTL_MINUTES,
        ]
      );
      await client.query('COMMIT');
      return { id };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  static async delete(id: string): Promise<void> {
    await pool.query(
      'DELETE FROM guest_email_verifications WHERE id = $1 AND consumed_at IS NULL',
      [id]
    );
  }

  static async consume(
    tenantId: string,
    quoteId: string,
    email: string,
    code: string
  ): Promise<GuestVerificationDetails | null> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT tenant_id, quote_id, email, name, phone, code_hash, expires_at,
                attempts, consumed_at
         FROM guest_email_verifications
         WHERE tenant_id = $1 AND quote_id = $2 AND lower(email) = lower($3)
         FOR UPDATE`,
        [tenantId, quoteId, email]
      );
      const verification = result.rows[0];
      if (
        !verification ||
        verification.consumed_at ||
        new Date(verification.expires_at).getTime() <= Date.now() ||
        Number(verification.attempts) >= MAX_ATTEMPTS
      ) {
        await client.query('COMMIT');
        return null;
      }

      const expected = Buffer.from(verification.code_hash, 'hex');
      const actual = Buffer.from(hashCode(code), 'hex');
      if (!timingSafeEqual(expected, actual)) {
        await client.query(
          `UPDATE guest_email_verifications
           SET attempts = attempts + 1
           WHERE tenant_id = $1 AND quote_id = $2`,
          [tenantId, quoteId]
        );
        await client.query('COMMIT');
        return null;
      }

      await client.query(
        `UPDATE guest_email_verifications
         SET verified_at = NOW(), consumed_at = NOW()
         WHERE tenant_id = $1 AND quote_id = $2`,
        [tenantId, quoteId]
      );
      await client.query('COMMIT');
      return {
        tenant_id: verification.tenant_id,
        quote_id: verification.quote_id,
        email: verification.email,
        name: verification.name,
        phone: verification.phone,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
