import { pool } from '../config/db';
import { PricingRule, DefinePricingRuleDTO } from '../types/quotation';

export class PricingRuleModel {
  static async upsertRule(dto: DefinePricingRuleDTO): Promise<PricingRule> {
    const query = `
      INSERT INTO pricing_rules (tenant_id, device_type, rule_key, rule_value)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (tenant_id, device_type, rule_key)
      DO UPDATE SET rule_value = EXCLUDED.rule_value, is_active = TRUE, updated_at = NOW()
      RETURNING *;
    `;
    const values = [dto.tenant_id, dto.device_type, dto.rule_key, JSON.stringify(dto.rule_value)];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  static async getRulesForDevice(tenantId: string, deviceType: string): Promise<PricingRule[]> {
    const query = `
      SELECT * FROM pricing_rules
      WHERE tenant_id = $1 AND device_type = $2 AND is_active = TRUE;
    `;
    const { rows } = await pool.query(query, [tenantId, deviceType]);
    return rows;
  }

  static async getByTenant(tenantId: string): Promise<PricingRule[]> {
    const query = `
      SELECT * FROM pricing_rules
      WHERE tenant_id = $1 AND is_active = TRUE
      ORDER BY device_type, rule_key;
    `;
    const { rows } = await pool.query(query, [tenantId]);
    return rows;
  }
}
