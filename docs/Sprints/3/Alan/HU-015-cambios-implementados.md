# HU-015 — Cambios implementados y contexto para continuar

| Campo | Valor |
|-------|-------|
| Fecha | 2026-10-12 |
| Autor | Alan Maldonado |
| Historia | HU-015 — Registrar inspección con checklist (Sprint 3, 8 pts) |
| Ramas | `feat/HU15` en `reecicla-backend` y en `reecicla-frontend` |
| Incluye `main` hasta | `f1ebfc2` (backend) y `8f2e5e7` (frontend): ADR-001 completo |
| Estado | Implementado y verificado en local. Falta el merge de `feat/HU15` hacia `main` |

Este documento describe **todo lo que se agregó, cambió y corrigió** durante HU-015, cómo dejar el entorno funcionando y qué necesita cada compañero para seguir con HU-016, HU-017 y HU-018. Está escrito para leerse sin haber visto el trabajo, y para usarse como contexto de un asistente de IA.

Documentos relacionados, en esta misma carpeta:

| Archivo | Contenido |
|---------|-----------|
| `HU-015-registrar-inspeccion-con-checklist.md` | La historia: criterios de aceptación, Definition of Done, tareas y subtareas |
| `docker-compose.unificado.yml` | Copia de referencia del compose que funciona con este código |
| `correcciones-arranque-docker-compose.md` | Detalle de los dos primeros errores de arranque (ya incluidos en el compose unificado) |

---

## 1. Resumen

- Se creó el microservicio **`inspection`** con su propia base de datos, que antes no existía.
- Un usuario con rol `INSPECTOR` puede registrar la inspección de un equipo recibido, respondiendo la checklist vigente de su tipo.
- Se integró `main` (ADR-001 de Andrés) en `feat/HU15` y se resolvieron los conflictos.
- Se unificó el `docker-compose.yml` de Andrés con el de HU-015.
- Por el camino se corrigieron cinco errores que ya estaban en `main` o en el compose y que impedían probar el flujo.

Lo que **no** incluye HU-015: decidir reventa o reciclaje (HU-016), la cotización ajustada (HU-017) y subir archivos de evidencia.

---

## 2. Dejar el entorno funcionando

El `docker-compose.yml` **no está en el repo del backend ni en el del frontend**: vive en la carpeta que los contiene. Por eso no llega por git y hay que colocarlo a mano.

### 2.1 Estructura de carpetas esperada

```
<carpeta del proyecto>/
├── docker-compose.yml      ← copia de docker-compose.unificado.yml
├── .env                    ← secretos (no se sube a git)
├── reecicla-backend/
└── reecicla-frontend/
```

### 2.2 Compose

Copia `reecicla-backend/docs/Sprints/3/Alan/docker-compose.unificado.yml` a la carpeta del proyecto con el nombre `docker-compose.yml`. La sección 8 explica qué contiene y por qué.

### 2.3 Archivo `.env` raíz

El compose no arranca los servicios sin estos dos valores. Deben ser secretos aleatorios y distintos entre sí:

```dotenv
JWT_SECRET=<secreto aleatorio>
INTERNAL_SERVICE_TOKEN=<otro secreto aleatorio>

# Correo de desarrollo: los mensajes se ven en http://localhost:8025
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=Reecicla <no-reply@reecicla.local>
```

**Cuidado con el correo.** Si `SMTP_USER` tiene valor y `SMTP_PASSWORD` está vacío, Auth no puede enviar correos y Orders entra en un bucle de reintentos (sección 9, problema 1). Usa Mailpit como arriba, o configura Gmail completo con una contraseña de aplicación.

Además, `auth`, `quotation`, `catalog` y `gateway` usan `env_file`, así que cada uno necesita un `.env` en su carpeta o el compose no arranca. Están ignorados por git. Los `.env.example` apuntan a `localhost` (sirven para correr fuera de Docker) y `catalog` no tiene ejemplo, así que para Docker usa estos valores:

```dotenv
# services/auth/.env
PORT=3001
DATABASE_URL=postgres://reecicla_user:reecicla_password@auth-db:5432/reecicla_auth_db

# services/quotation/.env
PORT=3002
DATABASE_URL=postgres://reecicla_user:reecicla_password@quotation-db:5432/reecicla_quotation_db

# services/catalog/.env
PORT=3003
DATABASE_URL=postgres://reecicla_user:reecicla_password@catalog-db:5432/reecicla_catalog_db

# services/gateway/.env
PORT=3000
AUTH_SERVICE_URL=http://auth-service:3001
QUOTATION_SERVICE_URL=http://quotation-service:3002
CATALOG_SERVICE_URL=http://catalog-service:3003
```

