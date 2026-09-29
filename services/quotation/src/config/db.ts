import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgres://reecicla_user:reecicla_password@localhost:5435/reecicla_quotation_db';

export const pool = new Pool({
  connectionString,
});

pool.on('connect', () => {
  console.log('[Quotation DB] Connected to PostgreSQL');
});

pool.on('error', (err) => {
  console.error('[Quotation DB] Unexpected connection error', err);
});
