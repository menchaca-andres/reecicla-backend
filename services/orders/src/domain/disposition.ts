import { DispositionStatus, DispositionType, RegisterDispositionInput } from '../types/orders';

export const DISPOSITION_REFERENCE_MAX_LENGTH = 255;
const DISPOSITION_TYPES: readonly DispositionType[] = ['RESALE', 'RECYCLE', 'RETURN'];

export class DispositionError extends Error {
  constructor(message: string, public readonly httpStatus: 400 | 404 | 409) {
    super(message);
    this.name = 'DispositionError';
  }
}

export type DispositionAction = 'CREATE' | 'COMPLETE_EXISTING' | 'ALREADY_REGISTERED';

export interface DispositionOrderState {
  status: string;
}

export interface ExistingDisposition {
  type: DispositionType;
  status: DispositionStatus;
}

export function validateDispositionInput(body: unknown): RegisterDispositionInput {
  if (!body || typeof body !== 'object') {
    throw new DispositionError('El cuerpo de la solicitud es obligatorio.', 400);
  }
  const { type, reference } = body as { type?: unknown; reference?: unknown };
  if (typeof type !== 'string' || !DISPOSITION_TYPES.includes(type as DispositionType)) {
    throw new DispositionError('El destino debe ser RESALE, RECYCLE o RETURN.', 400);
  }
  if (typeof reference !== 'string' || !reference.trim()) {
    throw new DispositionError(
      'La referencia es obligatoria (publicación de venta, certificado de destrucción o comprobante de devolución).',
      400
    );
  }
  const cleanReference = reference.trim();
  if (cleanReference.length > DISPOSITION_REFERENCE_MAX_LENGTH) {
    throw new DispositionError(
      `La referencia no puede superar ${DISPOSITION_REFERENCE_MAX_LENGTH} caracteres.`,
      400
    );
  }
  return { type: type as DispositionType, reference: cleanReference };
}

/**
 * Decide qué debe hacer Orders al registrar el destino final.
 * - PAID: el destino se crea (RESALE o RECYCLE).
 * - ADJUSTMENT_REJECTED: ya existe una disposición PENDING creada por HU-018; solo se completa
 *   y su tipo no se puede cambiar.
 * - DISPOSED/CLOSED: es un reintento; se acepta solo si coincide con el destino ya registrado.
 */
export function decideDispositionAction(
  order: DispositionOrderState,
  existing: ExistingDisposition | null,
  input: RegisterDispositionInput
): DispositionAction {
  if (order.status === 'DISPOSED' || order.status === 'CLOSED') {
    if (existing?.status === 'COMPLETED') {
      if (existing.type !== input.type) {
        throw new DispositionError(
          `La orden ya fue cerrada con el destino ${existing.type}; no se puede cambiar.`,
          409
        );
      }
      return 'ALREADY_REGISTERED';
    }
    throw new DispositionError('La orden ya está cerrada y no tiene un destino pendiente.', 409);
  }

  if (order.status === 'ADJUSTMENT_REJECTED') {
    if (!existing || existing.status !== 'PENDING') {
      throw new DispositionError(
        'El cliente aún no eligió el destino del equipo y el plazo de 7 días no ha vencido.',
        409
      );
    }
  } else if (order.status !== 'PAID') {
    throw new DispositionError(
      `No se puede registrar el destino desde el estado ${order.status}; la orden debe estar PAID o ADJUSTMENT_REJECTED con destino elegido.`,
      409
    );
  }

  if (existing) {
    if (existing.status !== 'PENDING') {
      throw new DispositionError('El destino de esta orden ya fue completado.', 409);
    }
    if (existing.type !== input.type) {
      throw new DispositionError(
        `La orden tiene un destino pendiente ${existing.type}; el tipo enviado (${input.type}) no coincide.`,
        409
      );
    }
    return 'COMPLETE_EXISTING';
  }

  if (input.type === 'RETURN') {
    throw new DispositionError(
      'La devolución solo aplica a órdenes con ajuste rechazado cuyo cliente la eligió.',
      409
    );
  }
  return 'CREATE';
}
