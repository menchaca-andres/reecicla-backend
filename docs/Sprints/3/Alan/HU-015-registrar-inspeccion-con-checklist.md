# HU-015 — Registrar inspección con checklist

| Campo        | Valor                                  |
|--------------|----------------------------------------|
| Clave Jira   | SCRUM-17                               |
| Sprint       | 3                                      |
| Módulo       | Inspection (microservicio nuevo)       |
| Prioridad    | Must / High                            |
| Estimación   | 8 puntos                               |
| Responsable  | Alan Maldonado                         |
| Rama         | `feat/HU15` (backend y frontend)       |
| Estado       | Implementada en `feat/HU15`, sin merge |

Formato tomado de `docs/plantillaDeHUs.csv` (historia → criterios de aceptación → Definition of Done → tareas `T#_HU15` → subtareas `ST#.#`). El contenido funcional sale del kata, de `Reecicla definitivo.pdf` (secciones 4, 5 y 8) y de `docs/script.sql`.

---

## Historia

Como **inspector**, quiero **registrar la inspección con la checklist del tipo**, para **documentar la condición real del equipo**.

## Objetivo

Permitir que un usuario con rol `INSPECTOR` registre la inspección de un equipo ya recibido en almacén, respondiendo la checklist vigente de su tipo de dispositivo.

La inspección es el punto donde el sistema deja de trabajar con lo que el cliente *declaró* y empieza a trabajar con lo que el equipo *es*. Lo que se guarde aquí es la base de:

```
INSPECCIÓN (HU-015)
   │
   ├── Resultado reventa / reciclaje ........ HU-016
   ├── Cotización ajustada .................. HU-017
   └── Destino final del equipo ............. HU-025
```

### Dónde encaja en el flujo

```
Orders ── DeviceReceived ──► Inspection ──(REST)──► Catalog
 (HU-014)                     (HU-015)               (HU-008: checklist vigente)
                                  │
                                  └── InspectionRegistered (evento, outbox)
```

- **Inspection** es un microservicio nuevo con su propia base (`reecicla_inspection_db`). No hay claves foráneas hacia otras bases: `order_id`, `device_type_id`, `evaluation_rule_id` e `inspected_by_user` son referencias lógicas.
- Inspection se entera de qué equipos hay para inspeccionar **consumiendo `DeviceReceived`** (no consulta a Orders).
- La checklist se pide a **Catalog por REST** en el momento de inspeccionar, porque el inspector espera respuesta inmediata.

### Fuera de alcance

- Determinar el resultado `RESALE` / `RECYCLE`, publicar `InspectionCompleted` y pasar la orden a `INSPECTED` → **HU-016**.
- Emitir la cotización ajustada → **HU-017**.
- Subir archivos de evidencia. Esta HU guarda **referencias** (URL o código de la foto), no los archivos.
- Reinspección de una orden que ya tiene inspección.

---

## Criterios de aceptación

Los tres primeros grupos corresponden a los CA oficiales del backlog; el resto los detalla.

### CA-01 — Solo el inspector registra

Solo un usuario autenticado con rol `INSPECTOR` puede registrar una inspección.

```
Sin JWT                      → 401
JWT con rol CLIENT           → 403
JWT con rol TENANT_ADMIN     → 403   (puede consultar, no registrar)
JWT con rol INSPECTOR        → permitido
```

### CA-02 — Solo equipos recibidos

Solo se puede inspeccionar una orden cuyo equipo fue recibido (`DeviceReceived` procesado) y que pertenece al tenant del inspector. En otro caso:

```
Orden desconocida o de otro tenant → 404
```

### CA-03 — Checklist del tipo y versión vigente

La checklist mostrada al inspector es la regla de evaluación **activa** del tipo de dispositivo de la orden, obtenida de Catalog. La inspección guarda qué regla se usó:

```
evaluation_rule_id      = id de la regla
evaluation_rule_version = 3
```

### CA-04 — Versión desactualizada

