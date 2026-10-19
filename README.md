# Reecicla Backend — Arquitectura de Microservicios (Kata Pollo Chingón) ⚙️

Ecosistema de microservicios independientes construidos con **Node.js**, **TypeScript**, **Express** y **PostgreSQL**, orquestados mediante **Docker Compose**. Implementa una arquitectura SaaS multitenant con aislamiento de bases de datos por microservicio.

---

## 🏗️ Mapa de Módulos y Microservicios (Sprint 1)

### 1. API Gateway (`reecicla-gateway`)
- **Puerto Host**: `3000`
- **Responsabilidad**: Punto de entrada único para clientes HTTP y frontend. Administra CORS y enrutamiento dinámico con proxy inverso.

### 2. Auth Service (`reecicla-auth-service`)
- **Puerto interno**: `3001` | **Base de Datos**: `reecicla_auth_db` (`localhost:5431`, solo local)
- **Tablas Propietarias**: `users`, `roles`, `sessions`
- **Funcionalidades (HU-001, HU-002, HU-003)**:
  - Registro de clientes con hashing seguro `bcrypt` (10 rounds). Asignación automática del rol `CLIENT` (protección contra elevación de privilegios).
  - Inicio de sesión por tenant y emisión de tokens `JWT` con firma de `role`.
  - Endpoint de contexto de perfil (`GET /api/auth/me`).

### 3. Quotation Service (`reecicla-quotation-service`)
- **Puerto interno**: `3002` | **Base de Datos**: `reecicla_quotation_db` (`localhost:5435`, solo local)
- **Tablas Propietarias**: `quotes`, `pricing_rules`
- **Funcionalidades (HU-004, HU-005)**:
  - **Motor de Reglas de Valoración (`JSONB`)**: Configuración de precio base y ajustes por condición (`working`, `damaged`, `broken`) protegida por RBAC (exclusivo rol `ADMIN`).
  - **Motor de Cotización**: Cálculo automático de precio final ofrecido en Bolivianos (**Bs.**) en estado `PENDING`.
  - **Historial**: Consulta de cotizaciones filtradas por tenant y usuario.

### 4. Bases de Datos de Infraestructura (Sprints 2 - 4)
- **Catalog DB** (`reecicla-catalog-db`): Puerto `5434`
- **Orders DB** (`reecicla-orders-db`): Puerto `5433`

### 5. Payment Service (HU-019)
- **Puerto interno**: `3006` | **Base de Datos**: `reecicla_payment_db` (`localhost:5437`, solo local)
- **Responsabilidad**: Registrar transferencias o cheques ejecutados por el administrador del negocio, guardar comprobantes en almacenamiento privado y publicar el evento `PaymentCompleted` para actualizar la orden a `PAID`.
- El importe se obtiene de `final_price` en Orders; el cliente no puede enviarlo. `Idempotency-Key` evita duplicar un pago. Payment genera automáticamente un comprobante PDF de Reecicla; el operador puede adjuntar opcionalmente evidencia bancaria PDF, JPG o PNG (máximo 5 MB).
- Al completar una inspección de reventa sin cambio de condición, Orders confirma el precio de cotización ya aceptado y deja la orden en `PAYMENT_PENDING`; con cambio de condición, espera la aceptación del precio ajustado.
- Los archivos se guardan en almacenamiento privado y solo se descargan mediante rutas autenticadas para el cliente dueño de la orden o el administrador del negocio.

### HU-020 — Reintentos de pago
- Cada intento queda como un registro independiente con su propia clave de idempotencia. Si el adaptador de pago falla, se conserva como `FAILED`, se registra el motivo y Payment publica `PaymentFailed` desde su outbox.
- Se puede iniciar un nuevo intento mientras la orden siga pendiente; los intentos `FAILED` no impiden reintentar. Un intento `PENDING` evita solicitudes simultáneas y el índice único parcial mantiene un solo pago `COMPLETED` por orden y negocio.
- El operador ve los intentos y sus motivos en Logística; tras un fallo, el botón permite iniciar un nuevo intento. El cliente puede consultar el estado en su historial.

### HU-021 — Seguimiento y notificaciones
- El cliente autenticado consulta la línea de tiempo de estados y los avisos enviados desde Mis Órdenes. El enlace privado de seguimiento muestra la misma información.
- Orders registra el correo de enlace de seguimiento solo después del envío exitoso; los fallos se conservan y reintentan automáticamente cada minuto, sin bloquear la creación ni actualización de la orden.
- En bases Orders existentes, aplica una vez `database/08-order-notifications.sql` desde la carpeta `Reecicla`.

