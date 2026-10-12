# Correcciones de arranque con Docker Compose

**Fecha:** 2026-10-12
**Rama (repo raíz):** `feat/HU11`
**Alcance:** solo correcciones para que el proyecto levante sin errores. No se agregó ninguna funcionalidad nueva ni se modificó código de los servicios o del frontend.

## Resumen

Al levantar el proyecto con `docker compose up -d --build`, los 11 contenedores quedaban en estado "Up", pero los logs mostraban dos errores reales:

1. `orders-service` fallaba cada pocos segundos porque no existía la tabla `domain_event_outbox`.
2. `quotation-service`, `catalog-service` y `orders-service` se quedaban sin conexión a RabbitMQ, es decir, sin consumir ni publicar eventos.

Ambos se corrigieron en `docker-compose.yml` (archivo del repo raíz, fuera de `reecicla-backend`). Además se aplicó una migración a mano sobre la base de datos local de orders.

## Error 1: falta la tabla `domain_event_outbox` en orders

### Síntoma

```
[Orders] No se pudieron publicar eventos pendientes: error: relation "domain_event_outbox" does not exist
```

### Causa

`services/orders/src/messaging/eventPublisher.ts` y `services/orders/src/models/orderModel.ts` leen y escriben en `domain_event_outbox`. La tabla se crea en `database/05-orders-domain-event-outbox.sql`, pero el compose solo montaba las migraciones 03 y 04 en `orders-db`, así que la 05 nunca se ejecutaba.

### Corrección

Se montó la migración en `orders-db`:

```yaml
- ./reecicla-backend/database/05-orders-domain-event-outbox.sql:/docker-entrypoint-initdb.d/05-orders-domain-event-outbox.sql
```

Esa misma migración también crea el trigger `trg_orders_status_history` y la función `record_order_status_change()`, que tampoco existían en la base.

## Error 2: los servicios arrancan antes de que RabbitMQ esté listo

### Síntoma

```
Error al conectar a RabbitMQ. Reintentos restantes: 0...
[Quotation Service] Error al suscribirse a RabbitMQ: Error: connect ECONNREFUSED 172.19.0.4:5672
[Catalog Service] DB o consumidor de eventos no pudo iniciar: Error: connect ECONNREFUSED 172.19.0.4:5672
```

Los contenedores seguían "Up", por lo que el fallo no se ve en `docker compose ps`; solo en los logs.

### Causa

RabbitMQ tardó unos 98 segundos en aceptar conexiones en el arranque medido. Los servicios reintentan mucho menos tiempo y luego se rinden:

| Servicio  | Reintentos | Espera total aproximada |
|-----------|------------|-------------------------|
| auth      | 5 × 3 s    | 15 s                    |
| quotation | 5 × 3 s    | 15 s                    |
| orders    | 6 × 3 s    | 18 s                    |
| catalog   | 12 × 3 s   | 36 s                    |

El compose usaba `depends_on` simple, que solo espera a que el contenedor arranque, no a que el servicio esté listo. Además, `auth`, `quotation` y `catalog` ni siquiera declaraban dependencia de `rabbitmq`.

### Corrección

- Healthcheck en RabbitMQ (`rabbitmq-diagnostics -q check_port_connectivity`).
- Healthcheck en las cuatro bases de datos (`pg_isready`).
- `auth-service`, `quotation-service`, `catalog-service` y `orders-service` ahora dependen de su base de datos y de `rabbitmq` con `condition: service_healthy`.

```yaml
rabbitmq:
  healthcheck:
    test: ["CMD", "rabbitmq-diagnostics", "-q", "check_port_connectivity"]
    interval: 10s
    timeout: 10s
    retries: 20
    start_period: 20s

orders-service:
  depends_on:
    orders-db:
      condition: service_healthy
    rabbitmq:
      condition: service_healthy
```

