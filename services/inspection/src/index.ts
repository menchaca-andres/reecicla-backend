import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import inspectionRoutes from './routes/inspectionRoutes';
import { pool } from './config/db';
import { closeDeviceReceivedConsumer, startDeviceReceivedConsumer } from './messaging/eventConsumer';
import { closeEventPublisher, dispatchPendingInspectionEvents } from './messaging/eventPublisher';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3005;
const outboxTimer = setInterval(() => {
  dispatchPendingInspectionEvents().catch((error) =>
    console.error('[Inspection] No se pudieron publicar eventos pendientes:', error)
  );
}, 5000);

app.use(cors());
app.use(express.json());
app.get('/health', (_req, res) => res.json({ service: 'inspection-service', status: 'OK' }));
app.use('/api/inspections', inspectionRoutes);

const server = app.listen(PORT, async () => {
  console.log(`[Inspection Service] Running on port ${PORT}`);
  try {
    await pool.query('SELECT NOW()');
    await startDeviceReceivedConsumer();
    await dispatchPendingInspectionEvents();
  } catch (error) {
    console.error('[Inspection Service] No se pudo iniciar su conexión de datos/mensajería:', error);
  }
});

async function shutdown(): Promise<void> {
  clearInterval(outboxTimer);
  server.close();
  await closeDeviceReceivedConsumer();
  await closeEventPublisher();
  await pool.end();
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
