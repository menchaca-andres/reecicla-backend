# Sprint 2 - Seguimiento HU 11 y HU 24

**Responsable:** Alan  
**Estado:** Implementación inicial realizada y validada localmente; pendiente revisión del equipo.  
**Fuentes:** `docs/Reecicla definitivo.pdf`, `docs/Kata_PolloChingon.pdf` y plantilla `docs/plantillaDeHUs.csv`.

> La plantilla se usa únicamente como formato para historias, criterios de aceptación, tareas, subtareas y pruebas. Su contenido funcional pertenece a otro proyecto y no se traslada a Reecicla.

## Estado del proyecto relevante

- El Sprint 2 incluye HU 11 (Orders, Must, 5 puntos) y HU 24 (Auth/Tenant, Should, 5 puntos).
- Docker Compose ya define una base independiente `reecicla_orders_db` (`orders-db`, puerto local `5433`) y monta `database/03-orders-migration.sql`. No hace falta crear otra base de datos.
- La migración de órdenes ya contempla `orders`, `order_status_history`, `box_requests` y `dispositions`, además de unicidad por tenant y cotización. Caja/envío y destino final corresponden a historias posteriores; no se implementan como parte de HU 11.
- Ya existe `services/orders` con Dockerfile, consumidor RabbitMQ y consultas de órdenes propias; Compose reutiliza `orders-db` y el Gateway enruta `/api/orders`.
- Auth tiene tablas `tenant_plans`, `quote_usage_counters` y `quote_usage_reservations`; el plan FREE se asigna por defecto. La reserva usa operaciones atómicas para respetar el máximo incluso con solicitudes simultáneas.
- Quotation consulta el endpoint real del Catálogo, resuelve el código del tipo a UUID, conserva snapshots compatibles con su esquema y usa clave idempotente para evitar cotizaciones duplicadas por reintento.
- La aceptación vigente actualiza la cotización y escribe `QuoteAccepted` en una outbox transaccional. El relay espera confirmación de RabbitMQ y reintenta eventos pendientes.
- Orders procesa `QuoteAccepted` con orden e historial en una sola transacción. La deduplicación por evento y la unicidad tenant/cotización evitan efectos dobles.
- El frontend permite aceptar cotizaciones pendientes y consultar las órdenes del cliente desde el historial.
- Se agregaron pruebas nativas de Node. Las integraciones contra PostgreSQL son opt-in con `RUN_AUTH_INTEGRATION=1` y `RUN_ORDERS_INTEGRATION=1` para no alterar bases locales al correr `npm test` por defecto.
- En Compose se unificó `JWT_SECRET` entre Auth, Quotation y Orders; también se configuró la URL interna de Catálogo y el token de comunicación interna para cuota.

## HU 24 - Límite de cotizaciones por plan

**Historia:** Como proveedor, quiero un plan gratuito con límites para probar el servicio antes de pagar.

### Criterios de aceptación

- **CA-01 - Límite gratuito:** un tenant con plan gratuito puede crear hasta 20 cotizaciones por mes.
- **CA-02 - Bloqueo claro:** al alcanzar el límite, una nueva solicitud se rechaza con un mensaje claro y no crea una cotización.
- **CA-03 - Reinicio mensual:** el consumo se cuenta por periodo mensual y el siguiente periodo comienza con contador cero.
- **CA-04 - Plan premium:** un tenant premium no tiene límite mensual de cotizaciones.
- **CA-05 - Aislamiento:** el plan y el uso se calculan por tenant; no se comparte consumo entre proveedores.
- **CA-06 - Consistencia:** solicitudes simultáneas no deben permitir superar el máximo gratuito; una cotización fallida no debe dejar consumo contabilizado.

### Tareas y subtareas

- **T1 - Definir y persistir planes en Auth DB**
  - ST1.1 Definir los planes admitidos (`FREE`, `PREMIUM`) y el límite correspondiente.
  - ST1.2 Crear migración incremental para asignar un plan a cada tenant y persistir el uso mensual por tenant y periodo.
  - ST1.3 Asignar `FREE` por defecto a tenants nuevos y al tenant de desarrollo; definir la actualización de tenants existentes.
  - ST1.4 Usar una clave única por tenant y periodo mensual para impedir contadores duplicados.

- **T2 - Implementar control de consumo**
  - ST2.1 Establecer zona horaria y límites del periodo (recomendado: mes calendario UTC).
  - ST2.2 Implementar reserva/consumo atómico para que solicitudes concurrentes no excedan 20.
  - ST2.3 Permitir una gestión controlada de plan para desarrollo/pruebas; no incluir pagos, ya que HU 24 no los requiere.
  - ST2.4 Definir el mensaje y código HTTP para el límite alcanzado.

