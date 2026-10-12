# Prompt para generar la presentación de HU 11 y HU 24

Copia el contenido entre las marcas y pégalo en Claude. Adjunta también el documento `seguimiento-HU11-HU24.md` si necesitas que Claude contraste la información con el registro de trabajo.

---

## Prompt

Crea una presentación PowerPoint profesional, técnica y clara, en español, para exponer al ingeniero del proyecto la implementación realizada por Alan para las historias HU 11 y HU 24 del Sprint 2 del sistema Reecicla.

### Audiencia y propósito

La audiencia es un ingeniero de software que conoce el proyecto, la arquitectura de microservicios, PostgreSQL, Docker Compose y RabbitMQ. La presentación debe explicar qué problema resuelve cada HU, qué componentes se implementaron, cómo se conectan, qué decisiones técnicas se tomaron y cómo se verificaron. No debe ser una exposición comercial ni describir funcionalidades que no están implementadas.

Duración objetivo: 8 a 10 minutos. Prepara de 9 a 11 diapositivas y añade notas breves para el presentador en cada una. Mantén las diapositivas legibles, usa diagramas de secuencia/arquitectura donde aclaren el flujo y evita párrafos largos. Cierra con una demo reproducible y los límites conocidos.

### Contexto del producto

Reecicla es una plataforma multitenant que cotiza equipos electrónicos usados para iniciar su reciclaje. El sistema está organizado en microservicios TypeScript/Express con bases PostgreSQL separadas, un API Gateway y RabbitMQ. El cliente declara tipo, marca, modelo, año y condición del dispositivo.

El Sprint 2 incluye:

- **HU 11 - Orders, Must, 5 puntos:** como cliente, quiero que aceptar una cotización genere una orden para iniciar el reciclaje.
- **HU 24 - Auth/Tenant, Should, 5 puntos:** como proveedor, quiero un plan gratuito con límites para probar el servicio antes de pagar. El plan gratuito permite 20 cotizaciones al mes, bloquea al superar el máximo con un mensaje claro, reinicia el contador cada mes y Premium no tiene límite.

La plantilla `plantillaDeHUs.csv` pertenece a otro proyecto; solo se utilizó como referencia de formato, no como fuente funcional.

### HU 24: implementación técnica

Explica el delta frente al baseline: antes Auth no tenía planes por tenant ni contadores mensuales, y crear cotizaciones no comprobaba una cuota.

Implementación:

- Auth es dueño del plan del tenant (`FREE` o `PREMIUM`) y del contador mensual.
- Se agregaron `tenant_plans`, `quote_usage_counters` y `quote_usage_reservations` en Auth DB.
- Los tenants nuevos y los existentes sin plan reciben `FREE` por defecto.
- El periodo utilizado es el mes calendario en UTC.
- Auth reserva cuota dentro de una transacción y PostgreSQL actualiza el contador de forma atómica; las solicitudes simultáneas no pueden superar 20 para FREE.
- Quotation solicita la reserva a Auth mediante endpoints internos protegidos por `INTERNAL_SERVICE_TOKEN`; confirma al guardar la cotización y libera la reserva si falla la inserción.
- `Idempotency-Key` se guarda en la cotización para que un reintento de la misma solicitud no cree otra cotización ni consuma otra cuota.
- Al llegar al límite FREE, la API responde HTTP 429 y un mensaje que explica el máximo y la opción Premium.
- Existe `PATCH /api/auth/tenants/:tenantId/plan`, restringido al rol `SUPER_ADMIN`, para cambiar el plan; no hay procesamiento de pagos ni facturación porque HU 24 no lo pide.

Incluye una secuencia breve: cliente → Quotation → Auth/reserva → Quotation/PostgreSQL → Auth/confirmación. Muestra en qué punto se bloquea la solicitud 21.

### HU 11: implementación técnica

Explica el delta frente al baseline: ya existían `orders-db` y tablas SQL para órdenes, pero no había aplicación Orders conectada al flujo de cotización ni una ruta del Gateway para consultar órdenes.

Implementación:

- Se creó `services/orders` con Express/TypeScript, Dockerfile, configuración PostgreSQL, autenticación JWT, rutas, modelo y consumidor RabbitMQ.
- Se reutiliza `reecicla_orders_db` (`orders-db`, puerto local 5433); no se creó una base nueva.
- La aceptación se realiza en `POST /api/quotation/quotes/:id/accept`. Comprueba que la cotización pertenece al usuario/tenant, sigue `PENDING` y no venció.
- La aceptación cambia el estado a `ACCEPTED` y guarda `QuoteAccepted` en una outbox dentro de la misma transacción de Quotation DB.
- El relay publica el evento en el exchange `reecicla.events`, routing key `quote.accepted`, con `event_id`, `correlation_id`, `tenant_id` y snapshot de cliente/cotización. Espera confirmación del broker y vuelve a intentar eventos aún no publicados.
- Orders consume en la cola durable `orders.quote-accepted.queue`.
- En una transacción, Orders registra el evento procesado, crea la orden con estado inicial `ACCEPTED` y copia marca, modelo, año y condición; también agrega el primer registro en `order_status_history`.
- La idempotencia se apoya en `processed_events` por `event_id` y en la restricción única `(tenant_id, quote_id)`. Un evento inválido se descarta; un fallo transitorio se reintenta.
- El Gateway expone `/api/orders`; `GET /api/orders` y `GET /api/orders/:id` solo entregan órdenes del usuario y tenant autenticados.
- El historial del frontend permite aceptar una cotización pendiente y muestra las órdenes del cliente.