`JWT_SECRET` e `INTERNAL_SERVICE_TOKEN` no van ahí: el compose los inyecta desde el `.env` raíz. `orders` e `inspection` no necesitan `.env` en Docker porque todas sus variables están en el compose.

### 2.4 Migraciones en bases que ya existían

Postgres solo ejecuta los scripts de inicialización cuando el volumen está vacío. Si ya tenías volúmenes, montar las migraciones no basta: hay que aplicarlas una vez. Desde la carpeta del proyecto, en PowerShell, con las bases arriba:

```powershell
$b = "reecicla-backend"
function Migrar($db, $archivo) {
  Get-Content -Raw "$b/$archivo" | docker exec -i "reecicla-$db-db" psql -v ON_ERROR_STOP=1 -U reecicla_user -d "reecicla_${db}_db"
}

# Auth (ADR-001)
Migrar auth services/auth/db/04-guest-email-verification.sql
Migrar auth services/auth/db/05-guest-verification-address.sql
Migrar auth services/auth/db/06-tenant-slugs.sql
Migrar auth services/auth/db/07-platform-admins.sql

# Quotation
Migrar quotation services/quotation/db/07-quotation-pricing-rules-granularity.sql
Migrar quotation services/quotation/db/08-fix-pricing-rules-unique-index.sql
Migrar quotation services/quotation/db/09-quote-expiry-index.sql
Migrar quotation services/quotation/db/10-anonymous-quotes.sql

# Catalog
Migrar catalog services/catalog/db/05-processed-events-tenant.sql
Migrar catalog services/catalog/db/06-evaluation-rules-seed.sql

# Orders
Migrar orders database/05-orders-anonymous-acceptance.sql
Migrar orders database/05-orders-domain-event-outbox.sql
Migrar orders database/06-orders-tracking-links.sql
```

Todas son idempotentes. La base de inspección es nueva, así que su migración corre sola.

La `07-platform-admins.sql` de Auth **mueve al superadmin** de la tabla `users` a `platform_admins` y lo borra de `users`. Es el comportamiento que define el ADR-001. Si quieres poder volver atrás, respalda antes con `pg_dump`.

Alternativa si no te importan los datos locales: `docker compose down -v` y volver a levantar. Todo se crea desde cero con las migraciones correctas.

### 2.5 Levantar

```powershell
docker compose up -d --build
docker compose ps
```

Deben quedar **14 contenedores** arriba: 5 bases y RabbitMQ en `healthy`, 6 servicios, Mailpit y el frontend.

### 2.6 Direcciones

| Qué | Dirección |
|-----|-----------|
| Aplicación de un negocio | `http://localhost:5173/recicla/demo` |
| Administración de plataforma (superadmin) | `http://localhost:5173/admin` |
| Gateway | `http://localhost:3000` |
| Correos de desarrollo (Mailpit) | `http://localhost:8025` |
| Panel de RabbitMQ | `http://localhost:15672` |

Los servicios ya no publican puerto propio: solo se llega a ellos por el Gateway. Las bases y RabbitMQ solo escuchan en `127.0.0.1`.

Superadmin de desarrollo: `superadmin@reecicla.com` / `superadmin123`.

---

## 3. Qué se agregó

### 3.1 Microservicio `inspection` (nuevo)

| Dato | Valor |
|------|-------|
| Carpeta | `reecicla-backend/services/inspection` |
| Contenedor | `reecicla-inspection-service` |
| Puerto interno | 3005 (no publicado en el host) |
| Base de datos | `reecicla_inspection_db`, contenedor `reecicla-inspection-db`, `127.0.0.1:5436` |
| Variables | `PORT`, `DATABASE_URL`, `RABBITMQ_URL`, `CATALOG_SERVICE_URL`, `JWT_SECRET` (obligatoria) |
| Stack | Node 20, TypeScript, Express, `pg`, `amqplib`, `jsonwebtoken` — igual que `orders` |

Archivos:

