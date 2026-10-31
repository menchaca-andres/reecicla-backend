import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import reportRoutes from './routes/reportRoutes';
import { pool } from './config/db';
import { closeReportingConsumer, startReportingConsumer } from './messaging/eventConsumer';

dotenv.config();
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET debe estar configurado.');

const app = express();
const PORT = process.env.PORT || 3007;
let consumerReady = false;

app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.get('/health', (_req, res) => {
  res.status(consumerReady ? 200 : 503).json({
    service: 'reporting-service',
    status: consumerReady ? 'OK' : 'STARTING',
  });
});
app.use('/api/reports', reportRoutes);

const server = app.listen(PORT, async () => {
  console.log(`[Reporting Service] Running on port ${PORT}`);
  try {
    const { rows } = await pool.query('SELECT NOW()');
    console.log(`[Reporting Service] DB connected at: ${rows[0].now}`);
    await startReportingConsumer();
    consumerReady = true;
  } catch (error) {
    console.error('[Reporting Service] No se pudo iniciar la base o el consumidor de eventos:', error);
    process.exit(1);
  }
});

async function shutdown(): Promise<void> {
  server.close();
  await closeReportingConsumer().catch(() => undefined);
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
