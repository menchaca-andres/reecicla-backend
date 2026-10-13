# HU-014: Registrar recepción del equipo

## Objetivo

Como operador, quiero registrar la recepción del equipo para que la orden avance a `RECEIVED`, quede auditada y Catalog actualice la fecha de última recepción del tipo.

## Flujo implementado

1. Un usuario con rol `INSPECTOR`, `TENANT_ADMIN` o `SUPER_ADMIN` abre **Logística** en el frontend.
2. Para las órdenes con estado `IN_TRANSIT`, la interfaz ofrece **Registrar Recepción** y pide confirmación.
3. El frontend llama `POST /api/orders/:id/receive` a través del Gateway.
4. Orders valida el JWT, limita la orden al `tenant_id` del usuario y acepta la operación únicamente desde `IN_TRANSIT` (un reintento de una orden `RECEIVED` es idempotente).
5. Dentro de una transacción, Orders actualiza `status` a `RECEIVED`, establece `received_at` y agrega el evento `DeviceReceived` a `domain_event_outbox`. El trigger de estados registra el actor y el motivo una sola vez en `order_status_history`.
6. Orders publica los eventos pendientes en RabbitMQ, con routing key `device.received`. Si RabbitMQ no está disponible, el evento permanece en outbox y el dispatcher vuelve a intentarlo.
7. Catalog consume `DeviceReceived`, deduplica por `event_id` y actualiza `device_types.last_received_at` para el `tenant_id` y `device_type_id` del evento.

## Contrato HTTP

`POST /api/orders/:id/receive`

Requiere `Authorization: Bearer <JWT>` con rol `INSPECTOR`, `TENANT_ADMIN` o `SUPER_ADMIN`. No requiere cuerpo.

Respuesta exitosa (`200`):

```json
{
  "message": "Recepción registrada. El catálogo actualizará la última fecha de recepción.",
  "order": {
    "id": "<order-id>",
    "tenant_id": "<tenant-id>",
    "status": "RECEIVED",
    "device_type_id": "<device-type-id>",
    "device_type_name": "Refrigerador",
    "received_at": "<timestamp>"
  }
}
```

Errores relevantes: `401` sin JWT, `403` con rol no autorizado, `404` si la orden no pertenece al tenant, y `409` si el estado actual no es `IN_TRANSIT` ni `RECEIVED`.

## Archivos principales

Backend:
- `services/orders/src/routes/orderRoutes.ts`: endpoint y autorización por rol.
- `services/orders/src/controllers/orderController.ts`: contrato HTTP.
- `services/orders/src/models/orderModel.ts`: transición, lock de la orden, historial y outbox en una transacción.
- `services/orders/src/messaging/eventPublisher.ts`: publicación y reintento de eventos pendientes.
- `services/orders/src/index.ts`: ejecución periódica del dispatcher y cierre ordenado.
- `services/catalog/src/index.ts`: suscripción a `device.received` y actualización de `last_received_at`.
- `services/catalog/src/messaging/eventBus.ts`: consumo transaccional e idempotencia de eventos.
- `database/05-orders-domain-event-outbox.sql`: outbox y trigger de historial con actor/motivo.
- `services/catalog/db/05-processed-events-tenant.sql`: tabla/columna para registrar eventos procesados por Catalog.
- `docker-compose.yml`: Orders, RabbitMQ, healthchecks, dependencias y montajes de migraciones.

Frontend:
- `src/features/logistica/components/LogisticsManager.tsx`: acción disponible para órdenes en tránsito.
- `src/services/api.ts`: llamada a `POST /api/orders/:id/receive`.
- `src/types/index.ts`: campos de recepción e historial de órdenes.
- `src/App.tsx` y `src/components/Navbar.tsx`: acceso a Logística según rol.

## Persistencia y migraciones

Las migraciones nuevas son aditivas; no eliminan datos:

- `database/05-orders-domain-event-outbox.sql` crea el outbox y actualiza el trigger que registra cambios de estado.
- `services/catalog/db/05-processed-events-tenant.sql` crea `processed_events` si falta y añade `tenant_id` si la tabla ya existía.

Los scripts bajo `/docker-entrypoint-initdb.d` solo se ejecutan cuando PostgreSQL inicializa un volumen nuevo. Si los volúmenes ya existían antes de esta HU, aplicar ambas migraciones manualmente con `psql` o pgAdmin. No eliminar los volúmenes para forzar la migración: contienen datos persistentes.

## Pruebas

Compilar Orders y ejecutar sus pruebas unitarias:

```powershell
cd services/orders
npm test
```

Ejecutar la prueba de integración de recepción contra una Orders DB inicializada con la migración `03-orders-migration.sql` y `05-orders-domain-event-outbox.sql`:

```powershell
$env:RUN_ORDERS_INTEGRATION = '1'
node --test tests/receipt.integration.test.cjs
Remove-Item Env:RUN_ORDERS_INTEGRATION
```

También se verificó con Docker el recorrido real: respuesta HTTP `200`, transición `IN_TRANSIT -> RECEIVED`, una sola fila de historial con operador y motivo, evento publicado, y actualización de `last_received_at` en Catalog. Los registros temporales de esa prueba se eliminaron.

Builds validados: `npm test` en Orders, `npm run build` en Catalog y `npm run build` en frontend. Oxlint aún muestra advertencias React preexistentes en otros componentes; no bloquean el build.

## Consideraciones para continuar

- HU-014 publica `DeviceReceived` para futuros consumidores (Inspection, Notification y Reporting) sin acoplar Orders a sus bases de datos.
- `device_type_id` es una referencia lógica entre bases; Catalog actualiza el tipo filtrando por tenant.
- La recepción es idempotente: repetir la solicitud sobre una orden `RECEIVED` no crea otra transición ni otro evento.
- RabbitMQ y el endpoint de órdenes deben estar levantados para probar el flujo completo. El endpoint de salud de Orders es `http://localhost:3004/health`.
