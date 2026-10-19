import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgres://reecicla_user:reecicla_password@localhost:5437/reecicla_payment_db';

export const pool = new Pool({ connectionString });

pool.on('error', (error) => {
  console.error('[Payment DB] Unexpected PostgreSQL error:', error);
});
