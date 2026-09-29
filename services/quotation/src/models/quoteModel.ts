import { pool } from '../config/db';
import { Quote, CreateQuoteDTO } from '../types/quotation';

export class QuoteModel {
  static async createQuote(
    dto: CreateQuoteDTO,
    basePrice: number,
    adjustment: number,
    finalPrice: number
  ): Promise<Quote> {
    const query = `
      INSERT INTO quotes (
        tenant_id, user_id, device_type, brand, model, year, condition,
        base_price, adjustment, final_price, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING')
      RETURNING *;
    `;
    const values = [
      dto.tenant_id,
      dto.user_id,
      dto.device_type,
      dto.brand || null,
      dto.model || null,
      dto.year || null,
      dto.condition,
      basePrice,
      adjustment,
      finalPrice,
    ];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  static async findById(id: string): Promise<Quote | null> {
    const query = `SELECT * FROM quotes WHERE id = $1;`;
    const { rows } = await pool.query(query, [id]);
    return rows[0] || null;
  }

  static async findByUserId(tenantId: string, userId: string): Promise<Quote[]> {
    const query = `
      SELECT * FROM quotes
      WHERE tenant_id = $1 AND user_id = $2
      ORDER BY created_at DESC;
    `;
    const { rows } = await pool.query(query, [tenantId, userId]);
    return rows;
  }
}