- **T3 - Integrar con creación de cotizaciones**
  - ST3.1 Consultar/reservar la cuota del tenant antes de crear una cotización.
  - ST3.2 Confirmar el consumo al crearla y liberar la reserva cuando falle la creación.
  - ST3.3 Hacer idempotente la reserva para evitar dobles consumos durante reintentos.
  - ST3.4 Resolver primero la discrepancia existente entre modelo y migración de Quotation.

- **T4 - Pruebas de HU 24**
  - ST4.1 Verificar que las primeras 20 solicitudes gratuitas se permiten y la número 21 se rechaza.
  - ST4.2 Verificar cambio de periodo mensual y aislamiento entre tenants.
  - ST4.3 Verificar que Premium no se bloquea por cantidad.
  - ST4.4 Simular solicitudes concurrentes y confirmar que nunca se aceptan más de 20.
  - ST4.5 Simular un fallo de creación y confirmar que no se pierde cuota.
  - ST4.6 Verificar el mensaje y respuesta HTTP de cuota excedida.

## HU 11 - Crear una orden al aceptar una cotización

**Historia:** Como cliente, quiero que mi aceptación genere una orden para iniciar el reciclaje.

### Criterios de aceptación

- **CA-01 - Orden creada:** al recibir una aceptación válida, se crea una orden asociada a la cotización y al tenant.
- **CA-02 - Snapshot:** la orden conserva marca, modelo, año y condición declarados en la cotización aceptada.
- **CA-03 - Idempotencia:** recibir de nuevo el mismo evento o una aceptación repetida no genera órdenes duplicadas.
- **CA-04 - Historial:** se registra el estado inicial de la orden en `order_status_history`.
- **CA-05 - Consistencia del evento:** evento y tenant se validan; un fallo de persistencia permite reintentar sin perder la orden.
- **CA-06 - Aislamiento:** las consultas y operaciones de órdenes se filtran por tenant.

### Tareas y subtareas

- **T1 - Acordar el contrato de integración con HU 10**
  - ST1.1 Confirmar que Quotation publica `QuoteAccepted` solo después de aceptar una cotización vigente.
  - ST1.2 Definir el payload necesario: tenant, quote ID, user ID, datos del equipo, precio, moneda y fecha de aceptación.
  - ST1.3 Confirmar cómo obtener nombre y correo del cliente, obligatorios en la tabla `orders` actual y ausentes del snapshot de cotización.
  - ST1.4 Conservar `event_id`, `correlation_id` y `tenant_id` según la convención TE-02.

- **T2 - Crear el microservicio de órdenes**
  - ST2.1 Crear `services/orders` con configuración TypeScript, aplicación Express, acceso PostgreSQL y manejo de eventos.
  - ST2.2 Crear el Dockerfile de la aplicación Orders; la base de datos ya se provisiona con `orders-db`.
  - ST2.3 Configurar conexión a `reecicla_orders_db` y RabbitMQ mediante variables de entorno y `.env.example`.
  - ST2.4 Añadir el servicio de aplicación a Compose con dependencia de la BD y RabbitMQ.
  - ST2.5 Enrutar `/api/orders` desde el Gateway si la interfaz necesita consultar el resultado de la orden.

- **T3 - Procesar `QuoteAccepted`**
  - ST3.1 Consumir el evento y validar su estructura y tenant.
  - ST3.2 Crear orden y estado inicial en una transacción, usando el snapshot recibido.
  - ST3.3 Crear restricción/registro de eventos procesados en Orders DB si se necesita deduplicación por `event_id`.
  - ST3.4 Conservar la unicidad existente por `(tenant_id, quote_id)` como última defensa contra duplicados.
  - ST3.5 Corregir el orden de procesamiento/acknowledgement para registrar el evento como completado solo tras el éxito de la transacción.
  - ST3.6 Definir recuperación de duplicados y errores sin generar efectos dobles ni perder órdenes.

- **T4 - Integrar y verificar el flujo**
  - ST4.1 Verificar que la aceptación de HU 10 publica el evento acordado.
  - ST4.2 Verificar que Orders consume el evento y crea exactamente una orden.
  - ST4.3 Conectar la interfaz a aceptación/consulta de orden cuando el endpoint de HU 10 esté disponible.
  - ST4.4 Mantener cajas, etiquetas, seguimiento y envío fuera del alcance de HU 11; corresponden a HU posteriores.

