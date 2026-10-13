import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgres://reecicla_user:reecicla_password@localhost:5434/reecicla_catalog_db',
});