Si la regla vigente cambió entre que el inspector abrió el formulario y lo envió, el sistema rechaza el registro y pide recargar la checklist.

```
Formulario cargado con versión 2
Catalog publica versión 3
POST con versión 2 → 409 "La checklist cambió. Recarga e inténtalo de nuevo."
```

### CA-05 — Tipo sin checklist vigente

Si el tipo no tiene regla de evaluación activa, no se puede registrar la inspección y se informa con un mensaje claro (409).

### CA-06 — Validación de ítems

El sistema valida las respuestas contra la checklist vigente:

```
Ítem required sin respuesta        → rechazado
boolean  → true / false
number   → número finito
text     → texto no vacío
select   → uno de los valores de options
Clave que no existe en la checklist → rechazado
Clave repetida                      → rechazado
```

Los errores se devuelven agrupados (400) indicando el ítem afectado.

### CA-07 — Se guardan los ítems

Cada ítem respondido se guarda normalizado en `inspection_items`, con una copia de la etiqueta y el tipo del criterio tal como estaban al inspeccionar. Si la checklist cambia después, la inspección no se altera.

### CA-08 — Se guardan las observaciones

El inspector puede registrar una observación por ítem y una observación general. La condición real observada del equipo (`actual_condition`) es obligatoria.

### CA-09 — Se guardan las referencias de evidencia

Se pueden registrar referencias de evidencia por ítem y a nivel de inspección (URL o código de la foto). Son opcionales, se guardan como lista y tienen límite de cantidad y longitud.

### CA-10 — Una inspección por orden

Una orden tiene una sola inspección. Un segundo registro —incluido un doble envío del formulario— devuelve 409 y no duplica datos.

### CA-11 — Registro atómico

La inspección, sus ítems y el evento se guardan en una sola transacción. Si algo falla, no queda nada a medias.

### CA-12 — Auditoría

La inspección guarda quién la registró (`inspected_by_user`, tomado del JWT, nunca del body) y cuándo (`inspected_at`).

### CA-13 — Aislamiento por tenant

Toda consulta y escritura se filtra por el `tenant_id` del JWT. Un inspector no puede ver ni registrar inspecciones de otro tenant.

### CA-14 — Consulta

`INSPECTOR`, `TENANT_ADMIN` y `SUPER_ADMIN` pueden listar los equipos pendientes de inspección y ver una inspección ya registrada con sus ítems.

### CA-15 — Confirmación y errores

Al registrar se muestra una confirmación. Los errores se muestran de forma comprensible, sin SQL, stack traces ni información interna.

---

## Definition of Done

- ☑ Modelo de datos de Inspection revisado frente a `docs/script.sql`
- ☑ Migraciones de `reecicla_inspection_db` implementadas
- ☑ Microservicio `inspection` creado (Dockerfile, package.json, tsconfig)
- ☑ Servicio y base agregados a `docker-compose.yml` con healthcheck
- ☑ Ruta `/api/inspections` agregada al Gateway
- ☑ Consumidor idempotente de `DeviceReceived` implementado
- ☑ Cliente REST hacia Catalog implementado
- ☑ Validación de checklist implementada
- ☑ Endpoints implementados y protegidos por rol
- ☑ Evento `InspectionRegistered` publicado mediante outbox
- ☑ Pantalla de inspección implementada en el frontend
- ☑ Pruebas unitarias y de integración pasando
- ☑ Flujo completo verificado con `docker compose up`
- ☑ Contrato de API y de eventos documentado
- ☑ Sin FKs entre bases ni consultas directas a bases ajenas
- ☑ Cambios documentados en `docs/Sprints/3/Alan`
- ☐ Código revisado por un compañero (sin merge a `main` hasta entonces)

Pendiente además: la pantalla compila y está desplegada, pero falta probarla a mano en el navegador. El detalle de lo implementado y verificado está en `HU-015-cambios-implementados.md`.

---

## Tareas y subtareas

Ordenadas del nivel más bajo (datos) al más alto (interfaz), y al final las pruebas. Cada tarea deja el sistema en un estado que arranca.

