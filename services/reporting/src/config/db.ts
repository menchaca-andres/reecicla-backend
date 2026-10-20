import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgres://reecicla_user:reecicla_password@localhost:5438/reecicla_reporting_db';

export const pool = new Pool({ connectionString });

pool.on('error', (error) => {
  console.error('[Reporting DB] Unexpected PostgreSQL error:', error);
});