---

## 🔒 Control de Acceso Basado en Roles (RBAC)

| Rol | Descripción | Permisos Principales |
| :--- | :--- | :--- |
| **`CLIENT`** | Cliente general registrado | Solicitar cotizaciones (`POST /quotes`), ver historial (`GET /quotes/user`) |
| **`ADMIN`** | Administrador del Tenant | Definir reglas de valoración (`POST /rules`), ver métricas del negocio |
| **`INSPECTOR`** | Técnico de Taller | Registrar resultados de inspección física (Sprint 3) |

---

## 🌐 Endpoints de la API (Vía Gateway `http://localhost:3000`)

El tenant se resuelve por **slug** en la URL. El gateway inyecta `X-Tenant-ID` y descarta cualquier header de tenant enviado por el cliente. Los microservicios no aceptan `tenant_id` en el body de cotización ni de login.

Prefijo de negocio: `/recicla/{slug}/…`

### Autenticación
- `GET /api/auth/tenants/slug/:slug` ➔ Metadatos públicos del negocio (nombre, tenant interno).
- `POST /api/auth/client-tenants` ➔ Para login móvil, devuelve nombre y slug de negocios activos donde el correo tiene una cuenta `CLIENT`. Límite: 10 req/min por IP.
- `POST /recicla/{slug}/auth/register` ➔ Registrar cliente en ese negocio (sin UUID).
- `POST /recicla/{slug}/auth/login` ➔ Login en ese negocio (sin UUID).
- `GET /api/auth/me` ➔ Perfil autenticado (`Bearer <token>`).

### Cotizaciones
- `POST /recicla/{slug}/quotation/quotes` ➔ Cotización pública (anónima o con token). Rate limit: 10 req/min por IP.
- `GET /recicla/{slug}/quotation/quotes/:id` ➔ Detalle (el id debe pertenecer a ese slug).
- `GET /recicla/{slug}/quotation/quotes/user` ➔ Historial (`Bearer <token>`).
- `POST /recicla/{slug}/quotation/rules` ➔ Reglas de valoración (admin del tenant).

### Catálogo y órdenes
- `/recicla/{slug}/catalog/…` y `/recicla/{slug}/orders/…` usan el mismo header de tenant.

### Pagos
- `POST /recicla/{slug}/api/payments/orders/:orderId` ➔ Registrar pago como `TENANT_ADMIN` con `method` (`BANK_TRANSFER` o `CHECK`), `reference`, archivo `receipt` y header `Idempotency-Key`.
- `GET /recicla/{slug}/api/payments/orders/:orderId` ➔ Consultar pagos de una orden propia como cliente o como administrador del negocio.
- `GET /recicla/{slug}/api/payments/orders/:orderId/:paymentId/receipt` ➔ Descargar el comprobante PDF de Reecicla con autorización de orden.
- `GET /recicla/{slug}/api/payments/orders/:orderId/:paymentId/external-receipt` ➔ Descargar la evidencia bancaria opcional con autorización de orden.

---

## 🚀 Comandos de Docker

Los servicios internos solo son accesibles dentro de la red de Docker. El único puerto HTTP publicado es el Gateway (`3000`); las bases de datos y RabbitMQ están enlazados a `127.0.0.1` para uso local.

En el Compose de desarrollo, los códigos de verificación se capturan localmente en Mailpit: abre `http://localhost:8025`. El cliente proporciona sus datos y verifica el correo para aceptar; no se crea una cuenta ni se requiere contraseña. Puede registrarse más adelante de manera opcional.

Para enviar correos reales mediante Gmail, activa la verificación en dos pasos en la cuenta de Google y crea una contraseña de aplicación desde la seguridad de la cuenta. Usa esa contraseña —no la contraseña normal de Gmail— en el `.env` raíz:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=tu-correo@gmail.com
SMTP_PASSWORD=tu-contraseña-de-aplicación
SMTP_FROM=tu-correo@gmail.com
```

Usa la dirección completa en `SMTP_USER` y `SMTP_FROM`; pega la contraseña de aplicación sin espacios. No la compartas ni la subas al repositorio. Reinicia Auth para tomar la configuración con `docker compose up -d --force-recreate auth-service`. Con Gmail los mensajes llegarán a las bandejas reales y dejarán de aparecer en Mailpit. Para volver al modo local, configura `SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `SMTP_SECURE=false` y deja `SMTP_USER` y `SMTP_PASSWORD` vacíos. Algunas cuentas administradas por una organización o con políticas de seguridad avanzadas pueden no permitir contraseñas de aplicación.

