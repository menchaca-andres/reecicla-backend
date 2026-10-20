import { ReportPeriod } from '../types/reporting';

export const DEFAULT_PERIOD_DAYS = 30;
export const MAX_PERIOD_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class InvalidReportPeriodError extends Error {}

function parseDate(value: string, field: string): Date {
  if (!DATE_RE.test(value)) {
    throw new InvalidReportPeriodError(`El parámetro "${field}" debe tener el formato AAAA-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  // Rechaza fechas imposibles como 2026-02-31 (Date las desplaza al mes siguiente).
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new InvalidReportPeriodError(`El parámetro "${field}" no es una fecha válida.`);
  }
  return date;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function single(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new InvalidReportPeriodError('Los parámetros de fecha deben enviarse una sola vez.');
  return value.trim() || undefined;
}

/**
 * Resuelve el periodo del reporte a partir de ?from=AAAA-MM-DD&to=AAAA-MM-DD.
 * Ambas fechas son inclusivas y se interpretan en UTC. Sin parámetros se usan
 * los últimos 30 días (incluido hoy).
 */
export function resolveReportPeriod(query: { from?: unknown; to?: unknown }, now = new Date()): ReportPeriod {
  const fromRaw = single(query.from);
  const toRaw = single(query.to);

  const today = parseDate(formatDate(now), 'to');
  const toDate = toRaw ? parseDate(toRaw, 'to') : today;
  const fromDate = fromRaw
    ? parseDate(fromRaw, 'from')
    : new Date(toDate.getTime() - (DEFAULT_PERIOD_DAYS - 1) * DAY_MS);

  if (fromDate.getTime() > toDate.getTime()) {
    throw new InvalidReportPeriodError('La fecha "from" no puede ser posterior a la fecha "to".');
  }
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / DAY_MS) + 1;
  if (days > MAX_PERIOD_DAYS) {
    throw new InvalidReportPeriodError(`El periodo no puede superar ${MAX_PERIOD_DAYS} días.`);
  }

  return {
    from: formatDate(fromDate),
    to: formatDate(toDate),
    fromDate,
    toExclusive: new Date(toDate.getTime() + DAY_MS),
  };
}
