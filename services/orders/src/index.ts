import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import orderRoutes from './routes/orderRoutes';
import { pool } from './config/db';
import { closeQuoteAcceptedConsumer, startQuoteAcceptedConsumer } from './messaging/eventConsumer';

dotenv.config();
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET debe estar configurado.');

const app = express();
const PORT = process.env.PORT || 3004;

app.use(cors());
app.use(express.json());
app.get('/health', (_req, res) => res.json({ service: 'orders-service', status: 'OK' }));
app.use('/api/orders', orderRoutes);

const server = app.listen(PORT, async () => {
  console.log(`[Orders Service] Running on port ${PORT}`);
  try {
    await pool.query('SELECT NOW()');
    await startQuoteAcceptedConsumer();
  } catch (error) {
    console.error('[Orders Service] No se pudo iniciar su conexión de datos/mensajería:', error);
  }
});

async function shutdown(): Promise<void> {
  server.close();
  await closeQuoteAcceptedConsumer();
  await pool.end();
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());