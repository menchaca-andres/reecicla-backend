# ADR-001: Resolución de Tenant, Cotización Pública y Autenticación del Cliente

| Campo | Detalle |
|---|---|
| **Estado** | Aceptado; revisado el 2026-10-13 |
| **Fecha original** | 2026-10-09 |
| **Autores** | Equipo Reecicla |
| **Contexto** | Sprint 3 — Multi-tenancy y flujo de cotización |

---

## Contexto

El diseño original exigía que el cliente enviara manualmente el `tenant_id` (UUID) en las solicitudes de registro, inicio de sesión y cotización. El UUID es un dato interno y pedirlo al usuario genera fricción. Además, exigir una cuenta antes de mostrar un precio desalienta el primer uso.

Reecicla opera como una plataforma multi-tenant: cada negocio tiene su propio catálogo, reglas de precio y cuentas de cliente. La persona llega desde la URL pública de un negocio concreto. Una misma dirección de correo puede tener cuentas independientes en distintos negocios.

El flujo debe permitir cotizar sin cuenta, aceptar como invitado después de verificar el correo o continuar con una cuenta existente/nueva, sin revelar si una dirección de correo está registrada.

---

## Decisión

### 1. El tenant se resuelve desde la URL

La URL pública identifica el negocio mediante un `slug`:

```text
/recicla/{slug}
```

Para las rutas `/recicla/{slug}/api/...`, el API Gateway:

1. Valida el formato del `slug` y resuelve el tenant activo mediante Auth Service, usando una llamada interna autenticada.
2. Elimina cualquier `X-Tenant-ID` enviado por el cliente e inyecta el UUID resuelto como header interno hacia el servicio destino.
3. Si la solicitud incluye un JWT, lo valida y rechaza tokens inválidos, tokens de plataforma o tokens asociados a otro tenant.
4. Rechaza slugs inválidos/no disponibles antes de reenviar la solicitud.

Los microservicios reciben el identificador interno desde el Gateway; el body del navegador no es autoridad para seleccionar el tenant. Las rutas directas heredadas aún presentes no cambian este contrato para el flujo público multi-tenant.

El alta de negocios se reserva a `SUPER_ADMIN`. El tenant y su primer `TENANT_ADMIN` se crean en Auth DB en una transacción; la inicialización del catálogo en su propia base es una operación posterior e idempotente. Las cuentas `SUPER_ADMIN` viven en `platform_admins`, no tienen tenant y usan tokens con `scope: "platform"`, no válidos en rutas de negocio.

### 2. La cotización inicial no requiere autenticación

El cliente puede solicitar una cotización inicial desde la URL del negocio sin registrarse ni iniciar sesión. Quotation persiste la cotización en el servidor y determina su tenant a partir del contexto interno inyectado por Gateway. Un usuario autenticado puede cotizar también; en ese caso la cotización se asocia a su `user_id`.

Las cotizaciones sin usuario se crean en estado `ANONYMOUS`; las asociadas a una cuenta, en `PENDING`. Ambas conservan tenant, snapshot de equipo y precio, y vencen después de 30 días. El detalle del ciclo de vida y la retención se especifica en [ADR-002](ADR-002-anonymous-quote-persistence-security.md).

### 3. Al aceptar, el cliente elige cómo continuar

La pantalla de aceptación presenta estas opciones:

#### Iniciar sesión

- En la app móvil, el cliente puede ingresar su correo antes de autenticarse para consultar los nombres y slugs de los negocios activos donde tiene una cuenta `CLIENT`; luego selecciona el negocio e inicia sesión allí. El endpoint de descubrimiento no devuelve usuarios, IDs internos ni datos de perfil y tiene límite de solicitudes por IP.
- El cliente se autentica con correo y contraseña en el contexto del tenant de la URL.
- Auth devuelve un JWT con `userId` y `tenantId`; Gateway aplica la validación de tenant en las solicitudes siguientes.
- El frontend obtiene nombre, correo, teléfono y dirección guardada para ese perfil. Nombre, teléfono y dirección se pueden revisar/editar antes de aceptar.
- La actualización de datos se realiza contra Auth Service y queda delimitada por el usuario y tenant autenticados. El correo de la cuenta no se cambia desde el formulario de aceptación.
- Quotation registra la aceptación con el `user_id` del JWT; el correo del usuario autenticado se toma del token y no del body.

#### Crear cuenta

- El cliente proporciona nombre, correo, contraseña y teléfono opcional.
- `POST /recicla/{slug}/api/auth/register` inicia un registro pendiente y envía un OTP al correo.
- `POST /recicla/{slug}/api/auth/register/verify` crea la cuenta `CLIENT` solo después de verificar el OTP y devuelve el JWT. La interfaz continúa al formulario de aceptación autenticada; el registro por sí solo no acepta la cotización.
- El OTP es de seis dígitos, vence en 10 minutos, permite hasta cinco intentos y tiene un cooldown de 60 segundos. En la base se almacena el hash del código, no el código en claro.
- La respuesta al inicio del registro no confirma si el correo ya tiene una cuenta; la aplicación no consulta ni presenta esa información como paso previo.

