import amqp, { ChannelModel, Channel, ConsumeMessage } from 'amqplib';
import { ReceivedDeviceModel } from '../models/receivedDeviceModel';
import { DeviceReceivedPayload, DomainEvent } from '../types/inspection';
import { validateDeviceReceivedEvent } from '../domain/deviceReceived';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://reecicla:reecicla_password@localhost:5672';
const EXCHANGE = 'reecicla.events';
const QUEUE = 'inspection.device-received.queue';

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
      await channel.bindQueue(QUEUE, EXCHANGE, 'device.received');
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

export async function startDeviceReceivedConsumer(): Promise<void> {
  const activeChannel = await connect();
  await activeChannel.consume(QUEUE, async (message: ConsumeMessage | null) => {
    if (!message) return;
    try {
      const event = JSON.parse(message.content.toString()) as DomainEvent<DeviceReceivedPayload>;
      try {
        validateDeviceReceivedEvent(event);
      } catch (validationError) {
        console.error('[Inspection] Evento DeviceReceived inválido descartado:', validationError);
        activeChannel.ack(message);
        return;
      }
      await ReceivedDeviceModel.registerFromEvent(event);
      activeChannel.ack(message);
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.error('[Inspection] Mensaje con JSON inválido descartado.');
        activeChannel.ack(message);
        return;
      }
      console.error('[Inspection] Error procesando DeviceReceived; se reintentará:', error);
      activeChannel.nack(message, false, true);
    }
  });
  console.log(`[Inspection] Escuchando ${QUEUE} para device.received.`);
}

export async function closeDeviceReceivedConsumer(): Promise<void> {
  await channel?.close();
  await connection?.close();
  channel = null;
  connection = null;
}
