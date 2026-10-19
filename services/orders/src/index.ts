import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import orderRoutes from './routes/orderRoutes';
import { pool } from './config/db';
import { OrderModel } from './models/orderModel';
import {
  closeQuoteAcceptedConsumer,
  startInspectionCompletedConsumer,
  startPaymentCompletedConsumer,
  startQuoteAcceptedConsumer,
} from './messaging/eventConsumer';
import { closeEventPublisher, dispatchPendingOrderEvents } from './messaging/eventPublisher';

dotenv.config();
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET debe estar configurado.');

const app = express();
const PORT = process.env.PORT || 3004;
const outboxTimer = setInterval(() => {
  dispatchPendingOrderEvents().catch((error) =>
    console.error('[Orders] No se pudieron publicar eventos pendientes:', error)
  );
}, 5000);
const adjustmentDeadlineTimer = setInterval(() => {
  OrderModel.applyExpiredAdjustmentRejections()
    .then((count) => {
      if (count > 0) console.log(`[Orders] Aplicado reciclaje por vencimiento a ${count} ajuste(s) rechazado(s).`);
    })
    .catch((error) => console.error('[Orders] No se pudieron cerrar ajustes vencidos:', error));
}, 60_000);

app.use(cors());
app.use(express.json());
app.get('/health', (_req, res) => res.json({ service: 'orders-service', status: 'OK' }));
app.use('/api/orders', orderRoutes);

const server = app.listen(PORT, async () => {
  console.log(`[Orders Service] Running on port ${PORT}`);
  try {
    await pool.query('SELECT NOW()');
    await startQuoteAcceptedConsumer();
    await startInspectionCompletedConsumer();
    await startPaymentCompletedConsumer();
    await dispatchPendingOrderEvents();
  } catch (error) {
    console.error('[Orders Service] No se pudo iniciar su conexión de datos/mensajería:', error);
  }
});

async function shutdown(): Promise<void> {
  clearInterval(outboxTimer);
  clearInterval(adjustmentDeadlineTimer);
  server.close();
  await closeQuoteAcceptedConsumer();
  await closeEventPublisher();
  await pool.end();
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