Efecto secundario esperado: el primer `docker compose up` tarda más (hasta un par de minutos), porque los servicios esperan a RabbitMQ.

## Paso manual para quien ya tenga los volúmenes creados

Postgres solo ejecuta los scripts de `docker-entrypoint-initdb.d` cuando el volumen está vacío. Si ya existe el volumen `orders_db_data`, montar la migración 05 no basta y el Error 1 seguirá apareciendo. Hay dos opciones:

**Opción A — aplicar la migración sin perder datos** (es idempotente; fue lo que se hizo en la máquina de Alan). Desde la carpeta que contiene `docker-compose.yml`, en PowerShell:

```powershell
Get-Content -Raw reecicla-backend/database/05-orders-domain-event-outbox.sql | docker exec -i reecicla-orders-db psql -v ON_ERROR_STOP=1 --single-transaction -U reecicla_user -d reecicla_orders_db
docker compose restart orders-service
```

**Opción B — recrear el volumen** (borra los datos locales de orders):

```powershell
docker compose down
docker volume rm programa_orders_db_data
docker compose up -d --build
```

## Verificación realizada

- `docker compose config` valida sin errores.
- Las 6 imágenes (auth, quotation, catalog, orders, gateway, frontend) construyen correctamente.
- Los 11 contenedores quedan arriba; las 4 bases de datos y RabbitMQ en estado `healthy`.
- Logs tras el reinicio:
  - quotation: `Escuchando cola [quotation.user.registered.queue] para patrón [auth.user.registered]`
  - catalog: `Escuchando cola [catalog.device-received.queue] para patrón [device.received]`
  - orders: `Escuchando orders.quote-accepted.queue para quote.accepted`
  - Sin errores nuevos en ningún servicio.
- Frontend responde 200 en `http://localhost:5173`.
- El gateway (`http://localhost:3000`) enruta a auth, catalog, quotation y orders; las rutas protegidas responden 401 sin token.
- Panel de RabbitMQ responde 200 en `http://localhost:15672`.

**No se probó** un flujo funcional completo con login (registro → cotización → aceptación → orden → recepción), para no crear datos en las bases locales.

## Observaciones detectadas y no corregidas

No impiden que el proyecto funcione en local; quedan anotadas para decidir en equipo.

- **URL del gateway fija en el frontend.** `reecicla-frontend/src/services/api.ts` tiene `const GATEWAY_URL = 'http://localhost:3000'`. Funciona en local, pero no si se despliega en otro host.
- **`services/orders/.env` no se usa en Docker.** Apunta a `localhost:5433` y `localhost:5672` (sirve para `npm run dev` fuera de Docker). En el compose, `orders-service` no usa `env_file`; sus variables están definidas directamente en `environment`. Es el único servicio configurado así.
- **`services/gateway/.env` no define `ORDERS_SERVICE_URL`.** Funciona porque el código tiene como valor por defecto `http://orders-service:3004`.
- **Reintentos cortos a RabbitMQ en el código.** Con los healthchecks ya no afecta al arranque, pero si RabbitMQ se cae con los servicios en marcha, estos no se reconectan solos pasado ese tiempo.
- **Las migraciones de orders están en `database/`**, mientras que las de auth, quotation y catalog están en `services/<servicio>/db/`. En `database/` también hay un `04-catalog-migration.sql` y un `script.sql` que el compose no usa.

## Cambios que ya estaban en `docker-compose.yml` antes de esta revisión

Estaban sin commitear y no forman parte de estas correcciones:

- `JWT_SECRET` añadido en `environment` de `catalog-service`.
- Cambio de formato en el comentario `# AMQP` del puerto de RabbitMQ.

## Estado de los cambios

- `docker-compose.yml`: modificado, **sin commit**.
- Base de datos local de orders: migración 05 aplicada a mano (no se borró ningún volumen ni dato).
- Código de `reecicla-backend` y `reecicla-frontend`: sin cambios.
