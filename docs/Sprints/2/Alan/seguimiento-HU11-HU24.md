# Sprint 2 - Seguimiento HU 11 y HU 24

**Responsable:** Alan  
**Estado:** Preparación; implementación pendiente.  
**Fuentes:** `docs/Reecicla definitivo.pdf`, `docs/Kata_PolloChingon.pdf` y plantilla `docs/plantillaDeHUs.csv`.

> La plantilla se usa únicamente como formato para historias, criterios de aceptación, tareas, subtareas y pruebas. Su contenido funcional pertenece a otro proyecto y no se traslada a Reecicla.

## Estado del proyecto relevante

- El Sprint 2 incluye HU 11 (Orders, Must, 5 puntos) y HU 24 (Auth/Tenant, Should, 5 puntos).
- Docker Compose ya define una base independiente `reecicla_orders_db` (`orders-db`, puerto local `5433`) y monta `database/03-orders-migration.sql`. No hace falta crear otra base de datos.
- La migración de órdenes ya contempla `orders`, `order_status_history`, `box_requests` y `dispositions`, además de unicidad por tenant y cotización. Caja/envío y destino final corresponden a historias posteriores; no se implementan como parte de HU 11.
- Todavía no hay un módulo `services/orders`, su Dockerfile de aplicación ni una ruta de órdenes en el Gateway.
- Auth ya tiene tenants y usuarios, pero su migración activa no incluye planes ni contadores mensuales para HU 24.
- Quotation permite crear y consultar cotizaciones, pero no tiene ruta de aceptación/rechazo ni publica `QuoteAccepted`. HU 10 es dependencia para el flujo de HU 11: coordinar el contrato del evento con su responsable, sin duplicar esa historia.
- Hay una discrepancia que debe resolverse antes de probar cotizaciones: `services/quotation/src/models/quoteModel.ts` inserta `device_type`, mientras `services/quotation/db/02-quotation-migration.sql` define `device_type_id` y `device_type_name`; además la migración requiere campos que el modelo no inserta, como `pricing_rule_id` y `valid_until`.
- El consumidor RabbitMQ existente guarda el ID de evento procesado antes de ejecutar el handler. Si el handler falla, el reintento podría ignorarse; revisar este comportamiento para HU 11.
- No se encontraron pruebas automatizadas existentes ni scripts de test en los servicios revisados. Añadir pruebas focalizadas al módulo correspondiente.

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

**Cuidado con los volúmenes:** los scripts de `/docker-entrypoint-initdb.d` solo se ejecutan al inicializar un volumen vacío. Las bases existentes deben actualizarse con migraciones incrementales. No usar `docker compose down -v` para aplicar cambios.

## Registro de avance

| Fecha | HU | Avance | Validación / notas |
|---|---|---|---|
| 2026-10-05 | HU 11 y HU 24 | Análisis y desglose inicial documentados; código aún sin cambios. | Pendiente acordar contrato de `QuoteAccepted` con HU 10. |