- **T5 - Pruebas de HU 11**
  - ST5.1 Probar creación de orden con snapshot correcto y estado inicial.
  - ST5.2 Probar que se registra el historial inicial junto con la orden.
  - ST5.3 Reproducir el mismo evento y confirmar que queda una sola orden.
  - ST5.4 Forzar error durante la transacción y confirmar rollback y reintento exitoso.
  - ST5.5 Probar evento inválido, cotización/tenant ausente y aislamiento entre tenants.
  - ST5.6 Probar integración con Compose, PostgreSQL y RabbitMQ.

## Orden de ejecución

1. Revisar estado de Compose/volúmenes y corregir la incompatibilidad entre modelo y migración de Quotation.
2. Diseñar la migración incremental de HU 24, sin depender de recrear bases existentes.
3. Implementar y probar cuotas en Auth y su integración con creación de cotizaciones.
4. Acordar el contrato de `QuoteAccepted` con HU 10 y asegurar que incluye todos los datos que exige `orders`.
5. Crear y probar el servicio de Orders conectado a la base existente.
6. Añadir enrutamiento y, si aplica, consulta de resultado en frontend.
7. Ejecutar pruebas focalizadas y luego la prueba integrada del flujo completo.

## Cambios respecto a la versión anterior

### Baseline revisado

Antes de esta implementación, Compose ya tenía `orders-db` y el esquema SQL de órdenes, pero no existían la aplicación Orders, su Dockerfile ni la ruta del Gateway. Auth no administraba planes ni consumo mensual. Quotation podía crear/consultar cotizaciones, pero no validaba aceptación ni publicaba `QuoteAccepted`; además, su modelo de persistencia no coincidía con la migración activa.

### HU 24 - Delta implementado

| Antes | Ahora |
|---|---|
| No existían plan por tenant ni contador mensual. | Se agregaron `tenant_plans`, `quote_usage_counters` y `quote_usage_reservations`; los tenants reciben `FREE` por defecto y el periodo se calcula por mes UTC. |
| Crear cotizaciones no verificaba el límite del proveedor. | Quotation reserva cuota en Auth antes de insertar, confirma después de persistir y libera si falla. El límite se serializa en PostgreSQL para evitar exceder 20 con solicitudes simultáneas; Premium no limita. |
| No había operación para asignar Premium ni llamadas internas de cuota. | Se agregó `PATCH /api/auth/tenants/:tenantId/plan`, restringido a `SUPER_ADMIN`, más operaciones internas protegidas por `INTERNAL_SERVICE_TOKEN` para reservar, confirmar y liberar. |
| Los reintentos podían consumir cuota o crear cotizaciones repetidas. | Se admite `Idempotency-Key`; su UUID queda asociado a la cotización y permite recuperar el resultado ya creado. |
| El estado de reglas/cotizaciones no correspondía con el esquema PostgreSQL. | El modelo ahora resuelve el código del tipo desde Catálogo, guarda su UUID y snapshot, usa reglas versionadas y registra `pricing_rule_id`, moneda y vigencia según el esquema. |
| El endpoint de disponibilidad invocado no existía en Catálogo. | Quotation ahora consulta `GET /api/catalog/device-types` y valida estado y `accepts_quotes`. |

**Archivos HU 24:**

- Nuevos: `services/auth/db/02-tenant-quote-plans.sql`, `services/auth/db/03-quote-reservation-cascade.sql`, `services/auth/src/models/quotaModel.ts`, `services/auth/src/controllers/quotaController.ts`, `services/auth/src/middlewares/internalServiceMiddleware.ts` y `services/auth/tests/quota.integration.test.cjs`.
- Auth actualizados: `services/auth/src/controllers/authController.ts`, `services/auth/src/middlewares/authMiddleware.ts`, `services/auth/src/routes/authRoutes.ts`, `services/auth/src/services/authService.ts`, `services/auth/src/types/auth.ts`, `services/auth/package.json` y `services/auth/.env.example`.
- Quotation: nuevos `services/quotation/db/03-quotation-device-type-code.sql` y `services/quotation/db/05-quotation-idempotency.sql`; actualizados `services/quotation/db/02-quotation-migration.sql`, `services/quotation/src/controllers/quotationController.ts`, `services/quotation/src/middlewares/authMiddleware.ts`, `services/quotation/src/models/pricingRuleModel.ts`, `services/quotation/src/models/quoteModel.ts`, `services/quotation/src/services/quotationService.ts`, `services/quotation/src/types/quotation.ts`, `services/quotation/src/routes/quotationRoutes.ts` y `services/quotation/.env.example`.
- Interfaz: `reecicla-frontend/src/components/QuotationWizard.tsx` y `reecicla-frontend/src/services/api.ts` envían la clave idempotente y presentan el error del límite al usuario.

