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
function internalServiceToken(): string {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!token) throw new Error('INTERNAL_SERVICE_TOKEN debe estar configurado.');
  return token;
}

interface CatalogDeviceType {
  id: string;
  code: string;
  name: string;
  status: string;
  accepts_quotes: boolean;
}

async function getAvailableDeviceType(tenantId: string, requestedType: string): Promise<CatalogDeviceType> {
  const catalogUrl = new URL('/api/catalog/device-types', CATALOG_SERVICE_URL);
  let response: Response;
  try {
    response = await fetch(catalogUrl, {
      headers: { 'x-tenant-id': tenantId },
    });
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
  const reservationUrl = new URL('/api/auth/internal/quote-quota/reservations', AUTH_SERVICE_URL);
  const method = action === 'reserve' ? 'POST' : action === 'commit' ? 'POST' : 'DELETE';
  const url = action === 'reserve'
    ? reservationUrl
    : new URL(`${reservationUrl.pathname}/${encodeURIComponent(reservationId)}${action === 'commit' ? '/commit' : ''}`, AUTH_SERVICE_URL);
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-internal-service-token': internalServiceToken(),
    },
    ...(action === 'reserve' ? { body: JSON.stringify({ tenant_id: tenantId, reservation_id: reservationId }) } : {}),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error || 'No se pudo actualizar el límite mensual de cotizaciones.');
  }
}

export interface VerifiedGuestContact {
  tenant_id: string;
  quote_id: string;
  email: string;
  name: string;
  phone: string;
  address: string;
}

async function requestGuestVerification(
  tenantId: string,
  quoteId: string,
  email: string,
  name: string,
  phone: string,
  address: string
): Promise<void> {
  const response = await fetch(new URL('/api/auth/internal/guest-verifications', AUTH_SERVICE_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-service-token': internalServiceToken(),
      'x-tenant-id': tenantId,
    },
    body: JSON.stringify({ email, name, phone, address, tenant_id: tenantId, quote_id: quoteId }),
  });
  const result = await response.json().catch(() => ({})) as {
    error?: string;
    verification_required?: boolean;
  };
  if (!response.ok || !result.verification_required) {
    const error = new Error(result.error || 'No se pudo enviar el código de verificación.');
    Object.assign(error, { status: response.status });
    throw error;
  }
}

async function verifyGuestClient(
  tenantId: string,
  quoteId: string,
  email: string,
  code: string
): Promise<VerifiedGuestContact> {
  const response = await fetch(new URL('/api/auth/internal/guest-verifications/verify', AUTH_SERVICE_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-service-token': internalServiceToken(),
      'x-tenant-id': tenantId,
    },
    body: JSON.stringify({ email, code, tenant_id: tenantId, quote_id: quoteId }),
  });
  const result = await response.json().catch(() => ({})) as {
    error?: string;
    tenant_id?: string;
    quote_id?: string;
    email?: string;
    name?: string;
    phone?: string;
    address?: string;
  };
  if (
    !response.ok || result.tenant_id !== tenantId || result.quote_id !== quoteId ||
    !result.email || !result.name || !result.phone || typeof result.address !== 'string'
  ) {
    const error = new Error(result.error || 'No se pudo verificar el correo del cliente.');
    Object.assign(error, { status: response.status });
    throw error;
  }
  return {
    tenant_id: result.tenant_id,
    quote_id: result.quote_id,
    email: result.email,
    name: result.name,
    phone: result.phone,
    address: result.address,
  };
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

  static async createQuote(dto: CreateQuoteDTO, requestReservationId?: string): Promise<Quote> {
    if (!dto.tenant_id || !dto.device_type || !dto.condition) {
      throw new Error('tenant_id, device_type y condition son requeridos.');
    }

    const deviceType = await getAvailableDeviceType(dto.tenant_id, dto.device_type);

    const bestRule = await PricingRuleModel.findBestMatchingRule(
      dto.tenant_id,
      deviceType.id,
      dto.brand,
      dto.model,
      dto.year
    );

    if (!bestRule) {
      throw new Error('No existe una regla de valoración configurada para este tipo de equipo o modelo.');
    }
    const pricingRule = bestRule;
    const basePrice = Number(pricingRule.base_price);
    const adjustment = Number(
      pricingRule.condition_adjust[dto.condition.toLowerCase()] ??
      DEFAULT_CONDITION_ADJUSTMENTS[dto.condition.toLowerCase()] ?? 0
    );

    const finalPrice = Math.max(0, basePrice + adjustment);

    const reservationId = requestReservationId ?? randomUUID();
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

  static async expireOverdueQuotes(): Promise<number> {
    return QuoteModel.expireOverdueQuotes();
  }

  static async purgeStaleAnonymousQuotes(): Promise<number> {
    return QuoteModel.purgeStaleAnonymousQuotes();
  }

  static async rejectQuote(quoteId: string, tenantId: string): Promise<Quote> {
    return QuoteModel.rejectQuote(quoteId, tenantId);
  }

  static async acceptQuote(input: {
    quoteId: string;
    tenantId: string;
    userId: string | null;
    customerName: string;
    customerEmail: string;
    phone?: string;
    address?: string;
    authenticated: boolean;
    verificationCode?: string;
  }): Promise<{ quote?: Quote; verificationRequired?: boolean }> {
    let name = input.customerName.trim();
    let email = input.customerEmail.trim();
    let phone = (input.phone ?? '').trim();

    if (!name || !email) {
      throw new Error('Nombre y correo del cliente son requeridos para aceptar la cotización.');
    }
    if (!input.authenticated && !phone) {
      throw new Error('El teléfono es requerido para aceptar la cotización.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('El correo del cliente no es válido.');
    }

    const currentQuote = await QuoteModel.findById(input.quoteId);
    if (!currentQuote || currentQuote.tenant_id !== input.tenantId) {
      throw new Error('Cotización no encontrada.');
    }
    if (currentQuote.status !== 'PENDING' && currentQuote.status !== 'ANONYMOUS') {
      throw new Error('La cotización ya no está pendiente.');
    }
    if (new Date(currentQuote.valid_until).getTime() <= Date.now()) {
      await QuoteModel.expireOverdueQuotes();
      throw new Error('La cotización venció y no puede aceptarse.');
    }

    let userId = input.userId;
    let address = input.address?.trim() ?? '';
    if (!input.authenticated) {
      if (!input.verificationCode) {
        await requestGuestVerification(input.tenantId, input.quoteId, email, name, phone, address);
        return { verificationRequired: true };
      }
      const verified = await verifyGuestClient(
        input.tenantId,
        input.quoteId,
        email,
        input.verificationCode
      );
      name = verified.name;
      email = verified.email;
      phone = verified.phone;
      address = verified.address;
    }

    const quote = await QuoteModel.acceptQuote(
      input.quoteId,
      input.tenantId,
      userId,
      name,
      email,
      phone || undefined,
      address || undefined
    );
    return { quote };
  }

  static async getUserQuotes(tenantId: string, userId: string): Promise<Quote[]> {
    return await QuoteModel.findByUserId(tenantId, userId);
  }

  static async getTenantRules(tenantId: string): Promise<PricingRule[]> {
    if (!tenantId) throw new Error('tenant_id es requerido.');
    return await PricingRuleModel.getByTenant(tenantId);
  }
}
