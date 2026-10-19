# HU-025: Registrar destino final del equipo

## Historia

Como operador, quiero registrar el destino final del equipo (reventa o reciclaje) para cerrar el ciclo.

## Flujo implementado

1. Un usuario `TENANT_ADMIN`, `SUPER_ADMIN` o `INSPECTOR` (los mismos roles de logística) abre una orden en `PAID` o en `ADJUSTMENT_REJECTED` con destino ya elegido por el cliente (o vencido el plazo de 7 días) y pulsa **Registrar destino**.
2. Indica el destino y una referencia obligatoria de hasta 255 caracteres: publicación de venta (`RESALE`), certificado de destrucción (`RECYCLE`) o guía/comprobante de devolución (`RETURN`).
3. Orders registra todo en una sola transacción: crea o completa la fila de `dispositions` (`COMPLETED`), pasa la orden a `DISPOSED` y luego a `CLOSED`, y guarda `DispositionCompleted` en el outbox. El historial de estados conserva al operador y el motivo de cada cambio.
4. En una orden con ajuste rechazado ya existe una disposición `PENDING` creada por HU-018: solo se completa y su tipo no se puede cambiar. Una orden pagada no tiene disposición previa, se crea al registrar, y `RETURN` no se acepta en ese camino.
5. Es idempotente: repetir el registro con el mismo tipo devuelve el destino existente (200) sin duplicar historial ni eventos; con otro tipo responde 409.

## API y evento

```http
POST /recicla/{slug}/api/orders/{orderId}/disposition
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "type": "RECYCLE",
  "reference": "CERT-DEST-0042"
}
```

Respuestas: `201` al registrar, `200` si ya estaba registrado, `400` por datos inválidos, `404` si la orden no existe en el tenant, `409` si el estado no es elegible o el tipo no coincide con el destino pendiente.

El evento se publica con routing key `disposition.completed`, tipo `DispositionCompleted` y `correlation_id` igual al `order_id`. Su payload contiene `disposition_id`, `order_id`, `type`, `reference`, `completed_by_user_id` y `completed_at`.

Las consultas de órdenes (`/`, `/:id`, `/admin/all` y `/tracking/:token`) ahora devuelven `disposition_type`, `disposition_status`, `disposition_reference` y `disposition_completed_at`.

## Migración

No requiere migración: la tabla `dispositions`, los estados `DISPOSED`/`CLOSED` y el outbox ya existían. Solo hay que reconstruir el servicio:

```sh
docker compose up -d --build orders-service
```

## Frontend

- `LogisticsManager`: botón **Registrar destino**, modal con tipo y referencia (el tipo queda fijo si el cliente ya lo eligió), estados y filtros nuevos (`PAID`, `ADJUSTMENT_REJECTED`, `CLOSED`).
- `GuestOrderTracking` y `QuoteHistory`: muestran el destino final y su referencia cuando está completado.

## Validación

- `npm test` en `services/orders`: `tests/disposition.test.cjs` (validación y reglas de decisión) y `tests/disposition.integration.test.cjs` (flujos `PAID` y `ADJUSTMENT_REJECTED`, idempotencia, estado no elegible y aislamiento por tenant; requiere `RUN_ORDERS_INTEGRATION=1` y PostgreSQL).
- `npm run build` en `reecicla-frontend`.
