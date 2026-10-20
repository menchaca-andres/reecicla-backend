import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import catalogRoutes from './routes/catalogRoutes';
import { pool } from './config/db';
import { subscribeEvent } from './messaging/eventBus';
import { DeviceReceivedPayload } from './types/catalog';
import { DeviceTypeModel } from './models/deviceTypeModel';

dotenv.config();
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET debe estar configurado.');

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: 'catalog-service', status: 'OK' });
});
app.use('/api/catalog', catalogRoutes);

async function runScheduledInactivityJob(): Promise<void> {
  try {
    const tenantsRes = await pool.query<{ tenant_id: string }>(
      `SELECT DISTINCT tenant_id FROM device_types WHERE status = 'ACTIVE'`
    );
    for (const row of tenantsRes.rows) {
      try {
        console.log(`[Catalog Job] Evaluando inactividad de 12 meses (HU-023) para tenant ${row.tenant_id}...`);
        const result = await DeviceTypeModel.executeInactivityDeactivation(
          row.tenant_id,
          'SYSTEM_SCHEDULED_JOB',
          12
        );
        if (result.total_deactivated > 0) {
          console.log(`[Catalog Job] Tenant ${row.tenant_id}: ${result.total_deactivated} tipo(s) desactivado(s) automáticamente.`);
        }
      } catch (tenantErr) {
        console.error(`[Catalog Job] Error en mantenimiento para tenant ${row.tenant_id}:`, tenantErr);
      }
    }
  } catch (error) {
    console.error('[Catalog Job] Error al consultar tenants para job programado:', error);
  }
}

const JOB_INTERVAL_MS = Number(process.env.INACTIVITY_JOB_INTERVAL_MS || 24 * 60 * 60 * 1000);
const inactivityJobTimer = setInterval(() => {
  runScheduledInactivityJob().catch((err) =>
    console.error('[Catalog Job] Error ejecutando tarea programada de inactividad:', err)
  );
}, JOB_INTERVAL_MS);
inactivityJobTimer.unref();

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

    // Ejecución inicial diferida del job (espera a que otros servicios y RabbitMQ se estabilicen)
    setTimeout(() => {
      runScheduledInactivityJob().catch((err) =>
        console.error('[Catalog Job] Error en ejecución inicial diferida de mantenimiento:', err)
      );
    }, 12000);
  } catch (err) {
    console.error('[Catalog Service] DB o consumidor de eventos no pudo iniciar:', err);
  }
});
