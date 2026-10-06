import { pool } from '../config/db';
import { PricingRule, PricingRuleRecord, DefinePricingRuleDTO } from '../types/quotation';

export class PricingRuleModel {
  static async upsertRule(dto: DefinePricingRuleDTO): Promise<PricingRule> {
    if (!dto.device_type_id || !dto.device_type_code) {
      throw new Error('El tipo de equipo debe resolverse desde el catálogo.');
    }
    if (!['base_price', 'condition_adjustment'].includes(dto.rule_key)) {
      throw new Error('Tipo de regla de valoración no válido.');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const currentResult = await client.query<PricingRuleRecord>(
        `SELECT * FROM pricing_rules
         WHERE tenant_id = $1 AND device_type_id = $2 AND is_active = TRUE
         FOR UPDATE`,
        [dto.tenant_id, dto.device_type_id]
      );
      const current = currentResult.rows[0];
      const basePrice = dto.rule_key === 'base_price'
        ? Number(dto.rule_value.amount)
        : Number(current?.base_price ?? 0);
      const currency = dto.rule_key === 'base_price'
        ? String(dto.rule_value.currency ?? 'BOB').toUpperCase() === 'BS' ? 'BOB' : String(dto.rule_value.currency ?? 'BOB').toUpperCase()
        : current?.currency ?? 'BOB';
      const conditionAdjust = dto.rule_key === 'condition_adjustment'
        ? dto.rule_value as Record<string, number>
        : current?.condition_adjust ?? {};

      if (!Number.isFinite(basePrice) || basePrice < 0) {
        throw new Error('El precio base debe ser un número mayor o igual a cero.');
      }

      if (current) {
        await client.query(
          `UPDATE pricing_rules
           SET is_active = FALSE, effective_until = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [current.id]
        );
      }

      const versionResult = await client.query<{ version: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS version
         FROM pricing_rules WHERE tenant_id = $1 AND device_type_id = $2`,
        [dto.tenant_id, dto.device_type_id]
      );
      const result = await client.query<PricingRuleRecord>(
        `INSERT INTO pricing_rules (
           tenant_id, device_type_id, device_type_code, version, base_price,
           currency, condition_adjust, is_active, effective_from
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW())
         RETURNING *`,
        [
          dto.tenant_id,
          dto.device_type_id,
          dto.device_type_code,
          versionResult.rows[0].version,
          basePrice,
          currency,
          JSON.stringify(conditionAdjust),
        ]
      );
      await client.query('COMMIT');
      return this.toLegacyRule(result.rows[0], dto.rule_key, dto.rule_value);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async getActiveRule(tenantId: string, deviceTypeId: string): Promise<PricingRuleRecord | null> {
    const { rows } = await pool.query<PricingRuleRecord>(
      `SELECT * FROM pricing_rules
       WHERE tenant_id = $1 AND device_type_id = $2 AND is_active = TRUE`,
      [tenantId, deviceTypeId]
    );
    return rows[0] ?? null;
  }

  static async getOrCreateDefault(
    tenantId: string,
    deviceTypeId: string,
    deviceTypeCode: string,
    basePrice: number,
    conditionAdjust: Record<string, number>
  ): Promise<PricingRuleRecord> {
    const { rows } = await pool.query<PricingRuleRecord>(
      `INSERT INTO pricing_rules (
         tenant_id, device_type_id, device_type_code, version, base_price,
         currency, condition_adjust, is_active, effective_from
       ) VALUES ($1, $2, $3, 1, $4, 'BOB', $5, TRUE, NOW())
       ON CONFLICT (tenant_id, device_type_id) WHERE is_active DO NOTHING
       RETURNING *`,
      [tenantId, deviceTypeId, deviceTypeCode, basePrice, JSON.stringify(conditionAdjust)]
    );
    if (rows[0]) return rows[0];

    const current = await this.getActiveRule(tenantId, deviceTypeId);
    if (!current) throw new Error('No se pudo obtener la regla de valoración activa.');
    return current;
  }

  static async getRulesForDevice(tenantId: string, deviceTypeId: string): Promise<PricingRule[]> {
    const rule = await this.getActiveRule(tenantId, deviceTypeId);
    return rule ? this.toLegacyRules(rule) : [];
  }

  static async getByTenant(tenantId: string): Promise<PricingRule[]> {
    const { rows } = await pool.query<PricingRuleRecord>(
      `SELECT * FROM pricing_rules
       WHERE tenant_id = $1 AND is_active = TRUE
       ORDER BY device_type_code`,
      [tenantId]
    );
    return rows.flatMap((row) => this.toLegacyRules(row));
  }

  private static toLegacyRules(row: PricingRuleRecord): PricingRule[] {
    return [
      this.toLegacyRule(row, 'base_price', { amount: Number(row.base_price), currency: 'Bs' }),
      this.toLegacyRule(row, 'condition_adjustment', row.condition_adjust),
    ];
  }

  private static toLegacyRule(
    row: PricingRuleRecord,
    ruleKey: string,
    ruleValue: Record<string, any>
  ): PricingRule {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      device_type: row.device_type_code ?? row.device_type_id,
      device_type_id: row.device_type_id,
      version: row.version,
      rule_key: ruleKey,
      rule_value: ruleValue,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
