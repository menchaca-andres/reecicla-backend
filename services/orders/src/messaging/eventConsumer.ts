import amqp, { ChannelModel, Channel, ConsumeMessage } from 'amqplib';
import { OrderModel } from '../models/orderModel';
import { DomainEvent, QuoteAcceptedPayload } from '../types/orders';
import { validateQuoteAcceptedEvent } from '../domain/quoteAccepted';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://reecicla:reecicla_password@localhost:5672';
const EXCHANGE = 'reecicla.events';
const QUEUE = 'orders.quote-accepted.queue';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

async function connect(): Promise<Channel> {
  if (channel) return channel;
  let retries = 6;
  while (retries > 0) {
    try {
      connection = await amqp.connect(RABBITMQ_URL);
      channel = await connection.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      await channel.assertQueue(QUEUE, { durable: true });
      await channel.bindQueue(QUEUE, EXCHANGE, 'quote.accepted');
      await channel.prefetch(1);
      return channel;
    } catch (error) {
      retries--;
      if (retries === 0) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw new Error('No se pudo conectar a RabbitMQ.');
}

export async function startQuoteAcceptedConsumer(): Promise<void> {
  const activeChannel = await connect();
  await activeChannel.consume(QUEUE, async (message: ConsumeMessage | null) => {
    if (!message) return;
    try {
      const event = JSON.parse(message.content.toString()) as DomainEvent<QuoteAcceptedPayload>;
      if (!event.event_id || !event.correlation_id || !event.tenant_id || !event.payload) {
        console.error('[Orders] Evento inválido descartado.');
        activeChannel.ack(message);
        return;
      }
      try {
        validateQuoteAcceptedEvent(event);
      } catch (validationError) {
        console.error('[Orders] Evento QuoteAccepted inválido descartado:', validationError);
        activeChannel.ack(message);
        return;
      }
      await OrderModel.createFromAcceptedQuote(event);
      activeChannel.ack(message);
    } catch (error) {
      console.error('[Orders] Error procesando QuoteAccepted; se reintentará:', error);
      activeChannel.nack(message, false, true);
    }
  });
  console.log(`[Orders] Escuchando ${QUEUE} para quote.accepted.`);
}

export async function closeQuoteAcceptedConsumer(): Promise<void> {
  await channel?.close();
  await connection?.close();
  channel = null;
  connection = null;
}