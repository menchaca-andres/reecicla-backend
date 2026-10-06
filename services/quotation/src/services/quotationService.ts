import { PricingRuleModel } from '../models/pricingRuleModel';
import { QuoteModel } from '../models/quoteModel';
import { DefinePricingRuleDTO, CreateQuoteDTO, Quote, PricingRule } from '../types/quotation';
import { randomUUID } from 'crypto';

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
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN;

interface CatalogDeviceType {
  id: string;
  code: string;
  name: string;
  status: string;
  accepts_quotes: boolean;
}

async function getAvailableDeviceType(tenantId: string, requestedType: string): Promise<CatalogDeviceType> {
  const catalogUrl = new URL('/api/catalog/device-types', CATALOG_SERVICE_URL);
  catalogUrl.searchParams.set('tenant_id', tenantId);

  let response: Response;
  try {
    response = await fetch(catalogUrl);
  } catch {
    throw new Error('No se pudo validar el tipo de equipo en el catálogo.');
  }

  if (!response.ok) {
    throw new Error('No se pudo validar el tipo de equipo en el catálogo.');
  }

  const payload = await response.json() as { deviceTypes?: CatalogDeviceType[]; device_types?: CatalogDeviceType[] };
  const deviceTypes = payload.deviceTypes ?? payload.device_types ?? [];
  const deviceType = deviceTypes.find((item) =>
    item.id === requestedType || item.code.toLowerCase() === requestedType.toLowerCase()
  );

  if (!deviceType || deviceType.status !== 'ACTIVE' || !deviceType.accepts_quotes) {
    throw new Error('El tipo de equipo no está activo para cotizar.');
  }

  return deviceType;
}

async function updateQuoteReservation(reservationId: string, action: 'reserve' | 'commit' | 'release', tenantId?: string): Promise<void> {
  if (!INTERNAL_SERVICE_TOKEN) throw new Error('El servicio interno de cuota no está configurado.');

  const reservationUrl = new URL('/api/auth/internal/quote-quota/reservations', AUTH_SERVICE_URL);
  const method = action === 'reserve' ? 'POST' : action === 'commit' ? 'POST' : 'DELETE';
  const url = action === 'reserve'
    ? reservationUrl
    : new URL(`${reservationUrl.pathname}/${encodeURIComponent(reservationId)}${action === 'commit' ? '/commit' : ''}`, AUTH_SERVICE_URL);
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-internal-service-token': INTERNAL_SERVICE_TOKEN,
    },
    ...(action === 'reserve' ? { body: JSON.stringify({ tenant_id: tenantId, reservation_id: reservationId }) } : {}),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error || 'No se pudo actualizar el límite mensual de cotizaciones.');
  }
}

export class QuotationService {
  static async definePricingRule(dto: DefinePricingRuleDTO): Promise<PricingRule> {
    if (!dto.tenant_id || !dto.device_type || !dto.rule_key || !dto.rule_value) {
      throw new Error('tenant_id, device_type, rule_key y rule_value son requeridos.');
    }
    const deviceType = await getAvailableDeviceType(dto.tenant_id, dto.device_type);
    return await PricingRuleModel.upsertRule({
      ...dto,
      device_type_id: deviceType.id,
      device_type_code: deviceType.code,
    });
  }

  static async createQuote(dto: CreateQuoteDTO, requestReservationId: string = randomUUID()): Promise<Quote> {
    if (!dto.tenant_id || !dto.user_id || !dto.device_type || !dto.condition) {
      throw new Error('tenant_id, user_id, device_type y condition son requeridos.');
    }

    const deviceType = await getAvailableDeviceType(dto.tenant_id, dto.device_type);

    const pricingRule = await PricingRuleModel.getOrCreateDefault(
      dto.tenant_id,
      deviceType.id,
      deviceType.code,
      DEFAULT_BASE_PRICES[deviceType.code.toLowerCase()] ?? 100,
      DEFAULT_CONDITION_ADJUSTMENTS
    );
    const basePrice = Number(pricingRule.base_price);
    const adjustment = Number(
      pricingRule.condition_adjust[dto.condition.toLowerCase()] ??
      DEFAULT_CONDITION_ADJUSTMENTS[dto.condition.toLowerCase()] ?? 0
    );

    const finalPrice = Math.max(0, basePrice + adjustment);

    const reservationId = requestReservationId;
    await updateQuoteReservation(reservationId, 'reserve', dto.tenant_id);

    let quoteCreated = false;
    try {
      const quote = await QuoteModel.createQuote({
        ...dto,
        quota_reservation_id: reservationId,
        device_type_id: deviceType.id,
        device_type_name: deviceType.name,
        pricing_rule_id: pricingRule.id,
        currency: pricingRule.currency,
      }, basePrice, adjustment, finalPrice);
      quoteCreated = true;
      await updateQuoteReservation(reservationId, 'commit');
      return quote;
    } catch (error) {
      if (!quoteCreated) {
        try {
          await updateQuoteReservation(reservationId, 'release');
        } catch (releaseError) {
          console.error('[Quotation] No se pudo liberar una reserva de cuota:', releaseError);
        }
      }
      throw error;
    }
  }

  static async getQuoteById(id: string): Promise<Quote | null> {
    return await QuoteModel.findById(id);
  }

  static async acceptQuote(
    quoteId: string,
    tenantId: string,
    userId: string,
    customerName: string,
    customerEmail: string
  ): Promise<Quote> {
    return await QuoteModel.acceptQuote(quoteId, tenantId, userId, customerName, customerEmail);
  }

  static async getUserQuotes(tenantId: string, userId: string): Promise<Quote[]> {
    return await QuoteModel.findByUserId(tenantId, userId);
  }

  static async getTenantRules(tenantId: string): Promise<PricingRule[]> {
    if (!tenantId) throw new Error('tenant_id es requerido.');
    return await PricingRuleModel.getByTenant(tenantId);
  }
}
