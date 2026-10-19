import { AuthorizedOrder } from '../types/payment';

const ORDERS_SERVICE_URL = process.env.ORDERS_SERVICE_URL || 'http://orders-service:3004';

export async function authorizeOrder(
  orderId: string,
  tenantId: string,
  userId?: string,
  action: 'PAY' | 'READ' = 'PAY'
): Promise<AuthorizedOrder> {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) throw new Error('INTERNAL_SERVICE_TOKEN debe estar configurado.');
  let response: Response;
  try {
    response = await fetch(new URL('/api/orders/internal/payments/authorize', ORDERS_SERVICE_URL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-service-token': internalToken,
      },
      body: JSON.stringify({
        order_id: orderId,
        tenant_id: tenantId,
        action,
        ...(userId ? { user_id: userId } : {}),
      }),
    });
  } catch (error) {
    console.error('[Payment] No se pudo contactar Orders para validar la orden:', error);
    throw new Error('No se pudo validar la orden con el servicio de Orders.');
  }

  const result = await response.json().catch(() => ({})) as {
    order?: AuthorizedOrder;
    error?: string;
  };
  if (!response.ok || !result.order) {
    if (response.status >= 500) throw new Error('El servicio de Orders no está disponible.');
    throw new Error(result.error || 'La orden no está habilitada para pagos.');
  }
  return result.order;
}
