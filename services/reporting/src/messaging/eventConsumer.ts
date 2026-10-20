import amqp, { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { InvalidReportingEventError, REPORTING_ROUTING_KEYS, toProjection, validateEnvelope } from '../domain/projections';
import { ReportModel } from '../models/reportModel';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://reecicla:reecicla_password@localhost:5672';
const EXCHANGE = 'reecicla.events';
export const REPORTING_QUEUE = 'reporting.events.queue';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

async function connect(): Promise<Channel> {
  if (channel) return channel;
  let retries = 10;
  while (retries > 0) {
    try {
      connection = await amqp.connect(RABBITMQ_URL);
      channel = await connection.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      // Cola durable: si Reporting se cae, los eventos esperan en el broker.
      await channel.assertQueue(REPORTING_QUEUE, { durable: true });
      for (const routingKey of REPORTING_ROUTING_KEYS) {
        await channel.bindQueue(REPORTING_QUEUE, EXCHANGE, routingKey);
      }
      await channel.prefetch(10);
      return channel;
    } catch (error) {
      retries--;
      if (retries === 0) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw new Error('No se pudo conectar a RabbitMQ.');
}

export async function startReportingConsumer(): Promise<void> {
  const activeChannel = await connect();
  await activeChannel.consume(REPORTING_QUEUE, async (message: ConsumeMessage | null) => {
    if (!message) return;
    const routingKey = message.fields.routingKey;
    let event;
    let projection;
    try {
      event = JSON.parse(message.content.toString());
      validateEnvelope(event);
      projection = toProjection(routingKey, event);
    } catch (error) {
      const reason = error instanceof InvalidReportingEventError || error instanceof SyntaxError
        ? error.message
        : error;
      console.error(`[Reporting] Evento inválido descartado [${routingKey}]:`, reason);
      activeChannel.ack(message);
      return;
    }

    try {
      await ReportModel.applyEvent(event, projection);
      activeChannel.ack(message);
    } catch (error) {
      console.error(`[Reporting] Error proyectando ${routingKey}; se reintentará:`, error);
      activeChannel.nack(message, false, true);
    }
  });
  console.log(`[Reporting] Escuchando ${REPORTING_QUEUE} para: ${REPORTING_ROUTING_KEYS.join(', ')}.`);
}

export async function closeReportingConsumer(): Promise<void> {
  await channel?.close();
  await connection?.close();
  channel = null;
  connection = null;
}
