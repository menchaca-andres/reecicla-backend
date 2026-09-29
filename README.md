# Reecicla Backend — Arquitectura de Microservicios (Kata Pollo Chingón) ⚙️

Ecosistema de microservicios independientes construidos con **Node.js**, **TypeScript**, **Express** y **PostgreSQL**, orquestados mediante **Docker Compose**. Implementa una arquitectura SaaS multitenant con aislamiento de bases de datos por microservicio.

---

## 🏗️ Mapa de Módulos y Microservicios (Sprint 1)

### 1. API Gateway (`reecicla-gateway`)
- **Puerto Host**: `3000`
- **Responsabilidad**: Punto de entrada único para clientes HTTP y frontend. Administra CORS y enrutamiento dinámico con proxy inverso.

### 2. Auth Service (`reecicla-auth-service`)
- **Puerto Host**: `3001` | **Base de Datos**: `reecicla_auth_db` (`localhost:5431`)
- **Tablas Propietarias**: `users`, `roles`, `sessions`
- **Funcionalidades (HU-001, HU-002, HU-003)**:
  - Registro de clientes con hashing seguro `bcrypt` (10 rounds). Asignación automática del rol `CLIENT` (protección contra elevación de privilegios).
  - Inicio de sesión por tenant y emisión de tokens `JWT` con firma de `role`.
  - Endpoint de contexto de perfil (`GET /api/auth/me`).

### 3. Quotation Service (`reecicla-quotation-service`)
- **Puerto Host**: `3002` | **Base de Datos**: `reecicla_quotation_db` (`localhost:5435`)
- **Tablas Propietarias**: `quotes`, `pricing_rules`
- **Funcionalidades (HU-004, HU-005)**:
  - **Motor de Reglas de Valoración (`JSONB`)**: Configuración de precio base y ajustes por condición (`working`, `damaged`, `broken`) protegida por RBAC (exclusivo rol `ADMIN`).
  - **Motor de Cotización**: Cálculo automático de precio final ofrecido en Bolivianos (**Bs.**) en estado `PENDING`.
  - **Historial**: Consulta de cotizaciones filtradas por tenant y usuario.

### 4. Bases de Datos de Infraestructura (Sprints 2 - 4)
- **Catalog DB** (`reecicla-catalog-db`): Puerto `5434`
- **Orders DB** (`reecicla-orders-db`): Puerto `5433`

---

## 🔒 Control de Acceso Basado en Roles (RBAC)

| Rol | Descripción | Permisos Principales |
| :--- | :--- | :--- |
| **`CLIENT`** | Cliente general registrado | Solicitar cotizaciones (`POST /quotes`), ver historial (`GET /quotes/user`) |
| **`ADMIN`** | Administrador del Tenant | Definir reglas de valoración (`POST /rules`), ver métricas del negocio |
| **`INSPECTOR`** | Técnico de Taller | Registrar resultados de inspección física (Sprint 3) |

---

## 🌐 Endpoints de la API (Vía Gateway `http://localhost:3000`)

### Autenticación (`/api/auth`)
- `POST /api/auth/register` ➔ Registrar nueva cuenta de cliente.
- `POST /api/auth/login` ➔ Iniciar sesión y obtener token JWT.
- `GET /api/auth/me` ➔ Obtener datos del usuario autenticado (requiere `Bearer <token>`).

### Cotizaciones (`/api/quotation`)
- `POST /api/quotation/rules` ➔ Definir o actualizar regla de valoración en Bs. (requiere token de `ADMIN`).
- `POST /api/quotation/quotes` ➔ Solicitar cotización de un equipo en Bs. (requiere `Bearer <token>`).
- `GET /api/quotation/quotes/user` ➔ Consultar historial de cotizaciones del usuario (requiere `Bearer <token>`).
- `GET /api/quotation/quotes/:id` ➔ Consultar detalle de una cotización por ID.

---

## 🚀 Comandos de Docker

Todos los comandos se ejecutan desde la raíz de `reecicla-backend`:

### Iniciar todos los contenedores:
```bash
docker compose up -d
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