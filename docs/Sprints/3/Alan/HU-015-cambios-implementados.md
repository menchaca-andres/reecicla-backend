# HU-015 — Cambios implementados

**Fecha:** 2026-10-12
**Autor:** Alan Maldonado
**Ramas:** `feat/HU15` en `reecicla-backend` y `reecicla-frontend` (parten de `main` en `ac48707` y `69367e3`)
**Estado:** implementado y verificado en local. `feat/HU15` ya incluye `main` hasta el ADR-001 (`f1ebfc2` en backend, `8f2e5e7` en frontend). **Falta el merge de `feat/HU15` hacia `main`.**

> **Actualizado tras integrar `main` (ADR-001), 2026-10-12.** Las rutas del negocio van por `/recicla/{slug}/...`, el superadmin pasó a ser una sesión de plataforma que no entra a funciones de un negocio, y el compose necesita Mailpit, variables y migraciones nuevas. Todo eso ya está reflejado abajo; el detalle está en la [sección 11](#11-integración-con-main-adr-001).

La historia, sus criterios de aceptación y sus tareas están en [HU-015-registrar-inspeccion-con-checklist.md](HU-015-registrar-inspeccion-con-checklist.md). Este documento describe lo que quedó construido y lo que necesitas para seguir con HU-016, HU-017 y HU-018.

---

## 1. Lo primero que debes hacer al traer estos cambios

### 1.1 Actualiza tu `docker-compose.yml`

El `docker-compose.yml` **no está en el repo del backend ni en el del frontend**, así que no te llega por git. Aplica a mano los bloques de la [sección 7](#7-cambios-en-docker-composeyml).

### 1.2 Aplica las migraciones que tu base local no tiene

Postgres solo ejecuta los scripts de `docker-entrypoint-initdb.d` cuando el volumen está vacío. Si ya tenías los volúmenes creados, montar las migraciones no basta. Desde la carpeta que contiene `docker-compose.yml`, en PowerShell:

```powershell
$b = "reecicla-backend/services"
Get-Content -Raw $b/quotation/db/07-quotation-pricing-rules-granularity.sql | docker exec -i reecicla-quotation-db psql -v ON_ERROR_STOP=1 --single-transaction -U reecicla_user -d reecicla_quotation_db
Get-Content -Raw $b/quotation/db/08-fix-pricing-rules-unique-index.sql      | docker exec -i reecicla-quotation-db psql -v ON_ERROR_STOP=1 --single-transaction -U reecicla_user -d reecicla_quotation_db
Get-Content -Raw $b/catalog/db/05-processed-events-tenant.sql              | docker exec -i reecicla-catalog-db   psql -v ON_ERROR_STOP=1 --single-transaction -U reecicla_user -d reecicla_catalog_db
Get-Content -Raw $b/catalog/db/06-evaluation-rules-seed.sql                | docker exec -i reecicla-catalog-db   psql -v ON_ERROR_STOP=1 --single-transaction -U reecicla_user -d reecicla_catalog_db
Get-Content -Raw reecicla-backend/database/05-orders-domain-event-outbox.sql | docker exec -i reecicla-orders-db  psql -v ON_ERROR_STOP=1 --single-transaction -U reecicla_user -d reecicla_orders_db
```

Todas son idempotentes y no borran datos. La base de inspección es nueva, así que su migración corre sola.

### 1.3 Levanta todo

```powershell
docker compose up -d --build
```

Deben quedar **14 contenedores** arriba (los 13 de antes más Mailpit), con las 5 bases y RabbitMQ en `healthy`.

---

## 2. Errores previos que se corrigieron

No son parte de HU-015, pero impedían probarla. Estaban en `main`.

| # | Síntoma | Causa | Corrección |
|---|---------|-------|------------|
| 1 | No se puede crear ninguna cotización: `column "brand_id" does not exist` | Las migraciones 07 y 08 de Quotation no estaban montadas en el compose | Montadas en `quotation-db` |
| 2 | Catalog no procesa `DeviceReceived`; `last_received_at` nunca se actualiza (HU-014) | `05-processed-events-tenant.sql` de Catalog no estaba montada; a `processed_events` le faltaba `tenant_id` | Montada en `catalog-db` |
| 3 | No se puede crear un usuario `INSPECTOR`: siempre se crea `TENANT_ADMIN` | `AuthController.createAdmin` descartaba el campo `role` del body | Se pasa `role` al servicio (`services/auth/src/controllers/authController.ts`) |

Sobre el punto 3: los usuarios creados antes como "INSPECTOR" desde la pantalla de administradores son en realidad `TENANT_ADMIN`. Hay que crearlos de nuevo.

Los errores de arranque detectados antes (tabla `domain_event_outbox` y espera a RabbitMQ) están en [correcciones-arranque-docker-compose.md](correcciones-arranque-docker-compose.md).

---

## 3. Qué se construyó

### Microservicio `inspection` (nuevo)

| Dato | Valor |
|------|-------|
| Carpeta | `reecicla-backend/services/inspection` |
| Contenedor | `reecicla-inspection-service` |
| Puerto | 3005 |
| Base de datos | `reecicla_inspection_db` en `reecicla-inspection-db`, puerto host **5436** |
| Ruta en el Gateway | `/recicla/{slug}/inspections` (también `/recicla/{slug}/api/inspections` y `/api/inspections`) |
| Variables | `PORT`, `DATABASE_URL`, `RABBITMQ_URL`, `CATALOG_SERVICE_URL`, `JWT_SECRET` |

No usa `.env` en Docker: sus variables están en el compose. Para correrlo fuera de Docker, copia `.env.example` a `.env`.

Estructura, igual a la de `orders`:

```
services/inspection/
├── db/01-inspection-migration.sql
├── src/
│   ├── index.ts
│   ├── config/db.ts
│   ├── types/inspection.ts
│   ├── domain/         checklist.ts · deviceReceived.ts · errors.ts
│   ├── messaging/      eventConsumer.ts · eventPublisher.ts
│   ├── models/         receivedDeviceModel.ts · inspectionModel.ts
│   ├── clients/        catalogClient.ts
│   ├── services/       inspectionService.ts
│   ├── controllers/    inspectionController.ts
│   ├── routes/         inspectionRoutes.ts
│   └── middlewares/    authMiddleware.ts
└── tests/
    ├── checklist.test.cjs
    ├── deviceReceived.test.cjs
    ├── inspection.integration.test.cjs
    └── e2e/hu015-flow.mjs
```

### Otros cambios en el backend

- `services/gateway/src/index.ts`: rutas de inspección (con y sin slug) y variable `INSPECTION_SERVICE_URL`.
- `services/gateway/.env.example`: `INSPECTION_SERVICE_URL`.
- `services/auth/src/controllers/authController.ts`: corrección del rol (sección 2).
- `docs/script.sql` y `database/script.sql`: sección INSPECTION DB actualizada.

No se tocó `orders`, `catalog` ni `quotation`.

### Frontend

- `src/features/inspeccion/` (nuevo): `InspectionManager.tsx`, su CSS e `index.ts`.
- `src/services/api.ts`: `getPendingInspections`, `getInspectionChecklist`, `registerInspection`, `getInspections`, `getInspectionByOrder`.
- `src/types/index.ts`: tipos `PendingInspection`, `InspectionChecklist`, `RegisterInspectionInput`, `InspectionItem`, `Inspection`.
- `src/components/Navbar.tsx` y `src/App.tsx`: pestaña "Inspección".

La pestaña la ven `INSPECTOR` y `TENANT_ADMIN`. Solo `INSPECTOR` ve el botón "Inspeccionar"; el administrador consulta. La pestaña está en `src/components/Navbar/Navbar.tsx`, que es el Navbar que usa `main`.

---

## 4. Cómo funciona

```
Orders ──DeviceReceived──► Inspection ──GET evaluation-rules/active──► Catalog
(HU-014)  device.received      │
                               ├─ received_devices  (equipos por inspeccionar)
                               ├─ inspections + inspection_items
                               └─ InspectionRegistered ──► (nadie lo consume todavía)
                                  inspection.registered
```

1. Orders registra la recepción y publica `DeviceReceived`.
2. Inspection lo consume (cola `inspection.device-received.queue`) y guarda el equipo en `received_devices`. Es idempotente mediante `processed_events`.
3. El inspector abre la orden. Inspection pide a Catalog la regla de evaluación activa del tipo y devuelve la checklist.
4. El inspector envía las respuestas. Inspection vuelve a pedir la regla vigente, comprueba que la versión coincide, valida cada respuesta y guarda todo en una transacción.
5. En la misma transacción se guarda `InspectionRegistered` en el outbox; se publica al momento y, si RabbitMQ no responde, lo reintenta un temporizador cada 5 segundos.

### Decisiones tomadas

| Decisión | Motivo |
|----------|--------|
| Inspection no consulta a Orders; se alimenta de `DeviceReceived` | El documento oficial define ese evento como la entrada de Inspection, y evita acoplar los servicios |
| La checklist se pide a Catalog por REST | El inspector espera respuesta inmediata (sección 5.1 del documento oficial) |
| `tenant_id` y `user_id` salen del JWT | Igual que Orders. Si el Gateway inyecta `X-Tenant-ID` (ADR-001) y no coincide con el del token, se responde 403 |
| `inspections.result` es opcional | El resultado reventa/reciclaje pertenece a HU-016 |
| Se guarda `value` por ítem además de PASS/FAIL | La checklist de HU-008 tiene ítems `number`, `text` y `select`; PASS/FAIL solo aplica a `boolean` |
| La evidencia son referencias (URL o código), no archivos | El backlog pide "referencias de evidencia" y no hay almacenamiento de archivos |
| Una inspección por orden | La reinspección queda fuera de esta HU |
| Orders no cambia de estado | La orden sigue en `RECEIVED` hasta que HU-016 la pase a `INSPECTED` |

### Un equipo recibido antes de este cambio no aparece

Los `DeviceReceived` publicados antes de que existiera la cola de Inspection se perdieron. Para reenviarlos, ejecuta esto en la base de **Orders**; el publicador los vuelve a enviar en unos segundos y los consumidores ignoran los repetidos:

```sql
UPDATE domain_event_outbox SET published_at = NULL WHERE event_type = 'DeviceReceived';
```

---

## 5. Contrato de la API

Todas las rutas van por el Gateway (`http://localhost:3000`) y requieren `Authorization: Bearer <token>` de un usuario del negocio. El frontend usa el prefijo `/recicla/{slug}/api/inspections`; las rutas de la tabla también responden con ese prefijo y con `/recicla/{slug}/inspections`. Una sesión de plataforma (`SUPER_ADMIN`) recibe 403.

| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| GET | `/api/inspections/pending` | INSPECTOR, TENANT_ADMIN | Equipos recibidos sin inspección |
| GET | `/api/inspections/orders/:orderId/checklist` | los mismos | Checklist vigente del tipo de la orden |
| POST | `/api/inspections` | **solo INSPECTOR** | Registra la inspección |
| GET | `/api/inspections/orders/:orderId` | INSPECTOR, TENANT_ADMIN | Inspección de una orden, con ítems |
| GET | `/api/inspections` | los mismos | Inspecciones del tenant, sin ítems |

### `GET /api/inspections/orders/:orderId/checklist` → 200

```json
{
  "order_id": "da4360ad-...",
  "device_type_id": "5f0c...",
  "device_type_name": "Horno de Microondas",
  "received_at": "2026-10-12T16:52:38.639Z",
  "evaluation_rule_id": "3c1a...",
  "evaluation_rule_version": 1,
  "checklist": [
    { "id": "heating_works", "label": "¿Calienta adecuadamente agua/alimentos?", "type": "boolean", "required": true },
    { "id": "cosmetic_condition", "label": "Estado estético general (1-10)", "type": "number", "required": true }
  ]
}
```

### `POST /api/inspections`

```json
{
  "order_id": "da4360ad-...",
  "evaluation_rule_id": "3c1a...",
  "evaluation_rule_version": 1,
  "actual_condition": "damaged",
  "observations": "Golpe en la puerta lateral.",
  "evidence_refs": ["https://fotos.example/ord-9/general.jpg"],
  "items": [
    { "criterion_key": "heating_works", "value": true },
    { "criterion_key": "cosmetic_condition", "value": 4,
      "observation": "Abolladura visible", "evidence_refs": ["foto-puerta-01"] }
  ]
}
```

- `actual_condition`: `working`, `damaged` o `broken` (el mismo vocabulario que la condición declarada al cotizar).
- `value`: `true`/`false` para `boolean`, número para `number`, texto para `text`, una de las `options` para `select`.
- `observation` y `evidence_refs` son opcionales. Máximo 10 referencias de 500 caracteres; observaciones de hasta 2000.
- `evaluation_rule_id` y `evaluation_rule_version` son los que devolvió la checklist.

Respuesta 201: `{ "message": "Inspección registrada correctamente.", "inspection": { ... , "items": [ ... ] } }`

### Errores

| Código | Cuándo |
|--------|--------|
| 400 | Datos inválidos. Incluye `details` con un mensaje por cada problema. También si `order_id` no es un UUID |
| 401 | Sin token |
| 403 | Token inválido, rol sin permiso, sesión de plataforma, o el token no pertenece al negocio de la URL |
| 404 | No hay un equipo recibido para esa orden en el tenant, o la orden no tiene inspección |
| 409 | La orden ya tiene inspección; la checklist cambió de versión; o el tipo no tiene checklist vigente |
| 502 | No se pudo consultar a Catalog |

---

## 6. Contrato de eventos

Exchange `reecicla.events` (topic), con el sobre común de TE-02.

### Consumido: `DeviceReceived` (`device.received`)

Publicado por Orders. Cola `inspection.device-received.queue`. Un evento inválido se descarta; uno repetido se ignora.

### Publicado: `InspectionRegistered` (`inspection.registered`)

```json
{
  "event_id": "…",
  "correlation_id": "<order_id>",
  "tenant_id": "…",
  "event_type": "InspectionRegistered",
  "timestamp": "2026-10-12T16:52:40.000Z",
  "payload": {
    "inspection_id": "425531b6-...",
    "order_id": "da4360ad-...",
    "device_type_id": "…",
    "evaluation_rule_id": "…",
    "evaluation_rule_version": 1,
    "actual_condition": "damaged",
    "inspected_by_user_id": "…",
    "inspected_at": "2026-10-12T16:52:40.000Z"
  }
}
```

Hoy no lo consume nadie. `correlation_id` es el `order_id`, igual que en `DeviceReceived`.

---

## 7. Cambios en `docker-compose.yml`

**Base de datos nueva** (antes de `# Microservicios Backend`):

```yaml
  inspection-db:
    image: postgres:16-alpine
    container_name: reecicla-inspection-db
    environment:
      POSTGRES_DB: reecicla_inspection_db
      POSTGRES_USER: reecicla_user
      POSTGRES_PASSWORD: reecicla_password
    ports:
      - "5436:5432"
    volumes:
      - ./reecicla-backend/services/inspection/db/01-inspection-migration.sql:/docker-entrypoint-initdb.d/01-inspection-migration.sql
      - inspection_db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U reecicla_user -d reecicla_inspection_db"]
      interval: 5s
      timeout: 5s
      retries: 12
```

**Servicio nuevo** (después de `orders-service`):

```yaml
  inspection-service:
    build:
      context: ./reecicla-backend/services/inspection
      dockerfile: Dockerfile
    container_name: reecicla-inspection-service
    environment:
      PORT: 3005
      DATABASE_URL: postgres://reecicla_user:reecicla_password@inspection-db:5432/reecicla_inspection_db
      RABBITMQ_URL: amqp://reecicla:reecicla_password@rabbitmq:5672
      CATALOG_SERVICE_URL: http://catalog-service:3003
      JWT_SECRET: ${JWT_SECRET:-default_jwt_secret_reecicla}
    ports:
      - "3005:3005"
    depends_on:
      inspection-db:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy
```

**En `gateway` → `depends_on`**, agregar `- inspection-service`.

**En `volumes:`**, agregar `inspection_db_data:`.

**Migraciones que faltaban**, agregar a los `volumes` de cada base:

```yaml
  # quotation-db
      - ./reecicla-backend/services/quotation/db/07-quotation-pricing-rules-granularity.sql:/docker-entrypoint-initdb.d/07-quotation-pricing-rules-granularity.sql
      - ./reecicla-backend/services/quotation/db/08-fix-pricing-rules-unique-index.sql:/docker-entrypoint-initdb.d/08-fix-pricing-rules-unique-index.sql
  # catalog-db
      - ./reecicla-backend/services/catalog/db/05-processed-events-tenant.sql:/docker-entrypoint-initdb.d/05-processed-events-tenant.sql
  # orders-db
      - ./reecicla-backend/database/05-orders-domain-event-outbox.sql:/docker-entrypoint-initdb.d/05-orders-domain-event-outbox.sql
```

Los healthchecks de las demás bases y de RabbitMQ están en [correcciones-arranque-docker-compose.md](correcciones-arranque-docker-compose.md).

---

## 8. Pruebas

Desde `reecicla-backend/services/inspection`:

| Tipo | Comando | Resultado |
|------|---------|-----------|
| Unitarias | `npm test` | 16 de 16 |
| Integración (necesita `inspection-db` arriba) | `$env:RUN_INSPECTION_INTEGRATION='1'; npm test` | 21 de 21 (16 + 5) |
| Punta a punta (necesita todo arriba) | `node tests/e2e/hu015-flow.mjs` | 27 verificaciones correctas |

- **Unitarias:** validación de la checklist por tipo de ítem, obligatorios, claves desconocidas y repetidas, condición real, límites de evidencia y validación de `DeviceReceived`.
- **Integración:** evento repetido no duplica; el registro guarda ítems y outbox; segunda inspección rechazada; un fallo no deja datos a medias; aislamiento entre tenants. Limpian lo que crean.
- **Punta a punta:** recorre cotización → orden → envío → recepción → inspección por el Gateway, y comprueba 401, 403, 404, 409 y 400. **Crea datos reales** en las bases locales: un inspector, un administrador del negocio, un cliente, una cotización, una orden y una inspección por corrida.

### Lo que no se probó

- **La pantalla en el navegador.** El frontend compila y el contenedor responde, pero nadie hizo clic en el formulario todavía.
- **Cambio real de versión de checklist.** El 409 se probó enviando un número de versión distinto, no publicando una regla nueva en Catalog a mitad de una inspección.
- **Tipo sin checklist vigente** en la prueba automatizada. Se observó funcionando a mano (409 con mensaje claro) antes de cargar el seed de reglas.

### Probarlo a mano

1. Entra en `http://localhost:5173/admin` como `superadmin@reecicla.com` y crea, para el negocio `demo`, un usuario `INSPECTOR` y un `TENANT_ADMIN`.
2. En `http://localhost:5173/recicla/demo`, cotiza y acepta. El tipo necesita una regla de precio (pestaña "Reglas", como administrador del negocio). Si aceptas sin iniciar sesión, el código de verificación llega a Mailpit: `http://localhost:8025`.
3. Como administrador del negocio, en "Logística": registra la guía con estado "En Tránsito" y luego "Registrar Recepción".
4. Entra como el inspector, abre "Inspección" y registra la checklist.

---

## 9. Qué sigue para cada uno

### HU-016 — Determinar destino (Fer)

Todo ocurre en el servicio `inspection`:

- La inspección ya existe con `status = 'REGISTERED'` y `result = NULL`. Te toca pasarla a `COMPLETED` con `result` `RESALE` o `RECYCLE`. Los CHECK ya admiten esos valores.
- Falta una columna para la justificación; agrégala en una migración `02-...sql` (y móntala en el compose).
- Las reglas `resale_criteria` y `recycle_criteria` vienen en la regla de Catalog; `catalogClient.ts` ya la trae, pero el tipo `EvaluationRule` de Inspection no declara esos dos campos.
- Para publicar `InspectionCompleted`, inserta en `domain_event_outbox` dentro de tu transacción, como hace `InspectionModel.create`. El publicador ya existe y lo envía solo.
- En Orders, agrega un consumidor de `inspection.completed` que pase la orden a `INSPECTED`. Recuerda usar `set_config('reecicla.operator_user_id', …)` para que el trigger registre el historial.

### HU-017 — Cotización ajustada (Andrés)

- La condición real está en `inspections.actual_condition` y viaja en el evento `InspectionRegistered`.
- La condición declarada está en la cotización original (`quotes.condition`) y en `orders.declared_condition`.
- Ambas usan el mismo vocabulario (`working`, `damaged`, `broken`), así que se comparan directo.
- Según el documento oficial, Quotation reacciona a `InspectionCompleted` (HU-016), no a `InspectionRegistered`. Coordina con Fer el payload: necesitas al menos `order_id`, `actual_condition` y el resultado. El evento no trae `quote_id`.

### HU-018 — Aceptar o rechazar el ajuste (Diego)

Depende de HU-017. No hay nada de HU-015 que debas tocar.

---

## 10. Pendientes y cosas a saber

- **`docker-compose.yml` fuera de los repos.** Convendría moverlo a `reecicla-backend` o a un repo propio para que deje de pasarse a mano.
- **El inspector no ve la pestaña "Logística"** en el Navbar nuevo de `main`, aunque el backend sí le permite registrar envíos y recepciones.
- **El inspector también puede registrar envíos y recepciones**, porque `orderRoutes.ts` incluye `INSPECTOR` en los roles de logística. No se cambió.
- **Las lecturas de reglas de evaluación en Catalog son públicas** y toman el tenant del header `x-tenant-id`. Inspection depende de eso; si Catalog las protege, hay que ajustar `catalogClient.ts`.
- **La URL del Gateway sigue fija** en `reecicla-frontend/src/services/api.ts`.

---

## 11. Integración con `main` (ADR-001)

El 2026-10-12 se trajo `main` a `feat/HU15` en ambos repos. `main` incluía el ADR-001 completo: negocio resuelto por slug, cotización anónima con verificación por correo, enlace de seguimiento y administración de plataforma.

### Conflictos resueltos

| Repo | Archivo | Resolución |
|------|---------|------------|
| backend | `services/auth/src/controllers/authController.ts` | Se tomó la versión de `main`, que ya incluía la corrección del rol |
| backend | `services/gateway/src/index.ts` | Estructura de `main` más las rutas de inspección, con y sin slug |
| backend | `services/gateway/.env.example` | Ambas variables |
| frontend | `src/App.tsx` | Estructura de `main` más la pestaña de inspección |
| frontend | `src/services/api.ts` | Las llamadas de inspección usan la ruta con slug (`scoped('inspections', ...)`) |
| frontend | `src/types/index.ts` | Ambos bloques de tipos |

### Ajustes a Inspection para seguir las reglas de `main`

- `JWT_SECRET` es obligatorio: el servicio no arranca sin él, igual que Orders y Auth.
- Una sesión de plataforma (`SUPER_ADMIN`) recibe 403: no puede entrar a funciones de un negocio.
- Si llega `X-Tenant-ID` del Gateway y no coincide con el tenant del token, se responde 403.
- `SUPER_ADMIN` salió de los roles que consultan inspecciones.
- La prueba de punta a punta usa las rutas con slug, el login de plataforma y un `TENANT_ADMIN` para logística.

### Lo que `main` exige ahora en `docker-compose.yml`

Además de lo de la sección 7:

```yaml
  # auth-db → volumes
      - ./reecicla-backend/services/auth/db/04-guest-email-verification.sql:/docker-entrypoint-initdb.d/04-guest-email-verification.sql
      - ./reecicla-backend/services/auth/db/05-guest-verification-address.sql:/docker-entrypoint-initdb.d/05-guest-verification-address.sql
      - ./reecicla-backend/services/auth/db/06-tenant-slugs.sql:/docker-entrypoint-initdb.d/06-tenant-slugs.sql
      - ./reecicla-backend/services/auth/db/07-platform-admins.sql:/docker-entrypoint-initdb.d/07-platform-admins.sql
  # quotation-db → volumes
      - ./reecicla-backend/services/quotation/db/09-quote-expiry-index.sql:/docker-entrypoint-initdb.d/09-quote-expiry-index.sql
      - ./reecicla-backend/services/quotation/db/10-anonymous-quotes.sql:/docker-entrypoint-initdb.d/10-anonymous-quotes.sql
  # orders-db → volumes
      - ./reecicla-backend/database/05-orders-anonymous-acceptance.sql:/docker-entrypoint-initdb.d/05-orders-anonymous-acceptance.sql
      - ./reecicla-backend/database/06-orders-tracking-links.sql:/docker-entrypoint-initdb.d/06-orders-tracking-links.sql

  # auth-service → environment (y depends_on: mailpit)
      FRONTEND_URL: ${FRONTEND_URL:-http://localhost:5173}
      SMTP_HOST: ${SMTP_HOST:-mailpit}
      SMTP_PORT: ${SMTP_PORT:-1025}
      SMTP_SECURE: ${SMTP_SECURE:-false}
      SMTP_USER: ${SMTP_USER:-}
      SMTP_PASSWORD: ${SMTP_PASSWORD:-}
      SMTP_FROM: ${SMTP_FROM:-Reecicla <no-reply@reecicla.local>}

  # gateway → environment
      INTERNAL_SERVICE_TOKEN: ${INTERNAL_SERVICE_TOKEN:-reecicla-internal-dev-token}

  # orders-service → environment
      AUTH_SERVICE_URL: http://auth-service:3001
      INTERNAL_SERVICE_TOKEN: ${INTERNAL_SERVICE_TOKEN:-reecicla-internal-dev-token}
      FRONTEND_URL: ${FRONTEND_URL:-http://localhost:5173}

  # servicio nuevo
  mailpit:
    image: axllent/mailpit:latest
    container_name: reecicla-mailpit
    ports:
      - "8025:8025" # Bandeja web
      - "1025:1025" # SMTP
```

El README de `main` describe un compose propio de Andrés (carpeta `Reecicla`, con `.env` raíz y puertos enlazados a `127.0.0.1`). Si el equipo adopta ese archivo, solo hay que agregarle `inspection-db`, `inspection-service` y las migraciones de la sección 7.

### Migraciones de `main` para bases ya creadas

Además de las de la sección 1.2, en este orden:

```powershell
$b = "reecicla-backend"
Get-Content -Raw $b/services/auth/db/04-guest-email-verification.sql   | docker exec -i reecicla-auth-db      psql -v ON_ERROR_STOP=1 -U reecicla_user -d reecicla_auth_db
Get-Content -Raw $b/services/auth/db/05-guest-verification-address.sql | docker exec -i reecicla-auth-db      psql -v ON_ERROR_STOP=1 -U reecicla_user -d reecicla_auth_db
Get-Content -Raw $b/services/auth/db/06-tenant-slugs.sql               | docker exec -i reecicla-auth-db      psql -v ON_ERROR_STOP=1 -U reecicla_user -d reecicla_auth_db
Get-Content -Raw $b/services/auth/db/07-platform-admins.sql            | docker exec -i reecicla-auth-db      psql -v ON_ERROR_STOP=1 -U reecicla_user -d reecicla_auth_db
Get-Content -Raw $b/services/quotation/db/09-quote-expiry-index.sql    | docker exec -i reecicla-quotation-db psql -v ON_ERROR_STOP=1 -U reecicla_user -d reecicla_quotation_db
Get-Content -Raw $b/services/quotation/db/10-anonymous-quotes.sql      | docker exec -i reecicla-quotation-db psql -v ON_ERROR_STOP=1 -U reecicla_user -d reecicla_quotation_db
Get-Content -Raw $b/database/05-orders-anonymous-acceptance.sql        | docker exec -i reecicla-orders-db    psql -v ON_ERROR_STOP=1 -U reecicla_user -d reecicla_orders_db
Get-Content -Raw $b/database/06-orders-tracking-links.sql              | docker exec -i reecicla-orders-db    psql -v ON_ERROR_STOP=1 -U reecicla_user -d reecicla_orders_db
```

La 07 de Auth mueve al superadmin de `users` a `platform_admins`. Desde entonces el superadmin entra por `/admin`, no por la pantalla de un negocio.

### Verificado después de integrar

- Los 14 contenedores levantan y los 6 servicios más el frontend construyen en Docker.
- 21 de 21 pruebas del servicio de inspección.
- 27 verificaciones de punta a punta por el Gateway, con las rutas por slug.

`tsc` local de `catalog` puede fallar con errores sobre `req.user` si la máquina tiene un `node_modules` con `@types/passport` en una carpeta superior. No es un error del repo: el build de Docker pasa.