```
services/inspection/
├── Dockerfile                       multi-stage, igual al de orders
├── package.json · tsconfig.json · .env.example
├── db/
│   └── 01-inspection-migration.sql  todas las tablas del servicio
├── src/
│   ├── index.ts                     arranque, /health, temporizador del outbox
│   ├── config/db.ts                 pool de PostgreSQL
│   ├── types/inspection.ts          tipos de dominio, eventos y payloads
│   ├── domain/
│   │   ├── checklist.ts             validación de respuestas (función pura)
│   │   ├── deviceReceived.ts        validación del evento entrante
│   │   └── errors.ts                DomainError (lleva el código HTTP)
│   ├── messaging/
│   │   ├── eventConsumer.ts         consume device.received
│   │   └── eventPublisher.ts        publica desde el outbox
│   ├── models/
│   │   ├── receivedDeviceModel.ts   equipos recibidos y pendientes
│   │   └── inspectionModel.ts       inspección + ítems + outbox en una transacción
│   ├── clients/catalogClient.ts     pide la checklist vigente a Catalog
│   ├── services/inspectionService.ts  orquesta el registro
│   ├── controllers/inspectionController.ts
│   ├── routes/inspectionRoutes.ts
│   └── middlewares/authMiddleware.ts
└── tests/
    ├── checklist.test.cjs               11 pruebas unitarias
    ├── deviceReceived.test.cjs          5 pruebas unitarias
    ├── inspection.integration.test.cjs  5 pruebas contra la base
    └── e2e/hu015-flow.mjs               flujo completo por el Gateway
```

### 3.2 Base de datos de inspección

Definida en `services/inspection/db/01-inspection-migration.sql`. No hay claves foráneas hacia otras bases.

| Tabla | Para qué |
|-------|----------|
| `received_devices` | Equipos recibidos en almacén. Se llena con el evento `DeviceReceived`. Clave: `(tenant_id, order_id)` |
| `inspections` | Una fila por orden inspeccionada |
| `inspection_items` | Una fila por criterio respondido de la checklist |
| `processed_events` | Idempotencia de los eventos consumidos |
| `domain_event_outbox` | Eventos pendientes de publicar |

Columnas clave de `inspections`:

| Columna | Detalle |
|---------|---------|
| `order_id`, `device_type_id`, `evaluation_rule_id` | Referencias lógicas a Orders y Catalog |
| `evaluation_rule_version` | Versión de la checklist que se usó |
| `status` | `REGISTERED` al crearla. `COMPLETED` queda para HU-016 |
| `result` | `NULL` al crearla. `RESALE` o `RECYCLE` quedan para HU-016 |
| `actual_condition` | Condición real: `working`, `damaged` o `broken` |
| `observations`, `evidence_refs` | Observación general y lista de referencias (JSONB) |
| `inspected_by_user`, `inspected_at` | Quién y cuándo. El usuario sale del token |

Columnas clave de `inspection_items`:

| Columna | Detalle |
|---------|---------|
| `criterion_key`, `criterion_label`, `criterion_type` | Copia del criterio tal como estaba en la checklist |
| `value` | Respuesta en JSONB: `true`/`false`, número o texto |
| `result` | `PASS`/`FAIL` solo para criterios `boolean`; `NULL` en el resto |
| `observation`, `evidence_refs` | Por ítem |

Restricciones: una inspección por orden (`UNIQUE (tenant_id, order_id)`) y un ítem por criterio.

Diferencias con el `docs/script.sql` original, que ya está actualizado junto con su copia `database/script.sql`:

- `inspections.result` pasó a ser opcional, porque lo decide HU-016.
- Se agregaron `status`, `evaluation_rule_version` y `evidence_refs`.
- `inspection_items` guarda `criterion_type`, `value` y `evidence_refs`. El script solo tenía PASS/FAIL, pero la checklist de HU-008 admite ítems `boolean`, `number`, `text` y `select`.
- Se agregó la tabla `received_devices`.

### 3.3 Frontend

| Archivo | Cambio |
|---------|--------|
| `src/features/inspeccion/components/InspectionManager.tsx` | Pantalla nueva: pendientes, formulario y detalle |
| `src/features/inspeccion/InspectionManager.module.css` · `index.ts` | Estilos y exportación |
| `src/services/api.ts` | `getPendingInspections`, `getInspectionChecklist`, `registerInspection`, `getInspections`, `getInspectionByOrder`; `scoped()` acepta `'inspections'` |
| `src/types/index.ts` | `PendingInspection`, `InspectionChecklist`, `RegisterInspectionInput`, `InspectionItemInput`, `InspectionItem`, `Inspection` |
| `src/components/Navbar/Navbar.tsx` | Pestaña "Inspección" |
| `src/App.tsx` | Pestaña `inspeccion` y su control de acceso |

