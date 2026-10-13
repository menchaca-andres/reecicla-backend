# HU-017: Ajuste de cotización después de la inspección

## Flujo implementado

Al completar una inspección, Inspection publica `InspectionCompleted` con el identificador de la cotización original, la condición real, el resultado y la justificación del inspector. Orders conserva el `quote_id` al registrar la recepción y lo propaga en `DeviceReceived`.

Quotation consume el evento de forma idempotente:

- Si la condición real difiere de la declarada, crea una cotización `ADJUSTED` pendiente, vinculada con `parent_quote_id`, usando la regla de precios guardada en la cotización original. Registra las condiciones, importes, resultado y justificación en `quote_adjustment_audits`.
- Si la condición coincide, conserva la cotización original aceptada y registra `UNCHANGED` en la auditoría.

La cotización ajustada y su justificación se presentan en el seguimiento del pedido y en el historial del cliente. Los endpoints de aceptación y rechazo de cotizaciones iniciales no procesan cotizaciones `ADJUSTED`; la respuesta a ese ajuste queda para HU-018.

## Migraciones

Las migraciones nuevas son:

- `services/inspection/db/03-inspection-quote-link.sql`
- `services/quotation/db/11-adjusted-quotes.sql`

El `docker-compose.yml` del proyecto las monta para inicializar bases de datos vacías. En bases ya existentes, aplicar cada archivo contra su base correspondiente desde la raíz del proyecto:

```sh
docker exec -i reecicla-inspection-db psql -v ON_ERROR_STOP=1 --single-transaction \
  -U reecicla_user -d reecicla_inspection_db \
  < reecicla-backend/services/inspection/db/03-inspection-quote-link.sql

docker exec -i reecicla-quotation-db psql -v ON_ERROR_STOP=1 --single-transaction \
  -U reecicla_user -d reecicla_quotation_db \
  < reecicla-backend/services/quotation/db/11-adjusted-quotes.sql
```

Después de aplicar las migraciones, reconstruir y reiniciar los servicios:

```sh
docker compose up -d --build inspection-service orders-service quotation-service
```

Las recepciones registradas antes de esta versión pueden tener `quote_id` nulo en Inspection. La finalización de esas inspecciones ahora devuelve `409` en vez de completar sin producir un ajuste. Para cada caso, obtener `tenant_id`, `id` y `quote_id` desde `orders` en `reecicla_orders_db` y completar el vínculo en la base de Inspection:

```sql
UPDATE received_devices
SET quote_id = '<quote_id>'::uuid
WHERE tenant_id = '<tenant_id>'::uuid
  AND order_id = '<order_id>'::uuid
  AND quote_id IS NULL;
```
