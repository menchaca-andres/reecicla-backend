import express, { Request, RequestHandler } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import proxy from 'express-http-proxy';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
const QUOTATION_SERVICE_URL = process.env.QUOTATION_SERVICE_URL || 'http://quotation-service:3002';
const CATALOG_SERVICE_URL = process.env.CATALOG_SERVICE_URL || 'http://catalog-service:3003';
const ORDERS_SERVICE_URL = process.env.ORDERS_SERVICE_URL || 'http://orders-service:3004';
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN;
const DEMO_TENANT_ID = '00000000-0000-0000-0000-000000000001';

type TenantRequest = Request & { resolvedTenantId?: string };

const resolveTenant: RequestHandler = async (req, res, next) => {
  const slug = req.params.slug;
  if (!slug || !INTERNAL_SERVICE_TOKEN) {
    res.status(503).json({ error: 'La resolución de negocios no está configurada.' });
    return;
  }
  try {
    const response = await fetch(`${AUTH_SERVICE_URL}/api/auth/internal/tenants/slug/${encodeURIComponent(slug)}`, {
      headers: { 'x-internal-service-token': INTERNAL_SERVICE_TOKEN },
    });
    if (response.status === 404) {
      res.status(404).json({ error: 'Negocio no encontrado.' });
      return;
    }
    if (!response.ok) {
      res.status(502).json({ error: 'No fue posible resolver el negocio.' });
      return;
    }
    const result = await response.json() as { tenant_id?: string };
    if (!result.tenant_id) {
      res.status(502).json({ error: 'La respuesta de resolución del negocio no es válida.' });
      return;
    }
    (req as TenantRequest).resolvedTenantId = result.tenant_id;
    next();
  } catch (error) {
    console.error('[Gateway] Error resolving tenant:', error);
    res.status(502).json({ error: 'No fue posible contactar el servicio de autenticación.' });
  }
};

const scopedProxy = (serviceUrl: string, tenantId: (req: Request) => string) => proxy(serviceUrl, {
  parseReqBody: false,
  proxyReqPathResolver: (req) => req.originalUrl.replace(/^\/recicla\/[^/]+/, ''),
  proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
    const headers = { ...proxyReqOpts.headers };
    delete headers['x-tenant-id'];
    return {
      ...proxyReqOpts,
      headers: { ...headers, 'x-tenant-id': tenantId(srcReq) },
    };
  },
});

const tenantProxy = (serviceUrl: string) =>
  scopedProxy(serviceUrl, (req) => (req as TenantRequest).resolvedTenantId!);
const demoProxy = (serviceUrl: string) => scopedProxy(serviceUrl, () => DEMO_TENANT_ID);

app.use(cors());

app.get('/health', (_req, res) => {
  res.json({ service: 'gateway', status: 'OK' });
});

app.use(
  '/api/auth',
  demoProxy(AUTH_SERVICE_URL)
);

app.use(
  '/api/quotation',
  demoProxy(QUOTATION_SERVICE_URL)
);

app.use(
  '/api/catalog',
  demoProxy(CATALOG_SERVICE_URL)
);

app.use(
  '/api/orders',
  demoProxy(ORDERS_SERVICE_URL)
);

app.use('/recicla/:slug/api/auth', resolveTenant, tenantProxy(AUTH_SERVICE_URL));
app.use('/recicla/:slug/api/quotation', resolveTenant, tenantProxy(QUOTATION_SERVICE_URL));
app.use('/recicla/:slug/api/catalog', resolveTenant, tenantProxy(CATALOG_SERVICE_URL));
app.use('/recicla/:slug/api/orders', resolveTenant, tenantProxy(ORDERS_SERVICE_URL));

app.use(express.json());

app.listen(PORT, () => {
  console.log(`[API Gateway] Running on port ${PORT}`);
  console.log(`[API Gateway] Auth proxy -> ${AUTH_SERVICE_URL}`);
  console.log(`[API Gateway] Quotation proxy -> ${QUOTATION_SERVICE_URL}`);
  console.log(`[API Gateway] Catalog proxy -> ${CATALOG_SERVICE_URL}`);
  console.log(`[API Gateway] Orders proxy -> ${ORDERS_SERVICE_URL}`);
});