### HU 11 - Delta implementado

| Antes | Ahora |
|---|---|
| Existían tablas planeadas para órdenes, pero no servicio que las atendiera. | Se creó `services/orders` con Express/TypeScript, PostgreSQL, Dockerfile, health check y configuración de entorno; usa la BD Orders ya existente. |
| El Gateway no tenía ruta para órdenes. | Se agregó `GET /api/orders` y `GET /api/orders/:id`, protegidos por JWT y limitados a las órdenes del usuario/tenant autenticado. |
| Aceptar una cotización no era un flujo disponible en Quotation. | Se agregó `POST /api/quotation/quotes/:id/accept`: solo admite cotización propia, pendiente y vigente; guarda el cambio a `ACCEPTED` y el evento en una outbox dentro de una transacción. Esta ruta habilita la dependencia con HU 10; debe coordinarse con su responsable para no duplicar su endpoint. |
| Publicar el evento después de actualizar la cotización podía perder la orden si RabbitMQ no estaba disponible. | El relay despacha la outbox, espera confirmación del broker y reintenta eventos pendientes. Orders crea orden e historial en una transacción y confirma el mensaje solo después del commit. |
| Un evento repetido podía duplicar efectos o un fallo dejar el evento como procesado. | Se registra `event_id` dentro de la misma transacción de la orden; además se conserva la unicidad `(tenant_id, quote_id)`. Eventos malformados se descartan, errores transitorios se reintentan. |
| El historial frontend solo mostraba cotizaciones. | Se añadió la acción para aceptar cotizaciones pendientes y la sección de órdenes del usuario con número y estado. |

**Archivos HU 11:**

- Nuevo servicio: `services/orders/Dockerfile`, `services/orders/package.json`, `services/orders/package-lock.json`, `services/orders/tsconfig.json`, `services/orders/.env.example`, `services/orders/src/index.ts`, `services/orders/src/config/db.ts`, `services/orders/src/types/orders.ts`, `services/orders/src/middlewares/authMiddleware.ts`, `services/orders/src/domain/quoteAccepted.ts`, `services/orders/src/models/orderModel.ts`, `services/orders/src/messaging/eventConsumer.ts`, `services/orders/src/controllers/orderController.ts`, `services/orders/src/routes/orderRoutes.ts` y `services/orders/tests/orders.test.cjs`.
- Persistencia/Compose: `database/04-orders-processed-events.sql`, modificación de `database/03-orders-migration.sql` y cambios en `docker-compose.yml` para ejecutar Orders y montar sus migraciones.
- Gateway: `services/gateway/src/index.ts` y `services/gateway/.env.example`.
- Productor de evento: `services/quotation/db/04-quote-event-outbox.sql`, `services/quotation/db/06-quotation-processed-event-tenant.sql`, `services/quotation/src/messaging/eventBus.ts`, `services/quotation/src/messaging/quoteOutbox.ts` y `services/quotation/src/index.ts`.
- Contrato de identidad: `services/auth/src/services/authService.ts` y tipos Auth/Quotation incluyen el nombre del cliente en el JWT para completar el snapshot de la orden.
- Interfaz: `reecicla-frontend/src/components/QuoteHistory.tsx` y `reecicla-frontend/src/services/api.ts`.

### Cambios transversales

- `docker-compose.yml` configura `orders-service`, las migraciones incrementales, `CATALOG_SERVICE_URL`, `AUTH_SERVICE_URL`, un token interno local y un `JWT_SECRET` consistente entre servicios.
- El proxy Gateway usa `parseReqBody: false` para reenviar cuerpos HTTP sin el error `ERR_HTTP_HEADERS_SENT`.
- Auth y Quotation almacenan el JWT verificado en `req.authUser`, evitando el conflicto de tipos con `Request.user` de Express.
- Se agregaron migraciones incrementales para volúmenes existentes. Los cambios locales se aplicaron a Auth DB, Quotation DB y Orders DB sin borrar los volúmenes.
- Se agregaron scripts `npm test` en Auth y Orders. Verificación realizada: 25 reservas concurrentes dejaron exactamente 20 éxitos; la prueba de Premium pasó; Orders creó una sola orden e historial para eventos repetidos; el recorrido HTTP produjo una orden `ACCEPTED` con snapshot correcto.

### Estado Git al 2026-10-06

