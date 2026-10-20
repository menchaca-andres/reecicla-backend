# HU-022: Ver reportes del negocio

Rama: `feat/HU22` en `reecicla-backend` y `reecicla-frontend` (sin merge a `main`).
Sprint 4 · Módulo **Reporting** · Prioridad Should · 5 pts.

## Historia

Como administrador del tenant, quiero ver reportes del negocio (cotizaciones, órdenes por estado, pagos y destino de los equipos) para tomar decisiones con datos.

El documento oficial (`docs/Reecicla definitivo.pdf`, secciones 4.2, 5.2 y 8) define a Reporting como un módulo con **read model propio alimentado por eventos**, sin lecturas directas a bases ajenas. Por eso esta HU agrega un microservicio y una base nuevos.

## Criterios de aceptación

| CA | Descripción | Cómo se cumple |
|----|-------------|----------------|
| CA-01 Acceso | Solo `TENANT_ADMIN`. Sin token o token inválido: 401. Otro rol (incluido `SUPER_ADMIN`, que no pertenece a un negocio): 403. Validado en el backend. | `authMiddleware.ts` + `authorizeRoles('TENANT_ADMIN')` |
| CA-02 Aislamiento | El reporte solo contiene datos del `tenant_id` del JWT; un token de otro negocio sobre `/recicla/{slug}` recibe 403. | Todas las consultas filtran por `tenant_id`; se compara el `x-tenant-id` del gateway con el token |
| CA-03 Cotizaciones | Total, por estado (`ANONYMOUS`, `PENDING`, `ACCEPTED`, `REJECTED`, `EXPIRED`), por tipo (inicial/ajustada), tasa de aceptación, monto cotizado y aceptado, y los tipos de equipo más cotizados. | `report_quotes` + `buildReportSummary` |
| CA-04 Órdenes por estado | Estado actual de todas las órdenes y órdenes creadas en el periodo. | `report_orders` |
| CA-05 Pagos | Completados (cantidad y monto), fallidos y desglose por método (`BANK_TRANSFER`, `CHECK`). | `report_payments` |
| CA-06 Destino | Equipos con destino final: reventa (`RESALE`), reciclaje (`RECYCLE`) y devolución al cliente (`RETURN`, de HU-018/HU-025). | `report_dispositions` |
| CA-07 Periodo | `?from=AAAA-MM-DD&to=AAAA-MM-DD` inclusivos (UTC). Sin fechas: últimos 30 días. `from > to`, formato o fecha imposible, o más de 366 días: 400. | `reportPeriod.ts` |
| CA-08 Fuente por eventos | El read model se llena solo con eventos; idempotente (`processed_events`) y tolerante a eventos fuera de orden (`last_changed_at`). | `eventConsumer.ts` + `reportModel.ts` |
| CA-09 Sin datos | Responde 200 con ceros y la UI muestra un mensaje, no un error. | `buildReportSummary` |
| CA-10 Frescura | Se muestra la fecha del último evento procesado del negocio. | `last_event_at` |
| CA-11 Exportar | Descarga CSV (`seccion,metrica,valor`) del mismo periodo, protegido contra inyección de fórmulas. | `GET /summary.csv` |

Decisiones de cálculo (para que nadie se sorprenda con los números):

- Montos y tasa de aceptación de cotizaciones se calculan solo con cotizaciones **iniciales**. La ajustada es una re-cotización de la misma orden y sumarla duplicaría el monto. Tasa = iniciales aceptadas / iniciales creadas en el periodo.
- Cotizaciones y órdenes entran al periodo por su **fecha de creación**; pagos por `paid_at`/`failed_at`; destino por `completed_at`.
- "Órdenes por estado actual" no depende del periodo: es la foto de todas las órdenes del negocio.
- Los montos se agrupan por moneda (`{ "BOB": 900 }`).

## Tareas y subtareas (formato plantilla)

