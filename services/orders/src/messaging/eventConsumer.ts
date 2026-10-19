import amqp, { ChannelModel, Channel, ConsumeMessage } from 'amqplib';
import { OrderModel } from '../models/orderModel';
import {
  AdjustedQuoteEventPayload,
  DomainEvent,
  InspectionCompletedPayload,
  QuoteAcceptedPayload,
} from '../types/orders';
import { validateInspectionCompletedEvent } from '../domain/inspectionCompleted';
import { validateQuoteAcceptedEvent } from '../domain/quoteAccepted';
import { validateAdjustedQuoteEvent } from '../domain/adjustedQuoteEvent';
import { validatePaymentCompletedEvent } from '../domain/paymentCompletedEvent';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://reecicla:reecicla_password@localhost:5672';
const EXCHANGE = 'reecicla.events';
const QUEUE = 'orders.quote-accepted.queue';
const INSPECTION_COMPLETED_QUEUE = 'orders.inspection-completed.queue';
const PAYMENT_COMPLETED_QUEUE = 'orders.payment-completed.queue';

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
      await channel.bindQueue(QUEUE, EXCHANGE, 'quote.adjusted.created');
      await channel.bindQueue(QUEUE, EXCHANGE, 'quote.adjusted.accepted');
      await channel.bindQueue(QUEUE, EXCHANGE, 'quote.adjusted.rejected');
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
      const event = JSON.parse(message.content.toString()) as DomainEvent<unknown>;
      if (!event.event_id || !event.correlation_id || !event.tenant_id || !event.payload) {
        console.error('[Orders] Evento inválido descartado.');
        activeChannel.ack(message);
        return;
      }
      if (typeof event.event_type === 'string' && event.event_type.startsWith('AdjustedQuote')) {
        const adjustedEvent: DomainEvent<AdjustedQuoteEventPayload> = {
          ...event,
          payload: event.payload as AdjustedQuoteEventPayload,
        };
        try {
          validateAdjustedQuoteEvent(adjustedEvent);
        } catch (validationError) {
          console.error('[Orders] Evento de cotización ajustada inválido descartado:', validationError);
          activeChannel.ack(message);
          return;
        }
        try {
          await OrderModel.processAdjustedQuoteEvent(adjustedEvent);
          activeChannel.ack(message);
        } catch (error) {
          console.error('[Orders] Error procesando evento de cotización ajustada; se reintentará:', error);
          activeChannel.nack(message, false, true);
        }
        return;
      }
      try {
        validateQuoteAcceptedEvent({
          ...event,
          payload: event.payload as QuoteAcceptedPayload,
        });
      } catch (validationError) {
        console.error('[Orders] Evento QuoteAccepted inválido descartado:', validationError);
        activeChannel.ack(message);
        return;
      }
      await OrderModel.createFromAcceptedQuote({
        ...event,
        payload: event.payload as QuoteAcceptedPayload,
      });
      activeChannel.ack(message);
    } catch (error) {
      console.error('[Orders] Error procesando QuoteAccepted; se reintentará:', error);
      activeChannel.nack(message, false, true);
    }
  });
  console.log(`[Orders] Escuchando ${QUEUE} para quote.accepted.`);
}

export async function startInspectionCompletedConsumer(): Promise<void> {
  const activeChannel = await connect();
  await activeChannel.assertQueue(INSPECTION_COMPLETED_QUEUE, { durable: true });
  await activeChannel.bindQueue(INSPECTION_COMPLETED_QUEUE, EXCHANGE, 'inspection.completed');
  await activeChannel.consume(INSPECTION_COMPLETED_QUEUE, async (message: ConsumeMessage | null) => {
    if (!message) return;
    let event: DomainEvent<InspectionCompletedPayload>;
    try {
      event = JSON.parse(message.content.toString()) as DomainEvent<InspectionCompletedPayload>;
    } catch (parseError) {
      console.error('[Orders] Mensaje InspectionCompleted con JSON inválido descartado:', parseError);
      activeChannel.ack(message);
      return;
    }
    try {
      validateInspectionCompletedEvent(event);
    } catch (validationError) {
      console.error('[Orders] Evento InspectionCompleted inválido descartado:', validationError);
      activeChannel.ack(message);
      return;
    }
    try {
      await OrderModel.completeFromInspectionEvent(event);
      activeChannel.ack(message);
    } catch (error) {
      console.error('[Orders] Error procesando InspectionCompleted; se reintentará:', error);
      activeChannel.nack(message, false, true);
    }
  });
  console.log(`[Orders] Escuchando ${INSPECTION_COMPLETED_QUEUE} para inspection.completed.`);
}

export async function startPaymentCompletedConsumer(): Promise<void> {
  const activeChannel = await connect();
  await activeChannel.assertQueue(PAYMENT_COMPLETED_QUEUE, { durable: true });
  await activeChannel.bindQueue(PAYMENT_COMPLETED_QUEUE, EXCHANGE, 'payment.completed');
  await activeChannel.consume(PAYMENT_COMPLETED_QUEUE, async (message: ConsumeMessage | null) => {
    if (!message) return;
    let event: unknown;
    try {
      event = JSON.parse(message.content.toString()) as unknown;
    } catch (error) {
      console.error('[Orders] Mensaje PaymentCompleted con JSON inválido descartado:', error);
      activeChannel.ack(message);
      return;
    }
    try {
      validatePaymentCompletedEvent(event);
      await OrderModel.processPaymentCompletedEvent(event);
      activeChannel.ack(message);
    } catch (error) {
      console.error('[Orders] Error procesando PaymentCompleted; se reintentará:', error);
      activeChannel.nack(message, false, true);
    }
  });
  console.log(`[Orders] Escuchando ${PAYMENT_COMPLETED_QUEUE} para payment.completed.`);
}

export async function closeQuoteAcceptedConsumer(): Promise<void> {
  await channel?.close();
  await connection?.close();
  channel = null;
  connection = null;
}