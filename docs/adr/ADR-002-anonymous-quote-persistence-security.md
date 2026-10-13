# ADR-002: Persistencia, Ciclo de Vida y Seguridad de Cotizaciones

| Campo | Detalle |
|---|---|
| **Estado** | Aceptado; revisado el 2026-10-13 |
| **Fecha original** | 2026-10-09 |
| **Autores** | Equipo Reecicla |
| **Contexto** | Sprint 3 — Persistencia, ciclo de vida y seguridad de cotizaciones |

---

## Contexto

La cotización es una oferta comercial: el sistema debe conservar lo declarado por el cliente y el precio calculado, aunque después cambien el catálogo o las reglas. La cotización también debe poder recuperarse desde el mismo navegador y, una vez creada la orden, ofrecer seguimiento por correo. Al mismo tiempo, el flujo público debe aislar los tenants, limitar abuso y preservar las cotizaciones abandonadas solo durante un periodo acotado.

ADR-001 define cómo se resuelve el tenant y cómo un cliente puede aceptar como invitado o autenticado. Este ADR define qué datos se conservan, cómo evoluciona la cotización y qué protección ofrece cada identificador.

---

## Decisión

### 1. Snapshot de cada oferta

Quotation calcula y persiste el precio en servidor. Cada fila guarda el tenant, equipo declarado, marca/modelo/año/condición, regla aplicada cuando corresponda, moneda y desglose (`base_price`, `adjustment`, `final_price`). Los cambios posteriores al catálogo o a las reglas no recalculan una oferta existente.

La oferta se trata como inmutable respecto a su declaración y valores económicos. El estado de ciclo de vida sí cambia y una aceptación autenticada puede asociar `user_id`. La base actual no impone la inmutabilidad económica con triggers ni permisos específicos; se mantiene por las operaciones del servicio.

Las cotizaciones ajustadas se representan como una cotización nueva, enlazada a la original y con justificación/auditoría, en vez de sobrescribir el snapshot anterior. El flujo de aceptación/rechazo de cotizaciones ajustadas tiene alcance propio y debe implementarse antes de habilitarse de extremo a extremo.

### 2. Estados y vencimiento

Las cotizaciones iniciales siguen los estados persistidos:

```text
Solicitud pública                    Solicitud autenticada
       │                                      │
       ▼                                      ▼
  ANONYMOUS                               PENDING
       │                                      │
       ├── aceptar como invitado ─────────────┤
       │   (requiere OTP válido)               │
       └── aceptar autenticado ────────────────┘
                         │
                         ▼
                      ACCEPTED

  ANONYMOUS o PENDING ──► REJECTED
  ANONYMOUS o PENDING ──► EXPIRED
```

- Cotizaciones sin `user_id` se crean `ANONYMOUS`; las asociadas a un usuario, `PENDING`.
- La aceptación requiere que el tenant coincida y que la cotización esté abierta y dentro de su vigencia.
- Invitados deben verificar el correo por un OTP asociado al tenant, a la cotización y al email. Solo tras validar el código se acepta la oferta; no se crea usuario ni JWT.
- Usuarios autenticados no necesitan OTP de aceptación. El identificador del usuario y el email proceden del JWT validado; nombre, teléfono y dirección de retiro pueden actualizarse desde el formulario de aceptación.
- Las cotizaciones nacen con vigencia de 30 días, fijada actualmente en código. Un proceso periódico las marca `EXPIRED` después del vencimiento; la lectura de una cotización vencida responde `410`.
- Quotation registra el cambio a `ACCEPTED` y un evento `QuoteAccepted` en la tabla outbox dentro de una transacción. El consumidor de Orders crea la orden de manera idempotente.

Los OTP de invitado y de registro de cuenta son independientes. El OTP de registro crea una cuenta tenant-scoped y devuelve JWT después de verificar el email, pero no acepta por sí solo una cotización.

### 3. Acceso y recuperación de cotizaciones

