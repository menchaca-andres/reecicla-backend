import { PricingRuleModel } from '../models/pricingRuleModel';
import { QuoteModel } from '../models/quoteModel';
import { DefinePricingRuleDTO, CreateQuoteDTO, Quote, PricingRule } from '../types/quotation';

const DEFAULT_BASE_PRICES: Record<string, number> = {
  refrigerator: 150,
  washing_machine: 120,
  dishwasher: 100,
  stove: 90,
  microwave: 40,
  tv: 110,
  laptop: 130,
  smartphone: 80,
};

const DEFAULT_CONDITION_ADJUSTMENTS: Record<string, number> = {
  working: 0,
  damaged: -40,
  broken: -80,
};

const CATALOG_SERVICE_URL = process.env.CATALOG_SERVICE_URL || 'http://localhost:3003';

export class QuotationService {
  static async definePricingRule(dto: DefinePricingRuleDTO): Promise<PricingRule> {
    if (!dto.tenant_id || !dto.device_type || !dto.rule_key || !dto.rule_value) {
      throw new Error('tenant_id, device_type, rule_key y rule_value son requeridos.');
    }
    return await PricingRuleModel.upsertRule(dto);
  }

  static async createQuote(dto: CreateQuoteDTO): Promise<Quote> {
    if (!dto.tenant_id || !dto.user_id || !dto.device_type || !dto.condition) {
      throw new Error('tenant_id, user_id, device_type y condition son requeridos.');
    }

    let catalogResponse: Response;
    try {
      const availabilityUrl = new URL(
        `/api/catalog/device-types/${encodeURIComponent(dto.device_type)}/availability`,
        CATALOG_SERVICE_URL
      );
      availabilityUrl.searchParams.set('tenant_id', dto.tenant_id);
      catalogResponse = await fetch(availabilityUrl);
    } catch {
      throw new Error('No se pudo validar el tipo de equipo en el catálogo.');
    }
    if (!catalogResponse.ok) {
      throw new Error('No se pudo validar el tipo de equipo en el catálogo.');
    }
    const availability = await catalogResponse.json() as { available?: boolean };
    if (!availability.available) {
      throw new Error('El tipo de equipo no está activo para cotizar.');
    }

    const rules = await PricingRuleModel.getRulesForDevice(dto.tenant_id, dto.device_type);

    let basePrice = DEFAULT_BASE_PRICES[dto.device_type.toLowerCase()] ?? 100;
    let adjustment = DEFAULT_CONDITION_ADJUSTMENTS[dto.condition.toLowerCase()] ?? 0;

    for (const rule of rules) {
      if (rule.rule_key === 'base_price' && rule.rule_value?.amount !== undefined) {
        basePrice = Number(rule.rule_value.amount);
      }
      if (rule.rule_key === 'condition_adjustment' && rule.rule_value) {
        const condAdj = rule.rule_value[dto.condition.toLowerCase()];
        if (condAdj !== undefined) {
          adjustment = Number(condAdj);
        }
      }
    }

    const finalPrice = Math.max(0, basePrice + adjustment);

    return await QuoteModel.createQuote(dto, basePrice, adjustment, finalPrice);
  }

  static async getQuoteById(id: string): Promise<Quote | null> {
    return await QuoteModel.findById(id);
  }

  static async getUserQuotes(tenantId: string, userId: string): Promise<Quote[]> {
    return await QuoteModel.findByUserId(tenantId, userId);
  }

  static async getTenantRules(tenantId: string): Promise<PricingRule[]> {
    if (!tenantId) throw new Error('tenant_id es requerido.');
    return await PricingRuleModel.getByTenant(tenantId);
  }
}
