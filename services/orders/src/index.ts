import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import orderRoutes from './routes/orderRoutes';
import { pool } from './config/db';
import { closeQuoteAcceptedConsumer, startQuoteAcceptedConsumer } from './messaging/eventConsumer';
import { closeEventPublisher, dispatchPendingOrderEvents } from './messaging/eventPublisher';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3004;
const outboxTimer = setInterval(() => {
  dispatchPendingOrderEvents().catch((error) =>
    console.error('[Orders] No se pudieron publicar eventos pendientes:', error)
  );
}, 5000);

app.use(cors());
app.use(express.json());
app.get('/health', (_req, res) => res.json({ service: 'orders-service', status: 'OK' }));
app.use('/api/orders', orderRoutes);

const server = app.listen(PORT, async () => {
  console.log(`[Orders Service] Running on port ${PORT}`);
  try {
    await pool.query('SELECT NOW()');
    await startQuoteAcceptedConsumer();
    await dispatchPendingOrderEvents();
  } catch (error) {
    console.error('[Orders Service] No se pudo iniciar su conexión de datos/mensajería:', error);
  }
});

async function shutdown(): Promise<void> {
  clearInterval(outboxTimer);
  server.close();
  await closeQuoteAcceptedConsumer();
  await closeEventPublisher();
  await pool.end();
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
