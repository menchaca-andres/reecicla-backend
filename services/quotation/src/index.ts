import express from 'express';
import dotenv from 'dotenv';
import quotationRoutes from './routes/quotationRoutes';
import { pool } from './config/db';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

// Healthcheck
app.get('/health', (_req, res) => {
  res.json({ service: 'quotation-service', status: 'OK' });
});

// Quotation Routes (HU-004, HU-005)
app.use('/api/quotation', quotationRoutes);

app.listen(PORT, async () => {
  console.log(`[Quotation Service] Running on port ${PORT}`);
  try {
    const res = await pool.query('SELECT NOW()');
    console.log(`[Quotation Service] DB connected at: ${res.rows[0].now}`);
  } catch (err) {
    console.error('[Quotation Service] DB connection failed:', err);
  }
});
