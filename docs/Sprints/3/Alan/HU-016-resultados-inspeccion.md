# HU-016 — Determinar resultado de inspección

## Historia

Como inspector, quiero determinar si el equipo recibido se destina a reventa o reciclaje y justificar la decisión, para completar la inspección y actualizar el seguimiento de la orden.

## Flujo implementado

1. Un usuario `INSPECTOR` abre una inspección registrada (HU-015) y elige `RESALE` o `RECYCLE`.
2. Debe ingresar una justificación de hasta 2000 caracteres.
3. Inspection guarda el resultado, la justificación, el usuario y la fecha de finalización, y publica `InspectionCompleted` mediante su outbox en la misma transacción.
4. Orders consume `inspection.completed` de forma idempotente y mueve la orden de `RECEIVED` o `INSPECTING` a `INSPECTED`. La transición conserva el inspector y la justificación en el historial de estados.

## API y evento

Endpoint vía Gateway:

```http
POST /recicla/{slug}/api/inspections/orders/{orderId}/complete
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "result": "RESALE",
  "justification": "El equipo funciona y no presenta daños estructurales."
}
```

Solo `INSPECTOR` puede completar. La orden debe tener una inspección registrada. Resultado inválido, justificación vacía o excesiva se rechazan; una inspección completada no puede cambiar a otro resultado.

El evento se publica con routing key `inspection.completed`, tipo `InspectionCompleted` y `correlation_id` igual al `order_id`. Su payload contiene `inspection_id`, `order_id`, `result`, `justification`, `completed_by_user_id` y `completed_at`.

## Migración y ejecución

La migración incremental es `services/inspection/db/02-inspection-completion.sql`. Compose la ejecuta al inicializar una base de Inspection vacía; en una base existente los scripts de `docker-entrypoint-initdb.d` no vuelven a ejecutarse, por lo que se debe aplicar una vez:

```bash
docker exec -i reecicla-inspection-db psql \
  -v ON_ERROR_STOP=1 --single-transaction \
  -U reecicla_user -d reecicla_inspection_db \
  < reecicla-backend/services/inspection/db/02-inspection-completion.sql
```

Después de aplicar la migración y reconstruir los servicios, el resultado se registra desde la sección Inspección del frontend. La publicación y el consumo del evento se procesan de forma asíncrona; Orders actualiza el estado al recibirlo.

## Validación

- `npm test` en `services/inspection`
- `npm test` en `services/orders`
- `npm run build` en `reecicla-frontend`

Las pruebas de integración que necesitan PostgreSQL permanecen condicionadas a su configuración de ejecución; las pruebas unitarias de validación y los builds se ejecutan con esos comandos.