La pestaña la ven `INSPECTOR` y `TENANT_ADMIN`. Solo `INSPECTOR` ve el botón "Inspeccionar"; el administrador consulta.

La pantalla tiene tres vistas: la lista (pestañas "Pendientes" y "Registradas"), el formulario generado a partir de la checklist, y el detalle en solo lectura.

---

## 4. Qué se cambió en código que ya existía

| Repo | Archivo | Cambio |
|------|---------|--------|
| backend | `services/gateway/src/index.ts` | Rutas de inspección: `/recicla/:slug/inspections`, `/recicla/:slug/api/inspections` y `/api/inspections`. Variable `INSPECTION_SERVICE_URL` |
| backend | `services/gateway/.env.example` | `INSPECTION_SERVICE_URL` |
| backend | `docs/script.sql`, `database/script.sql` | Sección INSPECTION DB |
| frontend | `App.tsx`, `Navbar/Navbar.tsx`, `api.ts`, `types/index.ts` | Lo listado en 3.3 |

No se modificó `orders`, `catalog`, `quotation` ni `auth`. El controlador de Auth se tocó durante el trabajo para corregir el rol, pero `main` ya traía la misma corrección y quedó la versión de `main`.

---

## 5. Cómo funciona

```
Orders ──DeviceReceived──► Inspection ──GET evaluation-rules/active──► Catalog
(HU-014)  device.received      │                                       (HU-008)
                               ├─ received_devices   equipos por inspeccionar
                               ├─ inspections + inspection_items
                               └─ InspectionRegistered ──► (nadie lo consume aún)
                                  inspection.registered
```

1. Orders registra la recepción y publica `DeviceReceived`.
2. Inspection lo consume y guarda el equipo en `received_devices`. Un evento repetido se ignora.
3. El inspector abre la orden. Inspection pide a Catalog la regla de evaluación activa del tipo y devuelve la checklist.
4. El inspector envía las respuestas. Inspection vuelve a pedir la regla vigente, comprueba que la versión coincide y valida cada respuesta.
5. Guarda inspección, ítems y el evento `InspectionRegistered` en una sola transacción.
6. El evento se publica al momento. Si RabbitMQ no responde, un temporizador lo reintenta cada 5 segundos.

### Reglas de validación

| Regla | Respuesta si no se cumple |
|-------|---------------------------|
| La orden tiene un equipo recibido en el tenant | 404 |
| La orden no tiene ya una inspección | 409 |
| El tipo tiene una checklist vigente | 409 |
| `evaluation_rule_id` y versión enviados son los vigentes | 409 "La checklist cambió" |
| `actual_condition` es `working`, `damaged` o `broken` | 400 |
| Todo criterio `required` está respondido | 400 |
| El valor coincide con el tipo del criterio | 400 |
| No hay criterios desconocidos ni repetidos | 400 |
| Máximo 10 referencias de evidencia de 500 caracteres; observaciones de hasta 2000 | 400 |

Los errores 400 incluyen `details`, una lista con un mensaje por cada problema.

### Decisiones tomadas

| Decisión | Motivo |
|----------|--------|
| Inspection no consulta a Orders; se alimenta de `DeviceReceived` | El documento oficial define ese evento como la entrada de Inspection, y evita acoplar los servicios |
| La checklist se pide a Catalog por REST | El inspector espera respuesta inmediata |
| `tenant_id` y `user_id` salen del token | Igual que Orders. Nunca se aceptan del body |
| `result` es opcional | Lo decide HU-016 |
| Se guarda `value` por ítem además de PASS/FAIL | La checklist tiene ítems numéricos, de texto y de selección |
| La evidencia son referencias, no archivos | El backlog pide "referencias de evidencia" y no hay almacenamiento de archivos |
| Una inspección por orden | La reinspección queda fuera de esta HU |
| Orders no cambia de estado | La orden sigue en `RECEIVED` hasta que HU-016 la pase a `INSPECTED` |

### Autenticación y negocio (ADR-001)

El middleware de Inspection sigue las mismas reglas que Orders en `main`:

