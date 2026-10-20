import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { InvalidReportPeriodError, resolveReportPeriod } from '../domain/reportPeriod';
import { buildReportSummary, reportSummaryToCsv } from '../domain/reportSummary';
import { ReportModel } from '../models/reportModel';
import { ReportSummary } from '../types/reporting';

async function loadSummary(req: AuthenticatedRequest, res: Response): Promise<ReportSummary | null> {
  let period;
  try {
    period = resolveReportPeriod(req.query);
  } catch (error) {
    if (error instanceof InvalidReportPeriodError) {
      res.status(400).json({ error: error.message });
      return null;
    }
    throw error;
  }
  // El tenant sale del token, nunca de parámetros del cliente.
  const tenantId = req.authUser!.tenantId;
  const aggregates = await ReportModel.getAggregates(tenantId, period);
  return buildReportSummary(tenantId, period, aggregates);
}

export class ReportController {
  static async summary(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const summary = await loadSummary(req, res);
      if (summary) res.json(summary);
    } catch (error) {
      console.error('[Reporting] Error generando el reporte:', error);
      res.status(500).json({ error: 'No se pudo generar el reporte.' });
    }
  }

  static async summaryCsv(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const summary = await loadSummary(req, res);
      if (!summary) return;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="reporte-${summary.period.from}-a-${summary.period.to}.csv"`
      );
      // BOM para que Excel respete tildes y eñes.
      res.send(`﻿${reportSummaryToCsv(summary)}`);
    } catch (error) {
      console.error('[Reporting] Error exportando el reporte:', error);
      res.status(500).json({ error: 'No se pudo exportar el reporte.' });
    }
  }
}
