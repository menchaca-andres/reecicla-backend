import { pool } from '../config/db';
import { publishEvent } from './eventBus';

let dispatching = false;

export async function dispatchPendingQuoteEvents(): Promise<void> {
  if (dispatching) return;
  dispatching = true;

  try {
    const { rows } = await pool.query(
      `SELECT event_id, correlation_id, tenant_id, event_type, payload
       FROM quote_event_outbox
       WHERE published_at IS NULL
       ORDER BY created_at
       LIMIT 25`
    );

    for (const event of rows) {
      await publishEvent('quote.accepted', {
        event_id: event.event_id,
        correlation_id: event.correlation_id,
        event_type: event.event_type,
        tenant_id: event.tenant_id,
        payload: event.payload,
      });
      await pool.query(
        'UPDATE quote_event_outbox SET published_at = NOW() WHERE event_id = $1 AND published_at IS NULL',
        [event.event_id]
      );
    }
  } finally {
    dispatching = false;
  }
}