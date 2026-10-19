import amqp, { ChannelModel, ConfirmChannel } from 'amqplib';
import { pool } from '../config/db';
import { DomainEvent } from '../types/payment';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://reecicla:reecicla_password@localhost:5672';
const EXCHANGE = 'reecicla.events';

let connection: ChannelModel | null = null;
let channel: ConfirmChannel | null = null;
let dispatching = false;

async function getChannel(): Promise<ConfirmChannel> {
  if (channel) return channel;
  let retries = 6;
  while (retries > 0) {
    try {
      connection = await amqp.connect(RABBITMQ_URL);
      channel = await connection.createConfirmChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      return channel;
    } catch (error) {
      retries--;
      if (retries === 0) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw new Error('No se pudo conectar a RabbitMQ.');
}

async function publish(event: DomainEvent<Record<string, unknown>>, routingKey: string): Promise<void> {
  const activeChannel = await getChannel();
  await new Promise<void>((resolve, reject) => {
    activeChannel.publish(
      EXCHANGE,
      routingKey,
      Buffer.from(JSON.stringify(event)),
      { persistent: true, contentType: 'application/json' },
      (error) => error ? reject(error) : resolve()
    );
  });
}

export async function dispatchPendingPaymentEvents(): Promise<void> {
  if (dispatching) return;
  dispatching = true;
  try {
    const { rows } = await pool.query(
      `SELECT event_id, tenant_id, aggregate_id, correlation_id, event_type,
              routing_key, payload, created_at
       FROM payment_event_outbox
       WHERE published_at IS NULL
       ORDER BY created_at
       LIMIT 25`
    );
    for (const row of rows) {
      const event: DomainEvent<Record<string, unknown>> = {
        event_id: row.event_id,
        correlation_id: row.correlation_id,
        tenant_id: row.tenant_id,
        event_type: row.event_type,
        timestamp: row.created_at.toISOString(),
        payload: row.payload,
      };
      await publish(event, row.routing_key);
      await pool.query(
        'UPDATE payment_event_outbox SET published_at = NOW() WHERE event_id = $1 AND published_at IS NULL',
        [row.event_id]
      );
    }
  } finally {
    dispatching = false;
  }
}

export async function closePaymentEventPublisher(): Promise<void> {
  await channel?.close();
  await connection?.close();
  channel = null;
  connection = null;
}
