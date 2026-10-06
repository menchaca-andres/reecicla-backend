import { pool } from '../config/db';
import { BoxRequest, CreateBoxRequestInput } from '../types/orders';

export class BoxRequestModel {
  static async create(
    tenantId: string,
    orderId: string,
    userId: string,
    address: CreateBoxRequestInput
  ): Promise<BoxRequest> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Verify the order exists, belongs to this user/tenant, and is in ACCEPTED status
      const orderRes = await client.query(
        `SELECT id, status FROM orders
         WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
        [orderId, tenantId, userId]
      );

      if (orderRes.rowCount === 0) {
        throw new Error('Orden no encontrada o no pertenece al usuario.');
      }

      const order = orderRes.rows[0];
      const allowedStatuses = ['ACCEPTED', 'BOX_REQUESTED'];
      if (!allowedStatuses.includes(order.status)) {
        throw new Error(
          `No se puede solicitar una caja para una orden en estado "${order.status}". ` +
          `Solo se permite en estado ACCEPTED o BOX_REQUESTED.`
        );
      }

      // 2. Create the box request
      const boxRes = await client.query(
        `INSERT INTO box_requests (tenant_id, order_id, status)
         VALUES ($1, $2, 'REQUESTED')
         RETURNING *`,
        [tenantId, orderId]
      );
      const boxRequest: BoxRequest = boxRes.rows[0];

      // 3. Transition the order to BOX_REQUESTED (only if it was ACCEPTED)
      if (order.status === 'ACCEPTED') {
        await client.query(
          `UPDATE orders
           SET status = 'BOX_REQUESTED', pickup_address = $1, updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(address), orderId]
        );

        await client.query(
          `INSERT INTO order_status_history (tenant_id, order_id, previous_status, new_status, changed_by_user, reason)
           VALUES ($1, $2, 'ACCEPTED', 'BOX_REQUESTED', $3, 'Cliente solicitó caja de envío')`,
          [tenantId, orderId, userId]
        );
      }

      await client.query('COMMIT');
      return boxRequest;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async listForOrder(orderId: string, tenantId: string): Promise<BoxRequest[]> {
    const { rows } = await pool.query(
      `SELECT * FROM box_requests
       WHERE order_id = $1 AND tenant_id = $2
       ORDER BY requested_at DESC`,
      [orderId, tenantId]
    );
    return rows;
  }
}
