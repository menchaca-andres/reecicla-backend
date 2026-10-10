import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import catalogRoutes from './routes/catalogRoutes';
import { pool } from './config/db';

dotenv.config();
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET debe estar configurado.');

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: 'catalog-service', status: 'OK' });
});

app.use('/api/catalog', catalogRoutes);

app.listen(PORT, async () => {
  console.log(`[Catalog Service] Running on port ${PORT}`);
  try {
    const res = await pool.query('SELECT NOW()');
    console.log(`[Catalog Service] DB connected at: ${res.rows[0].now}`);
  } catch (err) {
    console.error('[Catalog Service] DB connection failed:', err);
  }
});
