import { getActiveEvaluationRule } from '../clients/catalogClient';
import { validateInspectionInput } from '../domain/checklist';
import { DomainError, UUID_PATTERN } from '../domain/errors';
import { validateInspectionResult } from '../domain/inspectionResult';
import { InspectionModel } from '../models/inspectionModel';
import { ReceivedDeviceModel } from '../models/receivedDeviceModel';
import { EvaluationRule, Inspection, ReceivedDevice } from '../types/inspection';

export interface OrderChecklist {
  device: ReceivedDevice;
  rule: EvaluationRule;
}

async function getReceivedDevice(tenantId: string, orderId: unknown): Promise<ReceivedDevice> {
  if (typeof orderId !== 'string' || !UUID_PATTERN.test(orderId)) {
    throw new DomainError(400, 'El identificador de la orden (order_id) es inválido.');
  }
  const device = await ReceivedDeviceModel.findByOrder(tenantId, orderId);
  if (!device) {
    throw new DomainError(404, 'No hay un equipo recibido para esa orden.');
  }
  return device;
}

async function getActiveRule(tenantId: string, device: ReceivedDevice): Promise<EvaluationRule> {
  const rule = await getActiveEvaluationRule(tenantId, device.device_type_id);
  if (!rule) {
    throw new DomainError(409, `El tipo "${device.device_type_name}" no tiene una checklist vigente. Pide al administrador del catálogo que la defina.`);
  }
  return rule;
}

export class InspectionService {
  /** Checklist vigente del tipo de la orden, para mostrar el formulario. */
  static async getChecklistForOrder(tenantId: string, orderId: string): Promise<OrderChecklist> {
    const device = await getReceivedDevice(tenantId, orderId);
    const rule = await getActiveRule(tenantId, device);
    return { device, rule };
  }

  static async register(tenantId: string, inspectorUserId: string, body: any): Promise<Inspection> {
    const device = await getReceivedDevice(tenantId, body?.order_id);

    const existing = await InspectionModel.findByOrder(tenantId, device.order_id);
    if (existing) {
      throw new DomainError(409, 'La orden ya tiene una inspección registrada.');
    }

    const rule = await getActiveRule(tenantId, device);
    if (body.evaluation_rule_id !== rule.id || Number(body.evaluation_rule_version) !== rule.version) {
      throw new DomainError(409, 'La checklist cambió. Recarga e inténtalo de nuevo.');
    }

    const data = validateInspectionInput(body, rule.checklist);

    return InspectionModel.create({
      tenantId,
      orderId: device.order_id,
      deviceTypeId: device.device_type_id,
      evaluationRuleId: rule.id,
      evaluationRuleVersion: rule.version,
      inspectorUserId,
      data,
    });
  }

  static async getByOrder(tenantId: string, orderId: string): Promise<Inspection> {
    if (!UUID_PATTERN.test(orderId)) {
      throw new DomainError(400, 'El identificador de la orden (order_id) es inválido.');
    }
    const inspection = await InspectionModel.findByOrder(tenantId, orderId);
    if (!inspection) {
      throw new DomainError(404, 'La orden no tiene una inspección registrada.');
    }
    return inspection;
  }

  static async complete(
    tenantId: string,
    inspectorUserId: string,
    orderId: string,
    body: unknown
  ): Promise<Inspection> {
    if (!UUID_PATTERN.test(orderId)) {
      throw new DomainError(400, 'El identificador de la orden (order_id) es inválido.');
    }
    const data = validateInspectionResult(body);
    return InspectionModel.complete(
      tenantId,
      orderId,
      inspectorUserId,
      data.result,
      data.justification
    );
  }
}