### T1_HU22 Diseñar read model y contratos de eventos
- ST1.1 Revisar en el documento oficial qué pide Reporting (secciones 4.2, 5.2, 8).
- ST1.2 Inventariar los eventos que ya existían: `payment.completed`, `payment.failed`, `disposition.completed`.
- ST1.3 Detectar los que faltaban: creación/rechazo/vencimiento de cotizaciones y creación/cambios de estado de órdenes.
- ST1.4 Definir los eventos nuevos `quote.status.changed` y `order.status.changed` (payload abajo).
- ST1.5 Definir las tablas del read model y las métricas de cada CA.

### T2_HU22 Publicar los eventos faltantes (Quotation y Orders)
- ST2.1 `services/quotation/db/12-quote-status-events.sql`: trigger `AFTER INSERT OR UPDATE OF status ON quotes` que escribe `QuoteStatusChanged` en `quote_event_outbox`.
- ST2.2 Mapear `QuoteStatusChanged -> quote.status.changed` en `quoteOutbox.ts`.
- ST2.3 `database/09-orders-status-events.sql`: trigger `AFTER INSERT ON order_status_history` que escribe `OrderStatusChanged` en `domain_event_outbox` (el dispatcher de Orders ya publica por `routing_key`; no hubo que tocar código).
- ST2.4 Backfill en ambos scripts para publicar los datos que ya existían.
- ST2.5 Usar `clock_timestamp()` en `changed_at`: `DISPOSED` y `CLOSED` se registran en la misma transacción y con `NOW()` empatarían.

### T3_HU22 Persistencia del read model
- ST3.1 `services/reporting/db/01-reporting-migration.sql` con `processed_events`, `report_quotes`, `report_orders`, `report_payments`, `report_dispositions`.
- ST3.2 Índices por `(tenant_id, fecha)` para las consultas del periodo.
- ST3.3 `config/db.ts` con el pool de `pg`.

### T4_HU22 Consumidor de eventos (proyecciones)
- ST4.1 Cola durable `reporting.events.queue` enlazada a las 5 routing keys en el exchange `reecicla.events`.
- ST4.2 `domain/projections.ts`: valida cada evento y lo traduce a una proyección (puro, testeable).
- ST4.3 `ReportModel.applyEvent`: `processed_events` + upsert en una transacción.
- ST4.4 Ignorar eventos viejos que lleguen fuera de orden (`WHERE last_changed_at <= EXCLUDED.last_changed_at`).
- ST4.5 Evento inválido: `ack` y se descarta con log; error de base: `nack` con reencolado (mismo criterio que Orders).

### T5_HU22 Lógica de negocio y endpoints
- ST5.1 `domain/reportPeriod.ts`: validación del periodo.
- ST5.2 `ReportModel.getAggregates`: 6 consultas agregadas por tenant en paralelo.
- ST5.3 `domain/reportSummary.ts`: arma el JSON del reporte y el CSV.
- ST5.4 `GET /api/reports/summary` y `GET /api/reports/summary.csv`.

### T6_HU22 Autorización y gateway
- ST6.1 Middleware JWT: 401 sin token o token inválido; 403 para `SUPER_ADMIN`, roles no permitidos o negocio distinto.
- ST6.2 Rutas en el gateway: `/recicla/:slug/reports`, `/recicla/:slug/api/reports` y `/api/reports`.

### T7_HU22 Infraestructura
- ST7.1 `services/reporting/Dockerfile` (multi-stage, igual que Payment).
- ST7.2 `reporting-db` y `reporting-service` en `docker-compose.yml`, con healthchecks.
- ST7.3 Montar `12-quote-status-events.sql` y `09-orders-status-events.sql` en sus bases.
- ST7.4 Sección REPORTING DB en `docs/script.sql` y `database/script.sql`.