- El servidor es la fuente de verdad del precio. El frontend puede conservar el `quote_id` para regresar rápidamente a la oferta, pero no es fuente de autoridad económica.
- El identificador de cotización es un UUID aleatorio. `GET /recicla/{slug}/api/quotation/quotes/:id` valida que la cotización pertenezca al tenant de la URL, pero no exige autenticación ni prueba de propiedad individual.
- Por tanto, conocer el UUID dentro del tenant permite consultar la cotización; no es un token de autorización independiente. No almacenar ni divulgar IDs de cotización como secretos, y no asumir que UUID equivale a autorización por usuario.
- Las solicitudes autenticadas se verifican contra el tenant del JWT en Gateway. Esta comprobación de tenant no equivale a una comprobación de propiedad de cada cotización.
- El frontend guarda la referencia de cotización en almacenamiento local por tenant para recuperación en el mismo navegador. No se implementa un enlace para recuperar una cotización aún no aceptada desde otro dispositivo.

### 4. Seguimiento de órdenes

Después de que Orders consume `QuoteAccepted`, genera un token HMAC vinculado al tenant y a la orden. Orders conserva el hash del token; el enlace se envía al correo y es de solo lectura. El token vence a los 90 días. Este enlace autoriza únicamente la consulta de seguimiento y no da acceso a la cotización ni a operaciones de escritura.

### 5. Retención y purga

Un temporizador de Quotation revisa la expiración cada minuto. También elimina cotizaciones **sin usuario** en estado `EXPIRED` o `REJECTED` cuyo `updated_at` tenga más de 90 días. El plazo de retención está fijado actualmente en código y no es configurable.

Las cotizaciones aceptadas no se eliminan por esta purga; son parte del expediente de la orden. La implementación no realiza una anonimización previa ni conserva únicamente métricas agregadas.

---

## Alternativas descartadas

### Calcular el precio solo al aceptar

**Descartado:** perdería la evidencia de qué precio y reglas se mostraron y no permitiría medir el embudo de cotización.

### Usar `localStorage` como almacenamiento primario

**Descartado:** el cliente podría modificar el precio y el dato no sería compartido entre dispositivos ni auditable desde el servidor. El almacenamiento local solo es una referencia de navegación.

### Tratar el UUID como autorización suficiente

**Descartado:** aunque la consulta actual permita encontrar una cotización por ID dentro del tenant, el UUID no es un mecanismo de autenticación/propiedad. Se documenta este comportamiento como limitación vigente, no como garantía de seguridad.

### Sobrescribir una oferta al ajustar su precio

**Descartado:** se debe preservar la oferta original para auditoría y comparación; un ajuste se representa mediante una nueva cotización enlazada y un registro de auditoría.

---

## Consecuencias e implementación

- La cotización mantiene el snapshot de precio y datos del equipo; los estados y la asociación de usuario pueden cambiar según el ciclo de vida.
- `user_id` es nullable para permitir la ruta invitada y se usa como vínculo de cuenta en cotizaciones autenticadas.
- El `tenant_id` se compara al leer, aceptar o rechazar una cotización y proviene de la resolución descrita en [ADR-001](ADR-001-tenant-resolution-anonymous-quotation.md).
- El evento de aceptación usa outbox para no perder el mensaje entre la transacción de Quotation y la creación eventual de la orden.
- La creación de orden es idempotente por tenant y cotización; el seguimiento de orden utiliza un token distinto al UUID de cotización.
- Se crean índices para consultas de cotizaciones abiertas y expiración.

### Límites y trabajo futuro

1. Reforzar la integridad del snapshot económico mediante permisos de DB, lógica inmutable o auditoría que detecte modificaciones fuera del flujo autorizado.
2. Definir autorización de lectura por propietario o un enlace de recuperación de cotización con token dedicado y expiración; el UUID actual no prueba identidad.
3. Hacer configurables y revisar formalmente los plazos de 30 días (vigencia), 90 días (purga y seguimiento).
4. Evaluar límites distribuidos para Gateway si se despliegan varias réplicas.
5. Definir política legal y operativa de anonimización/retención acorde a los datos personales capturados.

---

## Referencias

- [ADR-001: Resolución de tenant, cotización pública y autenticación del cliente](ADR-001-tenant-resolution-anonymous-quotation.md)
- [Especificación funcional Reecicla](../Reecicla%20definitivo.pdf)
- Implementación: `services/quotation`, `services/auth`, `services/orders` y `services/gateway`
