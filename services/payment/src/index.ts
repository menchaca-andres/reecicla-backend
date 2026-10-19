import express, { ErrorRequestHandler } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import paymentRoutes from './routes/paymentRoutes';
import { pool } from './config/db';
import { dispatchPendingPaymentEvents, closePaymentEventPublisher } from './messaging/eventPublisher';
import multer from 'multer';

dotenv.config();
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET debe estar configurado.');
if (!process.env.INTERNAL_SERVICE_TOKEN) throw new Error('INTERNAL_SERVICE_TOKEN debe estar configurado.');

const app = express();
const PORT = process.env.PORT || 3006;
const outboxTimer = setInterval(() => {
  dispatchPendingPaymentEvents().catch((error) =>
    console.error('[Payment] No se pudieron publicar eventos pendientes:', error)
  );
}, 5000);
outboxTimer.unref();

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.get('/health', (_req, res) => res.json({ service: 'payment-service', status: 'OK' }));
app.use('/api/payments', paymentRoutes);
const uploadErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({
      error: status === 413
        ? 'La evidencia bancaria opcional no puede superar 5 MB.'
        : error.message,
    });
    return;
  }
  if (
    error instanceof Error &&
    (error.message.includes('comprobante') || error.message.includes('evidencia bancaria'))
  ) {
    res.status(400).json({ error: error.message });
    return;
  }
  console.error('[Payment] Error inesperado en la solicitud:', error);
  res.status(500).json({ error: 'No se pudo completar la solicitud de pago.' });
};
app.use(uploadErrorHandler);

const server = app.listen(PORT, async () => {
  console.log(`[Payment Service] Running on port ${PORT}`);
  try {
    await pool.query('SELECT NOW()');
  } catch (error) {
    console.error('[Payment Service] No se pudo conectar a Payment DB:', error);
  }
});

async function shutdown(): Promise<void> {
  clearInterval(outboxTimer);
  server.close();
  await closePaymentEventPublisher();
  await pool.end();
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
