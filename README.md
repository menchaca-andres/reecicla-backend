# Reecicla Backend (Microservicios)

Ecosistema de microservicios independientes construidos con **Node.js**, **TypeScript** y **Express**, orquestados con **Docker**.

---

## 🚀 Comandos Rápidos de Docker

Todos los comandos se ejecutan desde la raíz del proyecto.

### 1. Iniciar el proyecto

* **En segundo plano (Recomendado para trabajar sin bloquear la terminal):**
  ```bash
  docker compose up -d
  ```

* **Si se realizaron cambios en las dependencias (`package.json`) o en los `Dockerfile`:**
  ```bash
  docker compose up --build -d
  ```

* **Usando los scripts del package.json:**
  ```bash
  npm run docker:up
  ```

---

### 2. Ver el estado y los logs

* **Verificar si los contenedores están en ejecución:**
  ```bash
  docker compose ps
  ```

* **Ver los logs de todos los servicios en tiempo real:**
  ```bash
  docker compose logs -f
  ```

* **Ver los logs de un solo servicio (ejemplo: `auth-service`):**
  ```bash
  docker compose logs -f auth-service
  ```

---

### 3. Detener el proyecto

* **Detener los contenedores:**
  ```bash
  docker compose down
  ```
  *(O `npm run docker:down`)*

---

## 🌐 Endpoints para Probar en el Navegador

Una vez iniciado el proyecto, se pueden probar las siguientes rutas en el navegador:

| Servicio | Vía Gateway (Recomendado) | Acceso Directo |
| :--- | :--- | :--- |
| **API Gateway** | [http://localhost:3000/health](http://localhost:3000/health) | - |
| **Auth Service** | [http://localhost:3000/api/auth/health](http://localhost:3000/api/auth/health) | [http://localhost:3001/health](http://localhost:3001/health) |
| **Quotation Service** | [http://localhost:3000/api/quotations/health](http://localhost:3000/api/quotations/health) | [http://localhost:3002/health](http://localhost:3002/health) |