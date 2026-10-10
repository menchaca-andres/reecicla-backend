# ADR-001: Resolución Automática de Tenant y Cotización Anónima

| Campo         | Detalle                                      |
|---------------|----------------------------------------------|
| **Estado**    | Aceptado                                     |
| **Fecha**     | 2026-10-09                                   |
| **Autores**   | Equipo Reecicla                              |
| **Contexto**  | Sprint 3 — Rediseño de Auth y Quotation Flow |

---

## Contexto

El diseño original del sistema exigía que el cliente enviara manualmente su `tenant_id` (un UUID) en el body de cada request HTTP, incluyendo el registro y el inicio de sesión. Esto generaba dos problemas críticos:

1. **UX inaceptable**: Ningún usuario final conoce ni debería conocer un UUID interno del sistema.
2. **Fricción de conversión**: Requerir registro previo para obtener una cotización elimina el principal incentivo de uso del sistema. El cliente abandona antes de ver el valor del producto.

Adicionalmente, se identificó que el modelo multi-tenant de Reecicla implica que distintos negocios (ej: una empresa de línea blanca, una de electrónicos) operan como tenants independientes, cada uno con su propio catálogo y reglas de precio. Los clientes finales llegan a través de la URL pública de **ese** negocio específico, no de una URL genérica de Reecicla.

---

## Decisión

Se adoptaron **dos cambios arquitectónicos relacionados**:

### 1. Resolución de Tenant por Slug en la URL

El `tenant_id` (UUID interno) deja de ser responsabilidad del cliente. En su lugar, cada tenant tiene un identificador público corto (`slug`) que forma parte de la URL de acceso:

```
reecicla.com/recicla/{slug}
```

El **API Gateway** intercepta cada request, extrae el `slug` del path o del subdominio, lo resuelve a un `tenant_id` interno (consultando la tabla `tenants`), y lo inyecta como header interno (`X-Tenant-ID`) hacia los microservicios. Ningún microservicio downstream recibe ni valida el `slug`; todos trabajan con el UUID interno.

### 2. Cotización Anónima (Guest Quotation)

Los clientes finales **no se registran ni inician sesión** para obtener una cotización. El endpoint `POST /api/quotation/quotes` pasa a ser **público**. El flujo es:

1. El cliente accede a la URL del negocio y completa el formulario de cotización (tipo de equipo, marca, modelo, condición).
2. El sistema calcula y devuelve el precio estimado **sin requerir autenticación**.
3. Si el cliente **acepta** la cotización, recién entonces se le presenta un formulario para ingresar sus datos personales (nombre, teléfono, correo) para coordinar el retiro.
4. El sistema envía un código de verificación de un solo uso al correo proporcionado. El código vence a los 10 minutos, permite hasta cinco intentos y su reenvío tiene un límite temporal.
5. Al confirmar el código, la cotización se acepta y sus datos de contacto verificados se usan para generar la orden, sin crear un `user` ni emitir un JWT.
6. La aceptación no depende de si ese correo ya tiene una cuenta. El cliente puede crear una cuenta después, de manera opcional; el pedido invitado permanece asociado al tenant y no se vincula automáticamente a una cuenta.

Los usuarios internos (`INSPECTOR`, `CATALOG_ADMIN`, `TENANT_ADMIN`, `SUPER_ADMIN`) mantienen el flujo de login con JWT sin cambios.

---

## Alternativas Descartadas

### Alternativa A: Selector de Tenant en el Login
Mostrar un dropdown o campo de texto para que el usuario elija o escriba el nombre de su empresa.

**Descartada porque**: El cliente final no sabe a qué "tenant" pertenece el negocio físico al que fue. Es una abstracción técnica que no debe ser visible.

### Alternativa B: Email único a nivel de plataforma
Resolver el `tenant_id` durante el login buscando el email en toda la DB, asumiendo que un email solo puede pertenecer a un tenant.

**Descartada porque**: No escala en un SaaS real. Una misma persona puede ser cliente de dos negocios distintos que usen Reecicla. Además no resuelve la fricción de registro previo a la cotización.

### Alternativa C: Mantener el `tenant_id` en el body del request
El diseño original.

**Descartada porque**: Es técnicamente incorrecto exponer identificadores internos al cliente. Es un anti-patrón de seguridad (Object-Level Authorization) y genera una UX inaceptable.

---

## Consecuencias

### Impacto en el Modelo de Datos

| Tabla     | Cambio requerido                                                                   |
|-----------|------------------------------------------------------------------------------------|
| `tenants` | Agregar columna `slug VARCHAR(60) UNIQUE NOT NULL`                                 |
| `users`   | No se crea ni requiere un usuario para cotizar o aceptar como invitado |
| `quotes`  | Agregar estado `ANONYMOUS` previo a `PENDING` para cotizaciones sin usuario        |

### Impacto en el API Gateway

- Nuevo middleware de resolución de tenant: `slug → tenant_id`.
- Cache recomendado (en memoria o Redis) para evitar una consulta a DB en cada request.
- Si el slug no existe, responder `404` antes de rutear.

### Impacto en Auth Service

- El endpoint `POST /api/auth/register` deja de ser el punto de entrada del cliente final.
- Se agregan endpoints internos para emitir y confirmar códigos de verificación por correo antes de aceptar una cotización invitada.
- El envío se configura mediante SMTP; los códigos se guardan como hashes y nunca se devuelven al cliente.

### Impacto en Quotation Service

- `POST /api/quotation/quotes` pasa a ser público (sin middleware `authenticateToken`).
- El `tenant_id` ya no viene del JWT ni del body: llega como header interno `X-Tenant-ID` inyectado por el Gateway.
- El campo `user_id` pasa a ser `nullable` en la tabla `quotes` para soportar cotizaciones anónimas.
- La orden admite `user_id` nulo y conserva los datos de contacto del cliente invitado junto con el `tenant_id`.

### Riesgos y Mitigaciones

| Riesgo                                      | Mitigación                                                           |
|---------------------------------------------|----------------------------------------------------------------------|
| Abuso del endpoint público de cotización    | Rate limiting por IP en el Gateway (ej: 10 req/min por IP)          |
| Cotizaciones huérfanas sin usuario asociado | Job periódico que marca como `EXPIRED` cotizaciones anónimas viejas  |
| Slug duplicado entre tenants                | Constraint `UNIQUE` en DB + validación en el endpoint de creación    |
| Abuso del envío de códigos                  | Límite de reenvío por correo y tenant, vencimiento y máximo de intentos |

---

## Referencias

- [Kata_PolloChingon.pdf](../Kata_PolloChingon.pdf) — Diseño original del sistema
- [Reecicla definitivo.pdf](../Reecicla%20definitivo.pdf) — Especificación funcional completa
- Discusión del equipo: 2026-10-09

### Actualización — 2026-10-10

El flujo de aceptación invitada se ajustó para no exigir ni crear cuentas. El correo se verifica por OTP y la cotización/orden se conserva en el tenant que inició el flujo. La creación de una cuenta queda como acción posterior opcional y no vincula automáticamente órdenes anteriores.
