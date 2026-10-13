# HU-018: Aceptar o rechazar el precio ajustado

## Flujo implementado

- El cliente autenticado puede responder al ajuste desde su historial; un cliente invitado puede responder desde su enlace privado de seguimiento. Quotation comprueba que la sesión sea propietaria de la cotización o que Orders valide el token vigente y la cotización original enlazada.
- La aceptación/rechazo de la cotización ajustada se guarda de forma transaccional con un evento outbox. Orders consume los eventos idempotentemente: la aceptación actualiza el precio final y deja la orden en `PAYMENT_PENDING`; el rechazo la deja en `ADJUSTMENT_REJECTED`.
- Cuando Inspection produce un ajuste, Quotation publica `AdjustedQuoteCreated` para mantener Orders en `ADJUSTMENT_PENDING`.
- Tras el rechazo, el cliente elige devolución a su cargo (`RETURN`) o reciclaje sin pago (`RECYCLE`). La selección se registra en `dispositions`. Si no responde durante 7 días desde el rechazo, Orders registra `RECYCLE` automáticamente. La devolución se registra como destino pendiente; su logística/cobro quedan fuera de HU-018.

## Migración

`database/07-orders-hu018-adjustment-resolution.sql` agrega el plazo y destino de resolución, amplía los tipos de `dispositions` y crea un índice para el proceso de vencimiento. Está montada en `docker-compose.yml` para bases nuevas. Para una base Orders ya existente, aplicarla una vez desde la raíz del proyecto:

```sh
docker exec -i reecicla-orders-db psql -v ON_ERROR_STOP=1 --single-transaction \
  -U reecicla_user -d reecicla_orders_db \
  < reecicla-backend/database/07-orders-hu018-adjustment-resolution.sql
```

Después, reconstruir los servicios:

```sh
docker compose up -d --build orders-service quotation-service
```
