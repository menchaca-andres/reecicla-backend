import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { pool } from '../config/db';
import { RegisterDTO, User } from '../types/auth';

const CODE_TTL_MINUTES = 10;
const SEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export class ClientRegistrationModel {
  static async create(
    dto: RegisterDTO,
    passwordHash: string,
    code: string
  ): Promise<void> {
    const email = dto.email.trim().toLowerCase();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
        [dto.tenant_id, email]
      );
      await client.query(
        `DELETE FROM client_email_registrations
         WHERE expires_at < NOW() - INTERVAL '1 day'
            OR consumed_at < NOW() - INTERVAL '30 days'`
      );
      const recent = await client.query(
        `SELECT 1 FROM client_email_registrations
         WHERE tenant_id = $1 AND email = $2
           AND last_sent_at > NOW() - ($3::int * INTERVAL '1 second')
         LIMIT 1`,
        [dto.tenant_id, email, SEND_COOLDOWN_SECONDS]
      );
      if (recent.rowCount) {
        throw new Error('Espera un minuto antes de solicitar otro código.');
      }

      await client.query(
        `INSERT INTO client_email_registrations (
           tenant_id, email, password_hash, name, phone, code_hash, expires_at,
           attempts, last_sent_at, consumed_at
         ) VALUES ($1, $2, $3, $4, $5, $6,
                   NOW() + ($7::int * INTERVAL '1 minute'), 0, NOW(), NULL)
         ON CONFLICT (tenant_id, email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             name = EXCLUDED.name,
             phone = EXCLUDED.phone,
             code_hash = EXCLUDED.code_hash,
             expires_at = EXCLUDED.expires_at,
             attempts = 0,
             last_sent_at = NOW(),
             consumed_at = NULL`,
        [
          dto.tenant_id,
          email,
          passwordHash,
          dto.name?.trim() ?? '',
          dto.phone?.trim() || null,
          hashCode(code),
          CODE_TTL_MINUTES,
        ]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  static async deletePending(tenantId: string, email: string): Promise<void> {
    await pool.query(
      `DELETE FROM client_email_registrations
       WHERE tenant_id = $1 AND email = lower($2) AND consumed_at IS NULL`,
      [tenantId, email.trim()]
    );
  }

  static async verifyAndCreateUser(
    tenantId: string,
    email: string,
    code: string
  ): Promise<User | null> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT tenant_id, email, password_hash, name, phone, code_hash, expires_at,
                attempts, consumed_at
         FROM client_email_registrations
         WHERE tenant_id = $1 AND email = lower($2)
         FOR UPDATE`,
        [tenantId, email.trim()]
      );
      const registration = result.rows[0];
      if (
        !registration ||
        registration.consumed_at ||
        new Date(registration.expires_at).getTime() <= Date.now() ||
        Number(registration.attempts) >= MAX_ATTEMPTS
      ) {
        await client.query('COMMIT');
        return null;
      }

      const expected = Buffer.from(registration.code_hash, 'hex');
      const actual = Buffer.from(hashCode(code), 'hex');
      if (!timingSafeEqual(expected, actual)) {
        await client.query(
          `UPDATE client_email_registrations
           SET attempts = attempts + 1
           WHERE tenant_id = $1 AND email = lower($2)`,
          [tenantId, email.trim()]
        );
        await client.query('COMMIT');
        return null;
      }

      const user = await client.query<User>(
        `INSERT INTO users (tenant_id, email, password_hash, name, phone, role)
         VALUES ($1, $2, $3, $4, $5, 'CLIENT')
         RETURNING id, tenant_id, email, password_hash, name, phone, role, is_active, created_at, updated_at`,
        [
          registration.tenant_id,
          registration.email,
          registration.password_hash,
          registration.name,
          registration.phone,
        ]
      );
      await client.query(
        `UPDATE client_email_registrations
         SET consumed_at = NOW()
         WHERE tenant_id = $1 AND email = lower($2)`,
        [tenantId, email.trim()]
      );
      await client.query('COMMIT');
      return user.rows[0];
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