### T1_HU15 Revisar y ajustar el modelo de inspección

Definir las tablas antes de escribir código. El `script.sql` es la base, con los ajustes que exige esta HU.

- ST1.1 Revisar las tablas `inspections` e `inspection_items` de `docs/script.sql`.
- ST1.2 Hacer `inspections.result` nullable: el resultado lo define HU-016.
- ST1.3 Agregar `inspections.status` (`REGISTERED` → `COMPLETED`).
- ST1.4 Agregar `evaluation_rule_version` y `evidence_refs` a `inspections`.
- ST1.5 Agregar `criterion_type`, `value` y `evidence_refs` a `inspection_items`.
- ST1.6 Definir la tabla `received_devices` (equipos recibidos, alimentada por eventos).
- ST1.7 Definir `processed_events` y `domain_event_outbox`, igual que en Orders.
- ST1.8 Definir restricciones: una inspección por orden, un ítem por criterio.

### T2_HU15 Implementar el modelo de datos

- ST2.1 Crear `services/inspection/db/01-inspection-migration.sql`.
- ST2.2 Crear tabla `received_devices`.
- ST2.3 Crear tablas `inspections` e `inspection_items` con sus CHECK.
- ST2.4 Crear `processed_events` y `domain_event_outbox`.
- ST2.5 Crear índices por `tenant_id` y `order_id`.
- ST2.6 Actualizar la sección INSPECTION DB de `docs/script.sql`.
- ST2.7 Verificar que la migración corre en una base vacía.

### T3_HU15 Crear el microservicio y su infraestructura

- ST3.1 Crear `services/inspection` (package.json, tsconfig, `.env.example`).
- ST3.2 Crear el `Dockerfile` (multi-stage, puerto 3005).
- ST3.3 Crear `config/db.ts` e `index.ts` con `/health`.
- ST3.4 Agregar `inspection-db` a `docker-compose.yml` (puerto host 5436, healthcheck).
- ST3.5 Agregar `inspection-service` a `docker-compose.yml` (espera a su base y a RabbitMQ).
- ST3.6 Agregar `INSPECTION_SERVICE_URL` y la ruta `/api/inspections` al Gateway.
- ST3.7 Verificar que `docker compose up` levanta los 13 contenedores.

### T4_HU15 Implementar mensajería

- ST4.1 Definir los tipos `DomainEvent` y `DeviceReceivedPayload`.
- ST4.2 Validar el evento `DeviceReceived` (ids, fecha, tipo).
- ST4.3 Consumir `device.received` en la cola `inspection.device-received.queue`.
- ST4.4 Registrar el equipo en `received_devices` de forma idempotente (`processed_events`).
- ST4.5 Implementar el publicador con outbox.
- ST4.6 Definir el evento `InspectionRegistered` (`inspection.registered`).

### T5_HU15 Implementar persistencia

- ST5.1 Crear `ReceivedDeviceModel` (registrar, listar pendientes, buscar por orden).
- ST5.2 Crear `InspectionModel.create` con transacción: inspección + ítems + outbox.
- ST5.3 Traducir la violación de unicidad a "la orden ya fue inspeccionada".
- ST5.4 Implementar consulta de inspección por orden con sus ítems.
- ST5.5 Implementar listado de inspecciones del tenant.
- ST5.6 Filtrar toda consulta por `tenant_id`.

### T6_HU15 Implementar lógica de negocio

- ST6.1 Crear el cliente REST de Catalog (`evaluation-rules/active`).
- ST6.2 Manejar Catalog caído o sin regla vigente.
- ST6.3 Implementar la validación de respuestas contra la checklist (función pura).
- ST6.4 Validar `actual_condition`, observaciones y referencias de evidencia.
- ST6.5 Verificar que la versión enviada es la vigente.
- ST6.6 Crear `InspectionService.register` que orquesta los pasos anteriores.
- ST6.7 Definir errores de dominio con su código HTTP.