### T8_HU22 Interfaz (frontend)
- ST8.1 Pestaña **Reportes** en el Navbar, solo para `TENANT_ADMIN`.
- ST8.2 `features/reportes/ReportsDashboard`: filtro desde/hasta y atajos de 7, 30 y 90 días.
- ST8.3 Tarjetas KPI: cotizaciones y tasa de aceptación, órdenes creadas, pagado a clientes, equipos con destino.
- ST8.4 Barras de cotizaciones por estado, órdenes por estado actual y destino; tablas de pagos por método y tipos de equipo más cotizados.
- ST8.5 Mensaje de sin datos, errores, fecha del último evento y botón **Exportar CSV**.
- ST8.6 `ApiService.getReportSummary` y `ApiService.downloadReportCsv`; tipo `ReportSummary`.

### T9_HU22 Pruebas
- ST9.1 Unitarias de proyecciones (contrato de cada evento, rechazos).
- ST9.2 Unitarias del periodo (default, rangos, formatos inválidos).
- ST9.3 Unitarias del resumen y CSV (ceros, tasas, montos solo iniciales, escape y fórmulas).
- ST9.4 Integración con PostgreSQL (idempotencia, fuera de orden, flujo completo, aislamiento por tenant).
- ST9.5 E2E con docker compose (autorización, periodo, cotizaciones por la API real, triggers, pagos, destino, CSV, aislamiento).

## Contratos de eventos nuevos

Los dos usan el sobre estándar (`event_id`, `correlation_id`, `tenant_id`, `event_type`, `timestamp`, `payload`) y el exchange `reecicla.events`. Ningún consumidor existente los escucha (todas las colas usan routing keys exactas), así que no afectan a otros servicios.

`quote.status.changed` (tipo `QuoteStatusChanged`, `correlation_id` = `quote_id`). Se emite al crear la cotización y en cada cambio de estado, incluido el vencimiento masivo del job:

```json
{
  "quote_id": "uuid", "quote_type": "INITIAL", "parent_quote_id": null,
  "previous_status": "PENDING", "status": "ACCEPTED",
  "device_type_id": "uuid", "device_type_name": "Refrigerador",
  "final_price": 850.5, "currency": "BOB",
  "quote_created_at": "2026-10-19T12:00:00Z", "changed_at": "2026-10-19T12:05:00Z"
}
```

`order.status.changed` (tipo `OrderStatusChanged`, `correlation_id` = `order_id`). Se emite al crear la orden (`previous_status: null`) y en cada cambio real de estado:

```json
{
  "order_id": "uuid", "order_number": "ORD-00000001",
  "previous_status": "PAID", "status": "DISPOSED",
  "device_type_id": "uuid", "device_type_name": "Refrigerador",
  "quoted_price": 1000, "final_price": 900, "currency": "BOB",
  "order_created_at": "2026-10-19T12:00:00Z", "changed_at": "2026-10-19T13:00:00Z"
}
```

También consume, sin cambios: `payment.completed`, `payment.failed` (HU-019/020) y `disposition.completed` (HU-025).

## API

```http
GET /recicla/{slug}/api/reports/summary?from=2026-10-01&to=2026-10-31
GET /recicla/{slug}/api/reports/summary.csv?from=2026-10-01&to=2026-10-31
Authorization: Bearer <token de TENANT_ADMIN>
```

Respuestas: `200` reporte, `400` periodo inválido, `401` sin token o token inválido, `403` rol no permitido o negocio distinto, `500` error interno.

Ejemplo de respuesta (resumida, tomada de la prueba e2e):