Incluye un diagrama de secuencia: cliente/frontend → Gateway → Quotation → outbox → RabbitMQ → Orders DB → consulta `/api/orders`.

### Evidencia de pruebas verificada

Presenta estos resultados como verificaciones locales, no como resultados de CI:

- Auth integration: 25 reservas simultáneas para un tenant FREE producen exactamente 20 aceptaciones; una reserva repetida no incrementa el contador; el intento adicional se rechaza; liberar una reserva recupera un cupo; Premium permite pasar de 20.
- Orders integration contra PostgreSQL: se procesa `QuoteAccepted`, se crea una orden con snapshot y un único estado inicial; repetir el mismo evento y recibir otro evento para la misma cotización no duplica orden ni historial.
- Recorrido HTTP local: registro de cliente, creación de cotización, aceptación, publicación RabbitMQ y consulta de una orden `ACCEPTED` con marca/modelo/año/condición correctos y un registro de historial.
- `npm test` de Auth y Orders, builds de Auth, Quotation, Orders, Gateway y frontend, además de `docker compose config --quiet`, pasaron durante la validación.

No inventes tiempos p95, cobertura porcentual, métricas de producción ni resultados de CI: no se midieron para esta implementación.

### Migraciones e integración

Muestra que Compose ya tenía bases separadas para Auth, Quotation y Orders y que HU 11 reutiliza Orders DB. Las migraciones nuevas son incrementales para poder actualizar volúmenes existentes; los scripts de `/docker-entrypoint-initdb.d` solo corren automáticamente cuando PostgreSQL inicializa un volumen vacío. No se deben borrar volúmenes para presentar.

El Gateway y los servicios necesitan configuración coherente en Compose: `JWT_SECRET` igual entre Auth/Quotation/Orders, URL interna de Catálogo, URL interna de Auth para las cuotas y `INTERNAL_SERVICE_TOKEN` compartido. No muestres secretos, contraseñas ni tokens en diapositivas.

### Alcance y caveats que debes respetar

- HU 11 termina al crear la orden y registrar el historial inicial. La solicitud/envío/seguimiento de caja corresponde a HU posteriores (HU 12/HU 13). No los presentes como parte de lo implementado para HU 11, aunque existan cambios posteriores en esas ramas.
- La ruta de aceptación también cubre el punto de integración de HU 10. Indica que debe coordinarse con quien mantiene HU 10 para evitar mantener dos contratos distintos.
- El seed de `services/auth/db/01-auth-migration.sql` inserta literalmente `superadmin123` en `password_hash`, aunque el login compara con bcrypt. Por lo tanto, no afirmes que el acceso inicial de `SUPER_ADMIN` para cambiar a Premium fue demostrado. La prueba de Premium se verificó a nivel de integración del modelo de cuota. Menciona este seed como pendiente de corrección/verificación.
- No incluyas correos de clientes de prueba ni tokens. Usa datos sintéticos.
- El repositorio raíz y los repositorios backend/frontend están separados. No afirmes que el `docker-compose.yml` de la raíz forma parte de los PRs de backend o frontend.

### Demo sugerida

Prepara una demo de 2 a 3 minutos, separada en dos partes:

Antes de presentar, verifica que el checkout local del frontend esté actualizado con `origin/main`: una copia local antigua puede no mostrar aún el botón de aceptar, aunque el cambio ya esté integrado en GitHub.

1. **HU 24:** en una base local de demostración, ajustar el contador FREE del tenant demo al valor 19. Crear una cotización: debe permitirse y llegar a 20. Crear otra: debe responder HTTP 429 con el mensaje de límite. Restaurar luego el contador y no ejecutar este ajuste en una base compartida o productiva. Como segunda prueba, explicar Premium usando el test de integración, salvo que el `SUPER_ADMIN` se haya corregido y su ruta de cambio de plan se haya verificado antes de presentar.
2. **HU 11:** iniciar sesión como cliente demo, crear cotización, abrir el historial, aceptarla y actualizar la lista hasta ver la orden `ACCEPTED`. Si RabbitMQ tarda unos segundos, explicar que la creación es asíncrona y que `QuoteAccepted` queda en outbox para reintento.

Para cada parte indica qué pantalla o endpoint se muestra y qué resultado espera ver el ingeniero. Incluye como respaldo las consultas de BD/eventos, pero no dependas exclusivamente de Postman o SQL: la demo principal debe mostrar el recorrido del cliente.

### Estructura obligatoria de diapositivas

1. Título, responsable y objetivo de la exposición.
2. Historias asignadas, criterios de aceptación y alcance de Sprint 2.
3. Baseline: qué faltaba antes de HU 11/24.
4. Arquitectura y límites de responsabilidad por microservicio/base.
5. HU 24: modelo de plan/contador y reserva atómica.
6. HU 24: respuestas esperadas, pruebas de límite, concurrencia y Premium.
7. HU 11: flujo de aceptación con outbox y RabbitMQ.
8. HU 11: persistencia de orden, snapshot, historial e idempotencia.
9. Evidencia de pruebas y recorrido integrado.
10. Demo paso a paso.
11. Decisiones, límites conocidos y siguientes acciones.

Entrega el contenido final organizado por diapositiva, con título, 3 a 5 bullets cortos, sugerencia visual/diagrama y notas del presentador de 2 a 4 frases. Si puedes generar archivos, entrega también el `.pptx`; si no, deja el contenido listo para copiar a PowerPoint. Mantén los términos técnicos en inglés cuando sean nombres exactos del código, como `QuoteAccepted`, `outbox`, `tenant_id` e `Idempotency-Key`.

---
