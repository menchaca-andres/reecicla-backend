import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import catalogRoutes from './routes/catalogRoutes';
import { pool } from './config/db';
import { subscribeEvent } from './messaging/eventBus';
import { DeviceReceivedPayload } from './types/catalog';

dotenv.config();

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
    await subscribeEvent<DeviceReceivedPayload>(
      'catalog.device-received.queue',
      'device.received',
      pool,
      async (event, client) => {
        const { device_type_id, received_at } = event.payload;
        const receivedAt = new Date(received_at);
        if (!event.tenant_id || !device_type_id || Number.isNaN(receivedAt.getTime())) {
          throw new Error('Evento DeviceReceived con tenant, tipo o fecha inválidos.');
        }

        const result = await client.query(
          `UPDATE device_types
           SET last_received_at = GREATEST(COALESCE(last_received_at, $3::timestamptz), $3::timestamptz),
               updated_at = NOW()
           WHERE tenant_id = $1 AND id = $2
           RETURNING id`,
          [event.tenant_id, device_type_id, receivedAt]
        );
        if (result.rowCount === 0) {
          throw new Error('El tipo asociado al evento DeviceReceived no existe en el tenant.');
        }
      }
    );
  } catch (err) {
    console.error('[Catalog Service] DB o consumidor de eventos no pudo iniciar:', err);
  }
});