```json
{
  "tenant_id": "00000000-0000-0000-0000-000000000001",
  "period": { "from": "2026-09-20", "to": "2026-10-19" },
  "last_event_at": "2026-10-20T01:42:14.524Z",
  "quotes": {
    "total": 3,
    "by_status": { "ANONYMOUS": 1, "PENDING": 0, "ACCEPTED": 0, "REJECTED": 1, "EXPIRED": 1 },
    "by_type": { "INITIAL": 3, "ADJUSTED": 0 },
    "acceptance_rate": 0,
    "quoted_amount": { "BOB": 2930 },
    "accepted_amount": {},
    "by_device_type": [{ "device_type_name": "Refrigerador", "total": 3, "accepted": 0 }]
  },
  "orders": { "created_in_period": 1, "by_status_in_period": { "CLOSED": 1 }, "current_by_status": { "CLOSED": 1 } },
  "payments": { "completed": 1, "failed": 1, "completed_amount": { "BOB": 900 },
                "by_method": { "BANK_TRANSFER": { "completed": 1, "failed": 1, "amount": { "BOB": 900 } } } },
  "dispositions": { "total": 1, "by_type": { "RESALE": 1, "RECYCLE": 0, "RETURN": 0 } }
}
```

## Microservicio `reporting` (nuevo)

| Dato | Valor |
|------|-------|
| Carpeta | `reecicla-backend/services/reporting` |
| Contenedor | `reecicla-reporting-service` |
| Puerto interno | 3007 (no publicado; se llega por el gateway) |
| Base de datos | `reecicla_reporting_db`, contenedor `reecicla-reporting-db`, `127.0.0.1:5438` |
| Variables | `PORT`, `DATABASE_URL`, `RABBITMQ_URL`, `JWT_SECRET` (obligatoria) |
| Healthcheck | `GET /health` responde 200 solo cuando el consumidor de eventos está escuchando |
| Stack | Node 20, TypeScript, Express, `pg`, `amqplib`, `jsonwebtoken` (igual que Payment) |

```
services/reporting/
├── Dockerfile
├── .env.example
├── db/01-reporting-migration.sql
├── src/
│   ├── index.ts
│   ├── config/db.ts
│   ├── controllers/reportController.ts
│   ├── domain/projections.ts      (evento -> proyección, validación)
│   ├── domain/reportPeriod.ts     (from/to)
│   ├── domain/reportSummary.ts    (JSON del reporte y CSV)
│   ├── messaging/eventConsumer.ts (cola reporting.events.queue)
│   ├── middlewares/authMiddleware.ts
│   ├── models/reportModel.ts      (upserts idempotentes y agregaciones)
│   ├── routes/reportRoutes.ts
│   └── types/reporting.ts
└── tests/
    ├── projections.test.cjs
    ├── reportPeriod.test.cjs
    ├── reportSummary.test.cjs
    └── reporting.integration.test.cjs
```

## Todos los archivos tocados

Backend (`reecicla-backend`, rama `feat/HU22`):

| Archivo | Cambio |
|---------|--------|
| `services/reporting/**` | Nuevo microservicio completo |
| `services/quotation/db/12-quote-status-events.sql` | Nuevo: trigger + backfill de `QuoteStatusChanged` |
| `services/quotation/src/messaging/quoteOutbox.ts` | +1 línea: routing key `quote.status.changed` |
| `database/09-orders-status-events.sql` | Nuevo: trigger + backfill de `OrderStatusChanged` |
| `services/gateway/src/index.ts` | `REPORTING_SERVICE_URL` y rutas `/reports` |
| `docs/script.sql`, `database/script.sql` | Sección REPORTING DB |
| `services/catalog/db/05-devices-migration.sql` | Fix previo (no es de HU-022): `JOIN (VALUES …)` sin `ON` → `CROSS JOIN`. Sin esto `catalog-db` no arranca con un volumen nuevo |

Frontend (`reecicla-frontend`, rama `feat/HU22`):

| Archivo | Cambio |
|---------|--------|
| `src/features/reportes/components/ReportsDashboard.tsx` | Nuevo: pantalla de reportes |
| `src/features/reportes/ReportsDashboard.module.css` | Nuevo: estilos |
| `src/features/reportes/index.ts` | Nuevo: export |
| `src/services/api.ts` | `getReportSummary`, `downloadReportCsv`, servicio `reports` |
| `src/types/index.ts` | Tipo `ReportSummary` |
| `src/App.tsx` | Pestaña `reportes` (solo `TENANT_ADMIN`) |
| `src/components/Navbar/Navbar.tsx` | Botón **Reportes** |

