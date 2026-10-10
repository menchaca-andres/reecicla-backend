# ADR-002: Inmutabilidad, Persistencia y Seguridad de Cotizaciones Anónimas

| Campo         | Detalle                                                            |
|---------------|--------------------------------------------------------------------|
| **Estado**    | Aceptado                                                           |
| **Fecha**     | 2026-10-09                                                         |
| **Autores**   | Equipo Reecicla                                                    |
| **Contexto**  | Sprint 3 — Persistencia, Ciclo de Vida y Seguridad de Cotizaciones |

---

## Contexto

Con la adopción de la cotización anónima ([ADR-001](ADR-001-tenant-resolution-anonymous-quotation.md)), los clientes generan cotizaciones sin autenticación previa. Esto plantea desafíos de diseño de software y seguridad:

1. **Compromiso de precio y defensa legal**: La cotización es una promesa comercial. Si las reglas de precio cambian posteriormente o si tras la inspección física hay un reajuste, el sistema debe conservar exactamente lo que el cliente declaró y el precio que se le ofreció.
2. **UX de retorno**: Un cliente suele cotizar, cerrar el navegador para pensarlo y retornar más tarde. Si la cotización desaparece, la fricción aumenta y el cliente abandona.
3. **Seguridad y Anti-abuso**: Exponer identificadores de cotización no debe permitir que terceros adivinen o manipulen cotizaciones ajenas.
4. **Métricas de negocio**: Se necesita medir el embudo de conversión (cotizadas vs. aceptadas) y controlar cuotas de uso (plan freemium del tenant) aun para usuarios no registrados.

---

## Decisión

Se establecen las siguientes directrices arquitectónicas para el manejo de cotizaciones anónimas:

### 1. Inmutabilidad de la Cotización

Cada cotización generada en la base de datos es **inmutable**:
- Guarda un snapshot exacto de la declaración (`device_type`, `brand`, `model`, `year`, `condition`).
- Guarda el desglose económico exacto (`base_price`, `adjustment`, `final_price`, `currency`).
- Vincula la versión específica de la regla de precio aplicada (`pricing_rule_id`).
- Ningún cambio posterior en el catálogo o en las reglas de precio modifica cotizaciones ya emitidas.

### 2. Ciclo de Vida y Máquina de Estados

La cotización sigue un flujo estricto de estados:

```
[Inicio] ──> ANONYMOUS ──┬──> ACCEPTED (Cliente ingresa datos / crea orden)
                         ├──> EXPIRED  (Supera valid_until)
                         └──> REJECTED (Cliente descarta la oferta)
```

- **Vigencia (`valid_until`)**: Cada cotización nace con un plazo de validez de 30 días. Superado este plazo, el servidor la marca como `EXPIRED` y rechaza su aceptación. Actualmente el plazo está fijado en código y no es configurable.
- **Aceptación Guest**: Al momento de aceptar la cotización, se capturan y verifican los datos del cliente (`customer_name`, `customer_email`, `phone`, `address`). La cotización pasa a `ACCEPTED` y se emite el evento para la orden de recolección. No se crea un usuario ni se emite un JWT; crear una cuenta después es opcional.

### 3. Persistencia en Cliente y Tokens de Acceso

- **El servidor siempre es la fuente de verdad**: El cliente nunca calcula ni almacena precios en frontend como ground truth.
- **Identificadores y Tokens Opacos**: La cotización anónima se identifica mediante un UUID de alta entropía (`quote_id`). Actualmente ese UUID también permite leer la cotización durante su vigencia; no sustituye un mecanismo de autorización independiente.
- **Almacenamiento en Web**: Se almacena el `quote_id` o token anónimo de sesión en la aplicación web para permitir la recuperación rápida de la cotización activa desde la misma máquina/navegador.
- **Seguridad en API**: La consulta individual `GET /api/quotation/quotes/:id` requiere conocer la clave única de la cotización y estar dentro de su periodo de vigencia.

### 4. Recuperación Multi-dispositivo (Magic Links)

Para permitir que el cliente consulte o acepte su cotización desde otro dispositivo (ej: cotizó en PC y quiere aceptar en móvil) sin obligarlo a crear una cuenta previa:
- El sistema permite enviar la cotización por correo electrónico o SMS con un **enlace directo (Magic Link)** estructurado como:
  `https://app.reecicla.com/recicla/{slug}/quote/{quote_id}`

**Estado de implementación:** pendiente. El código actual verifica por SMTP el correo al aceptar la cotización, pero no implementa el envío de Magic Links para recuperar o aceptar una cotización desde otro dispositivo.

### 5. Política de Retención y Purga de Datos (TTL)

- **Cotizaciones Anónimas no Aceptadas**: Un proceso programado (cron/worker) purga o anonimiza cotizaciones en estado `ANONYMOUS` o `EXPIRED` tras superar el periodo de retención legal/operativo, conservando únicamente métricas agregadas desvinculadas.
- **Cotizaciones Aceptadas**: Se conservan integras al formar parte del expediente de la orden de recolección y compraventa.

---

## Alternativas Descartadas

### Alternativa A: No guardar cotizaciones anónimas en base de datos
Calcular el precio "al vuelo" en memoria y guardarlo recién cuando el cliente acepte.

**Descartada porque**: Si las reglas de precio cambian entre el momento de la cotización y la aceptación, el sistema no tiene registro para validar qué precio se le prometió originalmente al cliente. Además impide medir la tasa de abandono del embudo.

### Alternativa B: Almacenar la cotización completa en `localStorage` del frontend
Usar el almacenamiento del navegador como base de datos primaria de cotizaciones.

**Descartada porque**: Es un riesgo de seguridad (tampering de precios desde la consola de JS) y no permite acceso multi-dispositivo ni auditoría del negocio.

---

## Consecuencias

- **Garantía Comercial**: Transparencia total entre lo que declaró el cliente y lo que ofreció el negocio.
- **Rendimiento**: Consultas eficientes mediante índices parciales en Postgres (`status = 'ANONYMOUS'`, `valid_until`).
- **Escalabilidad**: Política clara de limpieza para evitar crecimiento desmedido de registros huérfanos.

**Estado de implementación:** se conserva el snapshot de precios y datos en el flujo normal; la aceptación invitada conserva `user_id` nulo y asocia la orden con el tenant y los datos de contacto verificados. La inmutabilidad no está forzada actualmente mediante triggers o permisos de base de datos. El vencimiento está fijado en 30 días y la retención de 90 días también está fijada en código; se purgan cotizaciones anónimas rechazadas/vencidas tras ese plazo.

---

## Referencias

- [ADR-001: Resolución Automática de Tenant y Cotización Anónima](ADR-001-tenant-resolution-anonymous-quotation.md)
- Especificación funcional de Cotizaciones (Reecicla v1.0)