- Sin token: 401.
- Token inválido o vencido: 403.
- Sesión de plataforma (`SUPER_ADMIN`): 403. El superadmin no entra a funciones de un negocio.
- Si el Gateway inyecta `X-Tenant-ID` (al resolver el slug de la URL) y no coincide con el tenant del token: 403.
- `JWT_SECRET` es obligatorio; el servicio no arranca sin él.

---

## 6. Contrato de la API

Todas las rutas requieren `Authorization: Bearer <token>` de un usuario del negocio. El frontend usa el prefijo con slug.

Prefijos equivalentes en el Gateway (`http://localhost:3000`):

- `/recicla/{slug}/api/inspections` ← el que usa el frontend
- `/recicla/{slug}/inspections`
- `/api/inspections` (el tenant sale solo del token)

| Método | Ruta (tras el prefijo) | Roles | Descripción |
|--------|------------------------|-------|-------------|
| GET | `/pending` | INSPECTOR, TENANT_ADMIN | Equipos recibidos sin inspección |
| GET | `/orders/:orderId/checklist` | INSPECTOR, TENANT_ADMIN | Checklist vigente del tipo de la orden |
| POST | `/` | **solo INSPECTOR** | Registra la inspección |
| GET | `/orders/:orderId` | INSPECTOR, TENANT_ADMIN | Inspección de una orden, con ítems |
| GET | `/` | INSPECTOR, TENANT_ADMIN | Inspecciones del tenant, sin ítems |

### `GET /pending` → 200

```json
{ "pending": [
  { "tenant_id": "…", "order_id": "…", "device_type_id": "…",
    "device_type_name": "Horno de Microondas",
    "received_at": "2026-10-12T16:52:38.639Z", "received_by_user": "…" }
] }
```

### `GET /orders/:orderId/checklist` → 200

```json
{
  "order_id": "…",
  "device_type_id": "…",
  "device_type_name": "Horno de Microondas",
  "received_at": "2026-10-12T16:52:38.639Z",
  "evaluation_rule_id": "…",
  "evaluation_rule_version": 1,
  "checklist": [
    { "id": "heating_works", "label": "¿Calienta adecuadamente agua/alimentos?", "type": "boolean", "required": true },
    { "id": "cosmetic_condition", "label": "Estado estético general (1-10)", "type": "number", "required": true }
  ]
}
```

### `POST /` → 201

