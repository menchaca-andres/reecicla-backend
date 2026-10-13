# Registro de clientes por negocio

Los clientes se registran desde la URL existente de cada negocio, por ejemplo `/recicla/demo`. El API Gateway resuelve el tenant usando el slug de la ruta, elimina cualquier `x-tenant-id` enviado por el navegador y pasa el tenant resuelto a Auth. Los endpoints de registro ignoran `tenant_id` del cuerpo. Cada correo puede tener una cuenta independiente por tenant.

El alta del cliente requiere dos pasos:

1. `POST /recicla/{slug}/api/auth/register` valida los datos, almacena temporalmente el hash de contraseña y el hash del código OTP, y envía el código al correo.
2. `POST /recicla/{slug}/api/auth/register/verify` consume un código válido de seis dígitos. Solo entonces crea al cliente y devuelve un JWT que incluye el tenant.

Al aceptar una cotización, el cliente puede iniciar sesión y usar sus datos guardados, crear una cuenta verificando el correo con OTP y luego confirmar la aceptación, o continuar como invitado con la verificación OTP de la aceptación. No se consulta ni revela previamente si un correo ya tiene una cuenta; el tenant se determina por el slug de la URL.

El OTP vence en 10 minutos, admite hasta cinco intentos y hay un cooldown de 60 segundos para solicitar otro. El Gateway agrega límites por IP y tenant a las solicitudes y verificaciones. Los slugs reservados (por ejemplo, `api`, `admin` y `www`) no se pueden asignar a nuevos negocios ni resolver como rutas de tenant.

Los límites del Gateway son locales al proceso, adecuados para la ejecución actual de un solo Gateway. Si se despliega más de una instancia, deben moverse a un almacén compartido para que el límite sea global.

## Aplicación en una base existente

La migración se ejecuta automáticamente solo al inicializar una base Auth vacía. Para una base ya existente, desde la raíz del proyecto:

```sh
docker exec -i reecicla-auth-db psql -v ON_ERROR_STOP=1 --single-transaction \
  -U reecicla_user -d reecicla_auth_db \
  < reecicla-backend/services/auth/db/08-client-email-registration.sql
```

Para recordar los datos de contacto y la dirección de recolección por negocio, aplica también:

```sh
docker exec -i reecicla-auth-db psql -v ON_ERROR_STOP=1 --single-transaction \
  -U reecicla_user -d reecicla_auth_db \
  < reecicla-backend/services/auth/db/09-user-pickup-address.sql
```

Después reconstruye Auth y el frontend:

```sh
docker compose up -d --build auth-service frontend
```

Recompila el Gateway para incorporar `jsonwebtoken` y sus dependencias, y reinicia los servicios:

```sh
docker compose up -d --build auth-service gateway frontend
```

El Gateway debe compartir el mismo `JWT_SECRET` que Auth y los otros servicios. En desarrollo, el OTP enviado por Mailpit se puede consultar en `http://localhost:8025`.

## Alcance

La identidad de negocio sigue siendo el slug en la ruta, compatible con `/recicla/{slug}`. Esta entrega no agrega subdominios, dominios personalizados, certificados TLS ni límites de número de clientes por plan.
