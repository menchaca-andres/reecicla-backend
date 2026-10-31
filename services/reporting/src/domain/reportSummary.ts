import {
  AmountsByCurrency,
  DispositionType,
  QuoteStatus,
  QuoteType,
  ReportPeriod,
  ReportSummary,
} from '../types/reporting';

// Filas agregadas que devuelve ReportModel (una por combinación de GROUP BY).
export interface QuoteAggregateRow {
  quote_type: string;
  status: string;
  currency: string;
  device_type_name: string | null;
  count: number | string;
  amount: number | string;
}

export interface StatusCountRow {
  status: string;
  count: number | string;
}

export interface PaymentAggregateRow {
  method: string;
  status: string;
  currency: string;
  count: number | string;
  amount: number | string;
}

export interface DispositionAggregateRow {
  type: string;
  count: number | string;
}

export interface ReportAggregates {
  quotes: QuoteAggregateRow[];
  ordersInPeriod: StatusCountRow[];
  ordersCurrent: StatusCountRow[];
  payments: PaymentAggregateRow[];
  dispositions: DispositionAggregateRow[];
  lastEventAt: Date | string | null;
}

const QUOTE_STATUSES: QuoteStatus[] = ['ANONYMOUS', 'PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED'];
const QUOTE_TYPES: QuoteType[] = ['INITIAL', 'ADJUSTED'];
const DISPOSITION_TYPES: DispositionType[] = ['RESALE', 'RECYCLE', 'RETURN'];
export const MAX_DEVICE_TYPES = 10;

function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