Después de crear la orden, el cliente recibe un enlace privado de seguimiento. El token se almacena como hash y el enlace vence en 90 días. Configura `FRONTEND_URL` y `TRACKING_LINK_ALLOWED_ORIGINS` en despliegues no locales.

En bases ya inicializadas, aplica las migraciones nuevas. En bases nuevas Compose las carga automáticamente:

```bash
docker compose exec -T auth-db psql -U reecicla_user -d reecicla_auth_db \
  -v ON_ERROR_STOP=1 \
  -f /docker-entrypoint-initdb.d/06-tenant-slugs.sql
docker compose exec -T auth-db psql -U reecicla_user -d reecicla_auth_db \
  -v ON_ERROR_STOP=1 \
  -f /docker-entrypoint-initdb.d/07-platform-admins.sql
docker compose exec -T auth-db psql -U reecicla_user -d reecicla_auth_db \
  -v ON_ERROR_STOP=1 \
  -f /docker-entrypoint-initdb.d/05-guest-verification-address.sql
docker compose exec -T orders-db psql -U reecicla_user -d reecicla_orders_db \
  -v ON_ERROR_STOP=1 \
  -f /docker-entrypoint-initdb.d/05-orders-anonymous-acceptance.sql
docker compose exec -T orders-db psql -U reecicla_user -d reecicla_orders_db \
  -v ON_ERROR_STOP=1 \
  -f /docker-entrypoint-initdb.d/06-orders-tracking-links.sql
docker compose exec -T orders-db psql -U reecicla_user -d reecicla_orders_db \
  -v ON_ERROR_STOP=1 \
  < reecicla-backend/database/08-order-notifications.sql
docker compose exec -T quotation-db psql -U reecicla_user -d reecicla_quotation_db \
  -v ON_ERROR_STOP=1 \
  < reecicla-backend/services/quotation/db/10-anonymous-quotes.sql
```

Para actualizar o poner al día una base de Payment ya creada (incluido el soporte de pagos fallidos sin comprobante interno), vuelve a ejecutar desde la carpeta `Reecicla`:

```bash
docker compose exec -T payment-db psql -U reecicla_user -d reecicla_payment_db \
  -v ON_ERROR_STOP=1 \
  < reecicla-backend/services/payment/db/02-payment-generated-receipts.sql
```

La migración conserva los comprobantes cargados anteriormente como evidencia bancaria opcional; los comprobantes internos de los pagos existentes se generan al descargarlos por primera vez.

Los comandos se ejecutan desde la carpeta `Reecicla`, donde está `docker-compose.yml`. Las bases existentes requieren ejecutar cada migración una vez; los scripts de inicialización de Compose solo se ejecutan al crear una base vacía. Antes del primer inicio, copia `.env.example` a `.env` y define ambos valores como secretos aleatorios, distintos entre sí. No compartas el archivo `.env`.

```bash
cp .env.example .env
```

El archivo de ejemplo deja los valores vacíos intencionalmente; Docker Compose no arrancará hasta que `JWT_SECRET` e `INTERNAL_SERVICE_TOKEN` estén configurados.

### Iniciar todos los contenedores:
```bash
docker compose up --build -d
```

### Reconstruir imágenes tras cambios de código o dependencias:
```bash
docker compose up --build -d
```

### Ver el estado de los contenedores:
```bash
docker compose ps
```

### Inspeccionar logs en tiempo real:
```bash
docker compose logs -f
```

### Detener los servicios:
```bash
docker compose down
```

---

## 🐘 Conexión desde pgAdmin 4

Para administrar las bases de datos desde pgAdmin 4 o DBeaver:

- **Auth DB**: `localhost:5431` | BD: `reecicla_auth_db` | User: `reecicla_user` | Pass: `reecicla_password`
- **Quotation DB**: `localhost:5435` | BD: `reecicla_quotation_db` | User: `reecicla_user` | Pass: `reecicla_password`
- **Payment DB**: `localhost:5437` | BD: `reecicla_payment_db` | User: `reecicla_user` | Pass: `reecicla_password`