- Backend y frontend están en la rama local `feat/HU11`.
- Hay archivos modificados y nuevos sin commit.
- No se hizo commit ni push. La publicación queda a cargo de Alan.

**Cuidado con los volúmenes:** los scripts de `/docker-entrypoint-initdb.d` solo se ejecutan al inicializar un volumen vacío. Las bases existentes deben actualizarse con migraciones incrementales. No usar `docker compose down -v` para aplicar cambios.

### Aplicar migraciones en bases existentes

Desde la raíz del workspace, primero recrear los contenedores de BD para montar los scripts actuales y esperar a que estén listos:

```powershell
docker compose up -d auth-db quotation-db orders-db
docker compose exec -T auth-db pg_isready -U reecicla_user -d reecicla_auth_db
docker compose exec -T quotation-db pg_isready -U reecicla_user -d reecicla_quotation_db
docker compose exec -T orders-db pg_isready -U reecicla_user -d reecicla_orders_db
```

Luego ejecutar únicamente las migraciones incrementales:

```powershell
docker compose exec -T auth-db psql -v ON_ERROR_STOP=1 -U reecicla_user -d reecicla_auth_db -f /docker-entrypoint/initdb.d/02-tenant-quote-plans.sql
docker compose exec -T auth-db psql -v ON_ERROR_STOP=1 -U reecicla_user -d reecicla_auth_db -f /docker-entrypoint/initdb.d/03-quote-reservation-cascade.sql
docker compose exec -T quotation-db psql -v ON_ERROR_STOP=1 -U reecicla_user -d reecicla_quotation_db -f /docker-entrypoint/initdb.d/03-quotation-device-type-code.sql
docker compose exec -T quotation-db psql -v ON_ERROR_STOP=1 -U reecicla_user -d reecicla_quotation_db -f /docker-entrypoint/initdb.d/04-quote-event-outbox.sql
docker compose exec -T quotation-db psql -v ON_ERROR_STOP=1 -U reecicla_user -d reecicla_quotation_db -f /docker-entrypoint/initdb.d/05-quotation-idempotency.sql
docker compose exec -T quotation-db psql -v ON_ERROR_STOP=1 -U reecicla_user -d reecicla_quotation_db -f /docker-entrypoint/initdb.d/06-quotation-processed-event-tenant.sql
docker compose exec -T orders-db psql -v ON_ERROR_STOP=1 -U reecicla_user -d reecicla_orders_db -f /docker-entrypoint/initdb.d/04-orders-processed-events.sql
```

Los scripts usan `IF NOT EXISTS` o `ADD COLUMN IF NOT EXISTS` cuando aplica para que puedan repetirse sin borrar datos.

## Registro de avance

| Fecha | HU | Avance | Validación / notas |
|---|---|---|---|
| 2026-10-05 | HU 11 y HU 24 | Análisis, criterios y desglose inicial documentados. | Inicio de implementación y verificación local registrados en las filas siguientes. |
| 2026-10-05 | HU 24 | Plan FREE/PREMIUM, reserva/confirmación/liberación e integración con creación de cotizaciones implementados. | Prueba contra Auth DB: 25 solicitudes simultáneas, exactamente 20 reservas exitosas; prueba de reintento, liberación y Premium pasó. |
| 2026-10-05 | HU 11 | Servicio Orders, outbox `QuoteAccepted`, historial y consulta por usuario implementados. | Pruebas de Orders: snapshot e idempotencia contra PostgreSQL pasaron; recorrido HTTP de aceptación produjo orden `ACCEPTED` con un historial. |
| 2026-10-05 | Integración | Gateway, Compose, frontend y migraciones incrementales conectados; se conservaron los volúmenes existentes. | `docker compose config --quiet` y builds de Auth, Quotation, Orders, Gateway y frontend pasaron. |

## Pendientes de revisión

- Coordinar con la persona responsable de HU 10 para consolidar la ruta/contrato de aceptación y evitar implementaciones duplicadas.
- Acordar si el límite mensual usa mes calendario UTC; la implementación actual usa ese criterio.
- Endurecer `INTERNAL_SERVICE_TOKEN` y `JWT_SECRET` para despliegues fuera del entorno local; los valores por defecto de Compose son solo de desarrollo.
- Revisar con el equipo la exposición de `PATCH /api/auth/tenants/:tenantId/plan`, restringida a `SUPER_ADMIN`, y definir el flujo administrativo para activar Premium.
- Las integraciones se validaron contra bases locales; repetirlas en el entorno compartido antes de cerrar el sprint.