```json
{
  "order_id": "…",
  "evaluation_rule_id": "…",
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

- `evaluation_rule_id` y `evaluation_rule_version` son los que devolvió la checklist.
- `value`: `true`/`false` para `boolean`, número para `number`, texto para `text`, una de las `options` para `select`.
- `observations`, `observation` y `evidence_refs` son opcionales. Un criterio no obligatorio se puede omitir.

Respuesta: `{ "message": "Inspección registrada correctamente.", "inspection": { …, "items": [ … ] } }`

### Errores

| Código | Cuándo |
|--------|--------|
| 400 | Datos inválidos (con `details`), o `orderId` que no es UUID |
| 401 | Sin token |
| 403 | Token inválido, rol sin permiso, sesión de plataforma, o token de otro negocio |
| 404 | No hay equipo recibido para esa orden en el tenant, o la orden no tiene inspección |
| 409 | La orden ya tiene inspección; la checklist cambió de versión; o el tipo no tiene checklist vigente |
| 502 | No se pudo consultar a Catalog |

---

## 7. Contrato de eventos

Exchange `reecicla.events` (topic), con el sobre común: `event_id`, `correlation_id`, `tenant_id`, `event_type`, `timestamp`, `payload`.

### Consumido: `DeviceReceived` — routing key `device.received`

Lo publica Orders (HU-014). Cola `inspection.device-received.queue`. Un evento inválido se descarta; uno repetido se ignora.

Payload: `order_id`, `device_type_id`, `device_type_name`, `received_at`, `received_by_user_id`.

### Publicado: `InspectionRegistered` — routing key `inspection.registered`

```json
{
  "event_id": "…",
  "correlation_id": "<order_id>",
  "tenant_id": "…",
  "event_type": "InspectionRegistered",
  "timestamp": "2026-10-12T16:52:40.000Z",
  "payload": {
    "inspection_id": "…",
    "order_id": "…",
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

## 8. El `docker-compose.yml` unificado

Es la unión del compose que entregó Andrés con el de HU-015. La copia de referencia está en `docker-compose.unificado.yml`, en esta carpeta.

### Lo que viene del compose de Andrés

- Bases y RabbitMQ publicados solo en `127.0.0.1`.
- Los servicios no publican puerto; solo el Gateway (3000) y el frontend (5173).
- `JWT_SECRET` e `INTERNAL_SERVICE_TOKEN` sin valor por defecto: salen del `.env` raíz.
- Mailpit `v1.27` en `127.0.0.1:8025`, y las variables `SMTP_*`, `FRONTEND_URL` y `TRACKING_LINK_ALLOWED_ORIGINS` de Auth.
- Migraciones de Auth 04 a 07, Quotation 09 y Orders 05-anonymous y 06-tracking.

### Lo que se agregó

| Agregado | Motivo |
|----------|--------|
| `inspection-db` e `inspection-service`; `gateway` depende de `inspection-service` | HU-015 |
| Volumen `inspection_db_data` | HU-015 |
| Healthcheck en las 5 bases y en RabbitMQ | Los servicios arrancaban antes que RabbitMQ y se quedaban sin mensajería |
| `depends_on` con `condition: service_healthy` hacia su base y RabbitMQ | Lo mismo. `auth`, `quotation` y `catalog` no declaraban dependencia de RabbitMQ |
| Quotation `07-quotation-pricing-rules-granularity.sql` y `08-fix-pricing-rules-unique-index.sql` | Sin ellas, cotizar falla con `column "brand_id" does not exist` |
| Quotation `10-anonymous-quotes.sql` | Sin ella no funciona la cotización anónima del ADR-001 |
| Catalog `05-processed-events-tenant.sql` | Sin ella Catalog no procesa `DeviceReceived` (HU-014) |
| Orders `05-orders-domain-event-outbox.sql` | Sin ella Orders no puede publicar `DeviceReceived` (HU-014) |

Las cinco migraciones de las últimas cuatro filas **faltaban en el compose de Andrés**. Con su archivo tal cual, una base creada desde cero queda rota en esos puntos.

---

## 9. Errores encontrados que no eran de HU-015

### Corregidos

| # | Síntoma | Causa | Corrección |
|---|---------|-------|------------|
| 1 | Orders falla: `relation "domain_event_outbox" does not exist` | El compose no montaba `05-orders-domain-event-outbox.sql` | Montada en el compose |
| 2 | Quotation, Catalog y Orders quedan sin mensajería tras arrancar | RabbitMQ tarda más en estar listo que los reintentos de los servicios (15 a 36 s) | Healthchecks y `depends_on` por salud |
| 3 | No se puede cotizar: `column "brand_id" does not exist` | El compose no montaba las migraciones 07 y 08 de Quotation | Montadas |
| 4 | Catalog no actualiza `last_received_at` | El compose no montaba `05-processed-events-tenant.sql` | Montada |
| 5 | No se podía crear un usuario `INSPECTOR`; siempre se creaba `TENANT_ADMIN` | El controlador de Auth descartaba el campo `role` | Ya corregido en `main` por Andrés |

Sobre el punto 5: los usuarios creados como "INSPECTOR" antes de esa corrección son en realidad `TENANT_ADMIN`. Hay que crearlos de nuevo.

### Sin corregir — requieren decisión del equipo

**Problema 1 — Bucle de reintentos en Orders cuando falla el correo.**
Al aceptar una cotización, Orders crea la orden y pide a Auth que envíe el enlace de seguimiento. Si ese envío falla, Orders rechaza el evento `QuoteAccepted` y RabbitMQ lo reentrega de inmediato, sin espera. Se midieron unos 950 reintentos por minuto. La orden sí queda creada. Se dispara con cualquier fallo de correo; en este caso fue un `.env` con `SMTP_USER` definido y `SMTP_PASSWORD` vacío. Está en `services/orders/src/messaging/eventConsumer.ts` y `orderModel.ts`, código del ADR-001. Mientras no se corrija, usa Mailpit en desarrollo.

**Problema 2 — El inspector no ve la pestaña "Logística".**
El Navbar nuevo de `main` solo la muestra a los administradores, aunque el backend sí permite al `INSPECTOR` registrar envíos y recepciones.

**Problema 3 — `tsc` local de `catalog` puede fallar con errores sobre `req.user`.**
Pasa si la máquina tiene un `node_modules` con `@types/passport` en una carpeta superior. No es un error del repo: el build de Docker pasa.

**Problema 4 — La URL del Gateway está fija** en `reecicla-frontend/src/services/api.ts` (`http://localhost:3000`).

**Problema 5 — Las lecturas de reglas de evaluación en Catalog son públicas** y toman el negocio del header `x-tenant-id`. Inspection depende de eso para pedir la checklist. Si Catalog las protege, hay que ajustar `services/inspection/src/clients/catalogClient.ts`.

---

## 10. Integración con `main` (ADR-001)

El 2026-10-12 se trajo `main` a `feat/HU15` en ambos repos. `main` incluía el ADR-001 completo: negocio resuelto por slug, cotización anónima con verificación por correo, enlace de seguimiento y administración de plataforma.

### Conflictos resueltos

| Repo | Archivo | Resolución |
|------|---------|------------|
| backend | `services/auth/src/controllers/authController.ts` | Versión de `main`, que ya incluía la corrección del rol |
| backend | `services/gateway/src/index.ts` | Estructura de `main` más las rutas de inspección, con y sin slug |
| backend | `services/gateway/.env.example` | Ambas variables |
| frontend | `src/App.tsx` | Estructura de `main` más la pestaña de inspección |
| frontend | `src/services/api.ts` | Las llamadas de inspección usan `scoped('inspections', …)` |
| frontend | `src/types/index.ts` | Ambos bloques de tipos |

### Ajustes a lo de HU-015 para seguir las reglas de `main`

- `JWT_SECRET` obligatorio en Inspection.
- La sesión de plataforma recibe 403; `SUPER_ADMIN` salió de los roles que consultan.
- Se valida `X-Tenant-ID` contra el tenant del token.
- La pestaña se movió a `src/components/Navbar/Navbar.tsx`, que es el Navbar que usa `main`. El archivo viejo `src/components/Navbar.tsx` quedó sin uso.
- La prueba de punta a punta usa las rutas con slug, el login de plataforma y un `TENANT_ADMIN` para logística.

### Qué cambia al usar la aplicación

- El superadmin entra por `/admin`, no por la pantalla de un negocio.
- Cada negocio se abre en `/recicla/{slug}`. El de desarrollo es `demo`.
- Logística y reglas de precio las hace un `TENANT_ADMIN`, ya no el superadmin.
- Un cliente puede aceptar una cotización sin cuenta; el código de verificación le llega por correo.

---

## 11. Pruebas

Desde `reecicla-backend/services/inspection`:

| Tipo | Comando (PowerShell) | Resultado |
|------|----------------------|-----------|
| Unitarias | `npm test` | 16 de 16 |
| Integración | `$env:RUN_INSPECTION_INTEGRATION='1'; npm test` | 21 de 21 (16 + 5) |
| Punta a punta | `node tests/e2e/hu015-flow.mjs` | 27 verificaciones correctas |

- **Integración** necesita `inspection-db` arriba (usa `127.0.0.1:5436`). Limpia lo que crea.
- **Punta a punta** necesita todo arriba. Recorre cotización → orden → envío → recepción → inspección por el Gateway, y comprueba 401, 403, 404, 409 y 400. **Crea datos reales** en las bases locales en cada corrida: un inspector, un administrador del negocio, un cliente, una cotización, una orden y una inspección. Variables opcionales: `GATEWAY_URL`, `TENANT_SLUG`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`.

Las tres se ejecutaron sobre el código ya integrado con `main` y con el compose unificado.

### Lo que no se probó

- **La pantalla en el navegador.** El frontend compila y el contenedor responde, pero no hay una prueba manual registrada del formulario.
- **Cambio real de versión de checklist.** El 409 se probó enviando un número de versión distinto, no publicando una regla nueva en Catalog a mitad de una inspección.
- **Tipo sin checklist vigente** en la prueba automatizada. Se observó a mano (409 con mensaje claro) antes de cargar el seed de reglas.

### Probarlo a mano

1. En `http://localhost:5173/admin`, entra como superadmin y crea para el negocio `demo` un usuario `INSPECTOR` y un `TENANT_ADMIN`.
2. En `http://localhost:5173/recicla/demo`, cotiza un equipo y acepta. El tipo necesita una regla de precio: la crea el `TENANT_ADMIN` en la pestaña "Reglas". Si aceptas sin iniciar sesión, el código de verificación llega a Mailpit.
3. Como `TENANT_ADMIN`, en "Logística": registra la guía con estado "En Tránsito" y luego "Registrar Recepción".
4. Como `INSPECTOR`, abre "Inspección". La orden aparece en "Pendientes".
5. Pulsa "Inspeccionar", responde la checklist, elige la condición real y registra.
6. En "Registradas", abre "Ver detalle".

Comprobaciones de permisos: el `TENANT_ADMIN` ve la pestaña pero no el botón "Inspeccionar"; un cliente no ve la pestaña.

### Un equipo recibido antes de este cambio no aparece

Los `DeviceReceived` publicados antes de que existiera la cola de Inspection se perdieron. Para reenviarlos, ejecuta esto en la base de **Orders**; el publicador los envía de nuevo en unos segundos y los consumidores ignoran los repetidos:

```sql
UPDATE domain_event_outbox SET published_at = NULL WHERE event_type = 'DeviceReceived';
```

---

## 12. Qué sigue para cada uno

### HU-016 — Determinar destino (Fer)

Todo ocurre en el servicio `inspection`.

- La inspección ya existe con `status = 'REGISTERED'` y `result = NULL`. Te toca pasarla a `COMPLETED` con `result` `RESALE` o `RECYCLE`. Los CHECK ya admiten esos valores.
- Falta una columna para la justificación. Agrégala en una migración `services/inspection/db/02-….sql` y móntala en el compose.
- Los criterios `resale_criteria` y `recycle_criteria` vienen en la regla de Catalog. `catalogClient.ts` ya trae la regla completa, pero el tipo `EvaluationRule` de `types/inspection.ts` no declara esos dos campos: agrégalos.
- Para publicar `InspectionCompleted`, inserta en `domain_event_outbox` dentro de tu transacción, como hace `InspectionModel.create`. El publicador ya existe y lo envía solo. La restricción del outbox es `UNIQUE (aggregate_id, event_type)`: un evento de cada tipo por inspección.
- En Orders, agrega un consumidor de `inspection.completed` que pase la orden a `INSPECTED`. Usa `set_config('reecicla.operator_user_id', …)` y `set_config('reecicla.status_reason', …)` antes del `UPDATE`, como en `receiveOrder`, para que el trigger registre el historial.
- Sigue el patrón de roles: quien decide el destino es el `INSPECTOR`.

### HU-017 — Cotización ajustada (Andrés)

- La condición real está en `inspections.actual_condition` y viaja en `InspectionRegistered`.
- La condición declarada está en `quotes.condition` y en `orders.declared_condition`.
- Ambas usan el mismo vocabulario (`working`, `damaged`, `broken`), así que se comparan directo.
- Según el documento oficial, Quotation reacciona a `InspectionCompleted` (HU-016), no a `InspectionRegistered`. Coordina el payload con Fer: necesitas al menos `order_id`, `actual_condition` y el resultado. El evento actual no trae `quote_id`; Orders sí lo tiene.

### HU-018 — Aceptar o rechazar el ajuste (Diego)

Depende de HU-017. No hay nada de HU-015 que debas tocar.

### Para quien agregue otro microservicio (Payment, Notification)

`inspection` sirve de plantilla. Pasos que se siguieron:

1. Copiar la estructura de `orders` o `inspection`.
2. Migración en `services/<servicio>/db/`.
3. Base y servicio en el compose, con healthcheck y `depends_on` por salud.
4. Ruta en el Gateway, con y sin slug.
5. Middleware de autenticación con las reglas de la sección 5.
6. `scoped()` en `api.ts` del frontend.

---

## 13. Estado del repositorio

| Repo | Rama | Commits sobre `main` |
|------|------|----------------------|
| `reecicla-backend` | `feat/HU15` | `c7d9ae9` HU 15 · `bf239b6` Merge main (ADR-001) |
| `reecicla-frontend` | `feat/HU15` | `f7621d4` HU15 · `dc0e539` Merge main (ADR-001) |

- El merge de `feat/HU15` hacia `main` es fast-forward en ambos repos mientras `main` no reciba más commits.
- Los commits de merge y este documento actualizado pueden no estar todavía en `origin/feat/HU15`: comprueba con `git status` antes de asumir que el remoto está al día.
- El `docker-compose.yml` y el `.env` raíz no están en ningún repo del proyecto. Convendría mover el compose a `reecicla-backend` o a un repo propio para que deje de pasarse a mano.
