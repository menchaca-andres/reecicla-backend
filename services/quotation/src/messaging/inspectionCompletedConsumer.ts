import { ConsumeMessage } from 'amqplib';
import { getRabbitChannel } from './eventBus';
import { QuoteModel } from '../models/quoteModel';
import { DomainEvent, InspectionCompletedPayload } from '../types/quotation';
import { validateInspectionCompletedEvent } from '../domain/inspectionCompleted';

const QUEUE = 'quotation.inspection-completed.queue';
const ROUTING_KEY = 'inspection.completed';
const EXCHANGE = 'reecicla.events';

export async function startInspectionCompletedConsumer(): Promise<void> {
  const channel = await getRabbitChannel();
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  await channel.assertQueue(QUEUE, { durable: true });
  await channel.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);
  await channel.prefetch(1);

  await channel.consume(QUEUE, async (message: ConsumeMessage | null) => {
    if (!message) return;

    let event: DomainEvent<InspectionCompletedPayload>;
    try {
      event = JSON.parse(message.content.toString()) as DomainEvent<InspectionCompletedPayload>;
    } catch (error) {
      console.error('[Quotation] Mensaje InspectionCompleted con JSON inválido descartado:', error);
      channel.ack(message);
      return;
    }

    try {
      validateInspectionCompletedEvent(event);
    } catch (error) {
      console.error('[Quotation] Evento InspectionCompleted inválido descartado:', error);
      channel.ack(message);
      return;
    }

    try {
      await QuoteModel.applyInspectionCompleted(event);
      channel.ack(message);
    } catch (error) {
      console.error('[Quotation] Error procesando InspectionCompleted; se reintentará:', error);
      channel.nack(message, false, true);
    }
  });
  console.log(`[Quotation] Escuchando ${QUEUE} para ${ROUTING_KEY}.`);
}
