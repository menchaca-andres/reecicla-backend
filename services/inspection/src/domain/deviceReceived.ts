import { DeviceReceivedPayload, DomainEvent } from '../types/inspection';
import { UUID_PATTERN } from './errors';

export function validateDeviceReceivedEvent(event: DomainEvent<DeviceReceivedPayload>): void {
  const payload = event.payload;
  const ids = [event.event_id, event.correlation_id, event.tenant_id, payload?.order_id, payload?.device_type_id];
  if (event.event_type !== 'DeviceReceived' || ids.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))) {
    throw new Error('Evento DeviceReceived inválido.');
  }
  if (
    (payload.quote_id != null && !UUID_PATTERN.test(payload.quote_id)) ||
    typeof payload.device_type_name !== 'string' || !payload.device_type_name.trim() ||
    typeof payload.received_at !== 'string' || Number.isNaN(new Date(payload.received_at).getTime()) ||
    (payload.received_by_user_id != null && !UUID_PATTERN.test(String(payload.received_by_user_id)))
  ) {
    throw new Error('El payload de DeviceReceived está incompleto o contiene valores inválidos.');
  }
}
