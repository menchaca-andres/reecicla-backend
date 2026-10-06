import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import quotationRoutes from './routes/quotationRoutes';
import { pool } from './config/db';
import { dispatchPendingQuoteEvents } from './messaging/quoteOutbox';
import { subscribeEvent } from './messaging/eventBus';


dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: 'quotation-service', status: 'OK' });
});

app.use('/api/quotation', quotationRoutes);

const outboxTimer = setInterval(() => {
  dispatchPendingQuoteEvents().catch((err) => console.error('[Quotation] Error al despachar outbox:', err));
}, 5000);
outboxTimer.unref();

app.listen(PORT, async () => {
  console.log(`[Quotation Service] Running on port ${PORT}`);
  try {
    const res = await pool.query('SELECT NOW()');
    console.log(`[Quotation Service] DB connected at: ${res.rows[0].now}`);
    dispatchPendingQuoteEvents().catch((err) => console.error('[Quotation] Error inicial al despachar outbox:', err));

    subscribeEvent<{ user_id: string; email: string }>('quotation.user.registered.queue', 'auth.user.registered', pool, async (event) => {
      console.log('[Quotation Service] Evento procesado exitosamente por primera vez:', {
        event_id: event.event_id,
        correlation_id: event.correlation_id,
        tenant_id: event.tenant_id,
        user_id: event.payload.user_id,
      });
    }).catch((err) => console.error('[Quotation Service] Error al suscribirse a RabbitMQ:', err));

  } catch (err) {
    console.error('[Quotation Service] DB connection failed:', err);
  }
});

