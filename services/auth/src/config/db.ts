import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgres://reecicla_user:reecicla_password@localhost:5431/reecicla_auth_db';

export const pool = new Pool({
  connectionString,
});

pool.on('connect', () => {
  console.log('[Auth DB] Connected to PostgreSQL');
});

pool.on('error', (err) => {
  console.error('[Auth DB] Unexpected connection error', err);
});