`docker-compose.yml` (carpeta `Programa`, fuera de los repos). Lo que agrega HU-022:

```yaml
  # en quotation-db -> volumes
      - ./reecicla-backend/services/quotation/db/12-quote-status-events.sql:/docker-entrypoint-initdb.d/12-quote-status-events.sql
  # en orders-db -> volumes
      - ./reecicla-backend/database/09-orders-status-events.sql:/docker-entrypoint-initdb.d/09-orders-status-events.sql

  reporting-db:
    image: postgres:16-alpine
    container_name: reecicla-reporting-db
    environment:
      POSTGRES_DB: reecicla_reporting_db
      POSTGRES_USER: reecicla_user
      POSTGRES_PASSWORD: reecicla_password
    ports:
      - "127.0.0.1:5438:5432"
    volumes:
      - ./reecicla-backend/services/reporting/db/01-reporting-migration.sql:/docker-entrypoint-initdb.d/01-reporting-migration.sql
      - reporting_db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U reecicla_user -d reecicla_reporting_db"]
      interval: 5s
      timeout: 5s
      retries: 12

  reporting-service:
    build:
      context: ./reecicla-backend/services/reporting
      dockerfile: Dockerfile
    container_name: reecicla-reporting-service
    restart: on-failure
    environment:
      PORT: 3007
      DATABASE_URL: postgres://reecicla_user:reecicla_password@reporting-db:5432/reecicla_reporting_db
      RABBITMQ_URL: amqp://reecicla:reecicla_password@rabbitmq:5672
      JWT_SECRET: ${JWT_SECRET:-}
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:3007/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 10s
    depends_on:
      reporting-db:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy

  # en gateway -> environment
      REPORTING_SERVICE_URL: http://reporting-service:3007
  # en gateway -> depends_on
      - reporting-service

volumes:
  reporting_db_data:
```

El compose completo y probado también trae los healthchecks de todas las bases y de RabbitMQ (con `nc -z`, porque usar `rabbitmq-diagnostics` como healthcheck rompe el permiso de `.erlang.cookie`) y las migraciones que faltaban en la versión que circulaba (quotation 07, 08 y 10; catalog `05-processed-events-tenant.sql`).

## Cómo ejecutarlo paso a paso

1. Cambiar ambos repos a la rama: `git checkout feat/HU22`.
2. Usar el `docker-compose.yml` actualizado (sección anterior).
3. Levantar desde cero. Las migraciones de init de Postgres solo corren con un volumen nuevo, y esto **borra los datos locales**:
   ```sh
   docker compose down -v
   docker compose up -d --build
   ```
4. Verificar que todo quedó sano con `docker compose ps`: las bases, RabbitMQ y `reporting-service` deben aparecer como `healthy`.
5. Crear un `TENANT_ADMIN` desde `/admin` (superadmin `superadmin@reecicla.com` / `superadmin123`), iniciar sesión en `http://localhost:5173/recicla/demo` y abrir **Reportes**.

Si alguien no quiere borrar sus datos, puede aplicar los scripts a mano sobre las bases existentes. Primero hay que levantar `reporting-service` una vez, para que exista la cola y no se pierdan los eventos del backfill:

```sh
docker compose up -d --build reporting-db reporting-service
docker exec -i reecicla-quotation-db psql -U reecicla_user -d reecicla_quotation_db < reecicla-backend/services/quotation/db/12-quote-status-events.sql
docker exec -i reecicla-orders-db psql -U reecicla_user -d reecicla_orders_db < reecicla-backend/database/09-orders-status-events.sql
docker compose up -d --build quotation-service gateway frontend
```

Los pagos y destinos registrados **antes** de levantar Reporting no aparecen: esos eventos se publicaron cuando todavía no existía la cola. Con volúmenes nuevos esto no pasa, porque se empieza vacío.

## Pruebas

