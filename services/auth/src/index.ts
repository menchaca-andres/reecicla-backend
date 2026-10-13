import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import { pool } from './config/db';

dotenv.config();
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET debe estar configurado.');
if (!process.env.INTERNAL_SERVICE_TOKEN) throw new Error('INTERNAL_SERVICE_TOKEN debe estar configurado.');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: 'auth-service', status: 'OK' });
});

app.use('/api/auth', authRoutes);

app.listen(PORT, async () => {
  console.log(`[Auth Service] Running on port ${PORT}`);
  try {
    const res = await pool.query('SELECT NOW()');
    console.log(`[Auth Service] DB connected at: ${res.rows[0].now}`);
  } catch (err) {
    console.error('[Auth Service] DB connection failed:', err);
  }
});