#### Continuar como invitado

- El cliente ingresa nombre, correo, teléfono y dirección de recolección.
- Auth envía un OTP de aceptación ligado al tenant, a la cotización y al correo. La cotización no se acepta hasta validar el código.
- La verificación devuelve los datos validados a Quotation; se crea la orden con esos datos y `user_id` nulo. No se crea una cuenta ni se emite un JWT.

Los OTP de registro y los de aceptación invitada tienen propósitos y registros separados; completar uno no sustituye al otro. Una cuenta futura no reclama ni asocia automáticamente órdenes invitadas anteriores.

### 4. Identidad del cliente y aislamiento

- La identidad de una cuenta es `(tenant_id, email normalizado)`, no el email global de la plataforma.
- El tenant de la cuenta se deriva del `slug` resuelto por Gateway, nunca de un campo libre del formulario.
- Un JWT de un negocio no se acepta en la URL de otro; los tokens de plataforma tampoco autentican acciones de cliente.
- La sesión web del cliente se almacena con una clave local asociada al `slug`, no compartida entre negocios.
- La cuenta y los datos de perfil se almacenan en Auth DB. Quotation y Orders reciben los datos necesarios por solicitudes autenticadas/eventos; no escriben directamente en Auth DB.

### 5. Antiabuso vigente

Gateway aplica límites por IP y tenant para el inicio/verificación de registro, y límites por IP a la creación/aceptación de cotizaciones. Los contadores de Gateway son locales al proceso: no constituyen un límite global si se ejecutan varias réplicas. Auth limita además el reenvío por email/tenant, el vencimiento y el número de intentos OTP.

---

## Alternativas descartadas

### Selector de tenant en el login

**Descartado:** el cliente llega desde la URL del negocio y no necesita conocer una abstracción técnica.

### Email único para toda la plataforma

**Descartado:** una persona puede ser cliente de distintos negocios con perfiles y credenciales aislados.

### Aceptar un `tenant_id` del cliente

**Descartado:** expone un identificador interno y permite intentar acceder a datos de otro tenant. Gateway es la autoridad que resuelve el contexto.

### Exigir cuenta para cotizar o aceptar

**Descartado:** añade fricción innecesaria. Se conserva la aceptación invitada con verificación OTP, junto con las opciones autenticadas.

### Consultar si el correo existe en la web antes de ofrecer opciones

**Descartado para el frontend web:** no es necesario para el login web y facilitaría enumerar cuentas, por lo que esa interfaz ofrece las opciones sin revelar el estado de una dirección. Para cumplir el flujo de selección de negocio de la app móvil, se permite un lookup limitado por IP que devuelve únicamente los negocios asociados a cuentas `CLIENT`; esto revela membresías y se acepta como tradeoff funcional de la app móvil.

---

## Consecuencias e implementación

- `tenants.slug` identifica la ruta pública; `users` es tenant-scoped y admite el mismo correo en tenants distintos.
- `quotes.user_id` es nullable. Las cotizaciones sin usuario usan `ANONYMOUS`; las vinculadas a una cuenta usan `PENDING`.
- El perfil de cliente incluye dirección predeterminada de recolección, editable para cada aceptación y persistida por tenant.
- La aceptación publica un evento de dominio mediante outbox en la misma transacción que cambia el estado de la cotización. Orders crea una orden idempotente a partir de ese evento.
- Los cambios de Auth DB están versionados como migraciones SQL. Los scripts montados en `docker-entrypoint-initdb.d` solo corren al inicializar una base vacía; una base existente requiere aplicar manualmente la nueva migración.
- Slugs reservados y validación se aplican antes de resolver la ruta.

### Límites y riesgos conocidos

- Los límites de Gateway son por proceso; un despliegue con varias réplicas requiere un almacén coordinado para límites globales.
- El descubrimiento de negocios por correo móvil permite inferir membresías; el límite por IP reduce abuso, pero no elimina el riesgo de enumeración.
- La consulta individual de cotización por UUID permite recuperar el recurso conociendo su identificador, dentro de su tenant. El UUID no reemplaza autorización por usuario; véase el límite documentado en ADR-002.
- No se incorporan subdominios de tenants, dominios personalizados, certificados automáticos ni cookies compartidas entre tenants.

---

## Referencias

- [ADR-002: Persistencia, ciclo de vida y seguridad de cotizaciones](ADR-002-anonymous-quote-persistence-security.md)
- [Especificación funcional Reecicla](../Reecicla%20definitivo.pdf)
- Implementación: `services/gateway`, `services/auth`, `services/quotation`, `services/orders` y `reecicla-frontend`
