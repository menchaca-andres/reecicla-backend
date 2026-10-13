import amqp, { ChannelModel, ConfirmChannel, ConsumeMessage } from 'amqplib';
import { Pool } from 'pg';
import crypto from 'crypto';

export interface DomainEvent<T = any> {
  event_id: string;
  correlation_id: string;
  tenant_id: string;
  event_type: string;
  timestamp: string;
  payload: T;
}

export interface PublishOptions<T = any> {
  event_id?: string;
  event_type: string;
  tenant_id: string;
  correlation_id?: string;
  payload: T;
}

let connection: ChannelModel | null = null;
let activeChannel: ConfirmChannel | null = null;

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://reecicla:reecicla_password@rabbitmq:5672';
const MAIN_EXCHANGE = 'reecicla.events';

export async function getRabbitChannel(): Promise<ConfirmChannel> {
  if (activeChannel) return activeChannel;

  let retries = 5;
  while (retries > 0) {
    try {
      connection = await amqp.connect(RABBITMQ_URL);
      const ch = await connection.createConfirmChannel();
      await ch.assertExchange(MAIN_EXCHANGE, 'topic', { durable: true });
      activeChannel = ch;
      console.log('Conectado exitosamente a RabbitMQ (Broker TE-02)');
      return activeChannel;
    } catch (error) {
      retries--;
      console.warn(`Error al conectar a RabbitMQ. Reintentos restantes: ${retries}...`);
      if (retries === 0) throw error;
      await new Promise((res) => setTimeout(res, 3000));
    }
  }
  throw new Error('No se pudo establecer conexión con RabbitMQ');
}

export async function publishEvent<T>(routingKey: string, options: PublishOptions<T>): Promise<DomainEvent<T>> {
  const ch = await getRabbitChannel();

  const event: DomainEvent<T> = {
    event_id: options.event_id || crypto.randomUUID(),
    correlation_id: options.correlation_id || crypto.randomUUID(),
    tenant_id: options.tenant_id,
    event_type: options.event_type,
    timestamp: new Date().toISOString(),
    payload: options.payload,
  };

  await new Promise<void>((resolve, reject) => {
    ch.publish(MAIN_EXCHANGE, routingKey, Buffer.from(JSON.stringify(event)), {
      persistent: true,
      contentType: 'application/json',
    }, (error) => error ? reject(error) : resolve());
  });

  console.log(`Evento publicado [${routingKey}]:`, {
    event_id: event.event_id,
    correlation_id: event.correlation_id,
    tenant_id: event.tenant_id,
    event_type: event.event_type,
  });

  return event;
}

export async function subscribeEvent<T>(
  queueName: string,
  routingKey: string,
  dbPool: Pool,
  handler: (event: DomainEvent<T>) => Promise<void>
): Promise<void> {
  const ch = await getRabbitChannel();

  await ch.assertQueue(queueName, { durable: true });
  await ch.bindQueue(queueName, MAIN_EXCHANGE, routingKey);

  console.log(`Escuchando cola [${queueName}] para patrón [${routingKey}]...`);

  ch.consume(queueName, async (msg: ConsumeMessage | null) => {
    if (!msg) return;

    try {
      const event: DomainEvent<T> = JSON.parse(msg.content.toString());

      if (!event.event_id || !event.event_type) {
        console.error('Evento recibido con formato inválido, descartando...');
        ch.ack(msg);
        return;
      }
      const result = await dbPool.query(
        `INSERT INTO processed_events (event_id, event_type, tenant_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id;`,
        [event.event_id, event.event_type, event.tenant_id || null]
      );


      if (result.rowCount === 0) {
        console.log(`[Idempotencia TE-02] Evento duplicado detectado: ${event.event_id} (${event.event_type}). Ignorando sin duplicar efectos.`);
        ch.ack(msg);
        return;
      }

      await handler(event);
      ch.ack(msg);
    } catch (error) {
      console.error(`Error procesando evento en cola ${queueName}:`, error);
      ch.nack(msg, false, false);
    }
  });
}