### T7_HU15 Implementar endpoints

- ST7.1 `GET /api/inspections/pending` — equipos recibidos sin inspección.
- ST7.2 `GET /api/inspections/orders/:orderId/checklist` — checklist vigente de la orden.
- ST7.3 `POST /api/inspections` — registrar la inspección.
- ST7.4 `GET /api/inspections/orders/:orderId` — inspección de una orden.
- ST7.5 `GET /api/inspections` — inspecciones del tenant.
- ST7.6 Definir respuestas 400, 401, 403, 404, 409 y 502.
- ST7.7 Documentar el contrato.

Request de ejemplo:

```json
{
  "order_id": "8b0f...",
  "evaluation_rule_id": "3c1a...",
  "evaluation_rule_version": 1,
  "actual_condition": "damaged",
  "observations": "Golpe en la puerta lateral.",
  "evidence_refs": ["https://fotos.example/ord-12/general.jpg"],
  "items": [
    { "criterion_key": "cooling_works", "value": true },
    { "criterion_key": "cosmetic_condition", "value": 4,
      "observation": "Abolladura visible",
      "evidence_refs": ["https://fotos.example/ord-12/puerta.jpg"] }
  ]
}
```

### T8_HU15 Implementar autorización

- ST8.1 Crear el middleware de autenticación JWT (mismo `JWT_SECRET` que los demás servicios).
- ST8.2 Crear `authorizeRoles`.
- ST8.3 Restringir `POST /api/inspections` a `INSPECTOR`.
- ST8.4 Permitir las consultas a `INSPECTOR`, `TENANT_ADMIN` y `SUPER_ADMIN`.
- ST8.5 Tomar `tenant_id` y `user_id` siempre del token.

### T9_HU15 Implementar interfaz

- ST9.1 Agregar los tipos `Inspection`, `InspectionItem` y `PendingInspection`.
- ST9.2 Agregar los métodos a `ApiService`.
- ST9.3 Crear `features/inspeccion` con `InspectionManager`.
- ST9.4 Mostrar la lista de equipos pendientes de inspección.
- ST9.5 Renderizar el formulario según el tipo de cada ítem (boolean, number, text, select).
- ST9.6 Agregar observación y referencias de evidencia por ítem.
- ST9.7 Agregar condición real, observación general y evidencia general.
- ST9.8 Validar ítems obligatorios antes de enviar.
- ST9.9 Mostrar confirmación y errores; ante 409 por versión, recargar la checklist.
- ST9.10 Mostrar el detalle de una inspección ya registrada (solo lectura).
- ST9.11 Agregar la pestaña "Inspección" al Navbar y a `App.tsx` según rol.
- ST9.12 Ocultar el botón de registrar a quien no sea `INSPECTOR`.

### T10_HU15 Pruebas

Unitarias (sin base de datos):

- ST10.1 Checklist completa y válida.
- ST10.2 Ítem obligatorio sin responder.
- ST10.3 Valor con tipo incorrecto en cada tipo de ítem.
- ST10.4 `select` con valor fuera de `options`.
- ST10.5 Clave desconocida y clave repetida.
- ST10.6 Ítem opcional omitido.
- ST10.7 Evento `DeviceReceived` válido e inválido.

Integración (con `reecicla_inspection_db`):

- ST10.8 Registrar una inspección guarda inspección, ítems y evento en outbox.
- ST10.9 Segundo registro de la misma orden es rechazado y no duplica.
- ST10.10 `DeviceReceived` repetido no duplica el equipo recibido.
- ST10.11 Una orden de otro tenant no es visible.

Extremo a extremo (por el Gateway, con Docker):

- ST10.12 Sin token → 401.
- ST10.13 Rol distinto de `INSPECTOR` → 403 al registrar.
- ST10.14 Flujo completo: recibir equipo → aparece como pendiente → cargar checklist → registrar → consultar.
- ST10.15 Versión de checklist desactualizada → 409.
- ST10.16 Tipo sin regla vigente → 409.