```sh
cd reecicla-backend/services/reporting
npm install
npm test                                           # unitarias
RUN_REPORTING_INTEGRATION=1 \
DATABASE_URL=postgres://reecicla_user:reecicla_password@localhost:5438/reecicla_reporting_db \
JWT_SECRET=x npm test                              # + integración (requiere reporting-db arriba)
```

Resultados (19/10/2026):

| Prueba | Resultado |
|--------|-----------|
| Unitarias (`projections`, `reportPeriod`, `reportSummary`) | 17/17 OK |
| Integración con PostgreSQL | 2/2 OK (19/19 en total) |
| `npm run build` y `oxlint` en el frontend | OK; quedan 2 advertencias de oxlint (`set-state-in-effect`, `purity`) del mismo tipo que las que ya existen en otros componentes |
| Stack completo desde cero (`down -v` + `up --build`) | 18 contenedores arriba; bases, RabbitMQ y `reporting-service` en `healthy`; migraciones sin errores (quotation 11, orders 8, reporting 1, catalog 6) |
| E2E contra el gateway | 17/17 verificaciones OK |

El E2E cubrió: 401 sin token o con token inválido, 403 para `INSPECTOR` y `SUPER_ADMIN`; 400 por periodo inválido; reporte vacío con ceros; 3 cotizaciones creadas y 1 rechazada por la API real; vencimiento masivo por `UPDATE` (trigger); una orden recorriendo todos los estados hasta `CLOSED` (con `DISPOSED`/`CLOSED` en la misma transacción); un pago fallido y otro completado; destino `RESALE`; `last_event_at`; descarga del CSV; y aislamiento con un segundo negocio (reporte vacío y 403 sobre el slug ajeno).

En la parte de órdenes, pagos y destino el E2E escribió directamente en la base de cada servicio en lugar de recorrer el flujo con la UI. Igual pasó por los triggers, los outbox, los dispatchers reales, RabbitMQ y el consumidor de Reporting.

## Limitaciones y avisos

- Fechas del periodo en UTC: un evento a las 21:00 de Bolivia (01:00 UTC del día siguiente) cuenta para el día siguiente.
- El estado de una cotización ajustada (`ADJUSTED`) se cuenta en `by_status` y `by_type`, pero no en montos ni tasa (ver decisiones de cálculo).
## Arreglo incluido en Orders (encontrado durante el E2E)

El consumidor de pagos de Orders (`orders.payment-completed.queue`) hacía `nack` con reencolado **infinito** en dos casos que nunca se resuelven reintentando:

1. Eventos que no pasan la validación (`validatePaymentCompletedEvent` / `validatePaymentFailedEvent`), porque estaban en el mismo `try` que el procesamiento.
2. Violaciones de reglas de negocio: orden inexistente, monto o moneda distintos al aceptado, orden que ya no está en `PAYMENT_PENDING` (o `PAID` para un fallo).

En el E2E, un solo `payment.failed` sobre una orden ya cerrada generó más de 5.000 reintentos en el log.

Cambios:

| Archivo | Cambio |
|---------|--------|
| `services/orders/src/domain/paymentEventRejection.ts` | Nuevo: `PaymentEventRejectedError` y `classifyPaymentEventError` (`discard` / `retry`) |
| `services/orders/src/models/orderModel.ts` | Las 4 violaciones de regla de negocio de `processPaymentCompletedEvent` y `processPaymentFailedEvent` lanzan `PaymentEventRejectedError` |
| `services/orders/src/messaging/eventConsumer.ts` | Validación separada (inválido: `ack` y log); rechazo de negocio: `ack` y log; el resto (base caída, la orden cambió de estado en paralelo) se sigue reintentando |
| `services/orders/tests/paymentEventRejection.test.cjs` | Nuevo: clasificación de errores |

Verificado: `npm test` en orders (26 OK, 5 de integración omitidas) y el mismo E2E, que pasó de más de 5.000 reintentos a 0 (cada evento inválido se descarta una sola vez con su motivo en el log).