function addAmount(target: AmountsByCurrency, currency: string, value: number): void {
  target[currency] = round2((target[currency] ?? 0) + value);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function countByStatus(rows: StatusCountRow[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) result[row.status] = (result[row.status] ?? 0) + Number(row.count);
  return result;
}

/**
 * Arma el resumen del reporte a partir de las agregaciones SQL.
 * Montos de cotizaciones y tasa de aceptación se calculan solo sobre
 * cotizaciones INICIALES: la ajustada es una re-cotización de la misma orden
 * y sumarla duplicaría el monto.
 */
export function buildReportSummary(
  tenantId: string,
  period: ReportPeriod,
  aggregates: ReportAggregates,
  now = new Date()
): ReportSummary {
  const byStatus = zeroed(QUOTE_STATUSES);
  const byType = zeroed(QUOTE_TYPES);
  const quotedAmount: AmountsByCurrency = {};
  const acceptedAmount: AmountsByCurrency = {};
  const devices = new Map<string, { total: number; accepted: number }>();
  let total = 0;
  let initialTotal = 0;
  let initialAccepted = 0;

  for (const row of aggregates.quotes) {
    const count = Number(row.count);
    const amount = Number(row.amount);
    total += count;
    if (row.status in byStatus) byStatus[row.status as QuoteStatus] += count;
    if (row.quote_type in byType) byType[row.quote_type as QuoteType] += count;
    if (row.quote_type !== 'INITIAL') continue;

    initialTotal += count;
    addAmount(quotedAmount, row.currency, amount);
    const name = row.device_type_name || 'Sin tipo';
    const device = devices.get(name) ?? { total: 0, accepted: 0 };
    device.total += count;
    if (row.status === 'ACCEPTED') {
      initialAccepted += count;
      device.accepted += count;
      addAmount(acceptedAmount, row.currency, amount);
    }
    devices.set(name, device);
  }

  const byDeviceType = [...devices.entries()]
    .map(([device_type_name, value]) => ({ device_type_name, ...value }))
    .sort((a, b) =>
      b.total - a.total || b.accepted - a.accepted || a.device_type_name.localeCompare(b.device_type_name))
    .slice(0, MAX_DEVICE_TYPES);

  const ordersInPeriod = countByStatus(aggregates.ordersInPeriod);

  const byMethod: ReportSummary['payments']['by_method'] = {};
  const completedAmount: AmountsByCurrency = {};
  let completed = 0;
  let failed = 0;
  for (const row of aggregates.payments) {
    const count = Number(row.count);
    const method = (byMethod[row.method] ??= { completed: 0, failed: 0, amount: {} });
    if (row.status === 'COMPLETED') {
      completed += count;
      method.completed += count;
      addAmount(method.amount, row.currency, Number(row.amount));
      addAmount(completedAmount, row.currency, Number(row.amount));
    } else if (row.status === 'FAILED') {
      failed += count;
      method.failed += count;
    }
  }

  const dispositionsByType = zeroed(DISPOSITION_TYPES);
  let dispositionsTotal = 0;
  for (const row of aggregates.dispositions) {
    if (!(row.type in dispositionsByType)) continue;
    dispositionsByType[row.type as DispositionType] += Number(row.count);
    dispositionsTotal += Number(row.count);
  }

  return {
    tenant_id: tenantId,
    period: { from: period.from, to: period.to },
    generated_at: now.toISOString(),
    last_event_at: aggregates.lastEventAt ? new Date(aggregates.lastEventAt).toISOString() : null,
    quotes: {
      total,
      by_status: byStatus,
      by_type: byType,
      acceptance_rate: initialTotal === 0 ? 0 : round2((initialAccepted / initialTotal) * 100),
      quoted_amount: quotedAmount,
      accepted_amount: acceptedAmount,
      by_device_type: byDeviceType,
    },
    orders: {
      created_in_period: Object.values(ordersInPeriod).reduce((sum, value) => sum + value, 0),
      by_status_in_period: ordersInPeriod,
      current_by_status: countByStatus(aggregates.ordersCurrent),
    },
    payments: {
      completed,
      failed,
      completed_amount: completedAmount,
      by_method: byMethod,
    },
    dispositions: {
      total: dispositionsTotal,
      by_type: dispositionsByType,
    },
  };
}

function csvCell(value: string | number): string {
  const text = String(value);
  // Evita inyección de fórmulas al abrir el CSV en Excel.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function amountRows(section: string, metric: string, amounts: AmountsByCurrency): Array<[string, string, string | number]> {
  const entries = Object.entries(amounts);
  if (entries.length === 0) return [[section, metric, 0]];
  return entries.map(([currency, value]) => [section, `${metric} (${currency})`, value.toFixed(2)]);
}

/** Exporta el resumen como CSV con columnas seccion,metrica,valor. */
export function reportSummaryToCsv(summary: ReportSummary): string {
  const rows: Array<[string, string, string | number]> = [
    ['periodo', 'desde', summary.period.from],
    ['periodo', 'hasta', summary.period.to],
    ['periodo', 'ultimo_evento', summary.last_event_at ?? ''],
    ['cotizaciones', 'total', summary.quotes.total],
    ...Object.entries(summary.quotes.by_status).map(([k, v]) => ['cotizaciones', `estado_${k}`, v] as [string, string, number]),
    ...Object.entries(summary.quotes.by_type).map(([k, v]) => ['cotizaciones', `tipo_${k}`, v] as [string, string, number]),
    ['cotizaciones', 'tasa_aceptacion_%', summary.quotes.acceptance_rate],
    ...amountRows('cotizaciones', 'monto_cotizado', summary.quotes.quoted_amount),
    ...amountRows('cotizaciones', 'monto_aceptado', summary.quotes.accepted_amount),
    ...summary.quotes.by_device_type.map((d) => ['cotizaciones_por_tipo', d.device_type_name, `${d.total} (${d.accepted} aceptadas)`] as [string, string, string]),
    ['ordenes', 'creadas_en_periodo', summary.orders.created_in_period],
    ...Object.entries(summary.orders.by_status_in_period).map(([k, v]) => ['ordenes_periodo', k, v] as [string, string, number]),
    ...Object.entries(summary.orders.current_by_status).map(([k, v]) => ['ordenes_estado_actual', k, v] as [string, string, number]),
    ['pagos', 'completados', summary.payments.completed],
    ['pagos', 'fallidos', summary.payments.failed],
    ...amountRows('pagos', 'monto_pagado', summary.payments.completed_amount),
    ...Object.entries(summary.payments.by_method).flatMap(([method, v]) => [
      ['pagos_por_metodo', `${method}_completados`, v.completed] as [string, string, number],
      ['pagos_por_metodo', `${method}_fallidos`, v.failed] as [string, string, number],
    ]),
    ['destino', 'total', summary.dispositions.total],
    ['destino', 'RESALE', summary.dispositions.by_type.RESALE],
    ['destino', 'RECYCLE', summary.dispositions.by_type.RECYCLE],
    ['destino', 'RETURN', summary.dispositions.by_type.RETURN],
  ];
  return ['seccion,metrica,valor', ...rows.map((row) => row.map(csvCell).join(','))].join('\n') + '\n';
}
