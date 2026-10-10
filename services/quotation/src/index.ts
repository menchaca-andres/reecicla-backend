import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import quotationRoutes from './routes/quotationRoutes';
import { pool } from './config/db';
import { dispatchPendingQuoteEvents } from './messaging/quoteOutbox';
import { subscribeEvent } from './messaging/eventBus';
import { QuotationService } from './services/quotationService';


dotenv.config();
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET debe estar configurado.');
if (!process.env.INTERNAL_SERVICE_TOKEN) throw new Error('INTERNAL_SERVICE_TOKEN debe estar configurado.');

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

const expiryTimer = setInterval(() => {
  QuotationService.expireOverdueQuotes()
    .then((expired) => {
      if (expired > 0) console.log(`[Quotation] Marcadas ${expired} cotizaciones como EXPIRED.`);
      return QuotationService.purgeStaleAnonymousQuotes();
    })
    .then((purged) => {
      if (purged > 0) console.log(`[Quotation] Purgadas ${purged} cotizaciones anónimas vencidas.`);
    })
    .catch((err) => console.error('[Quotation] Error al expirar/purgar cotizaciones:', err));
}, 60_000);
expiryTimer.unref();

app.listen(PORT, async () => {
  console.log(`[Quotation Service] Running on port ${PORT}`);
  try {
    const res = await pool.query('SELECT NOW()');
    console.log(`[Quotation Service] DB connected at: ${res.rows[0].now}`);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_quotes_open_valid_until
      ON quotes (valid_until)
      WHERE status IN ('PENDING', 'ANONYMOUS')
    `);
    dispatchPendingQuoteEvents().catch((err) => console.error('[Quotation] Error inicial al despachar outbox:', err));
    QuotationService.expireOverdueQuotes().catch((err) => console.error('[Quotation] Error inicial al expirar cotizaciones:', err));

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
