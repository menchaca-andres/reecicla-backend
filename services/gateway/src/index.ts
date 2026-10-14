import express, { RequestHandler } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import proxy from 'express-http-proxy';
import { assertTenantToken, isValidTenantSlug, TenantTokenError } from './tenantSecurity';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
const QUOTATION_SERVICE_URL = process.env.QUOTATION_SERVICE_URL || 'http://quotation-service:3002';
const CATALOG_SERVICE_URL = process.env.CATALOG_SERVICE_URL || 'http://catalog-service:3003';
const ORDERS_SERVICE_URL = process.env.ORDERS_SERVICE_URL || 'http://orders-service:3004';
const INSPECTION_SERVICE_URL = process.env.INSPECTION_SERVICE_URL || 'http://inspection-service:3005';

function internalServiceToken(): string {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!token) throw new Error('INTERNAL_SERVICE_TOKEN debe estar configurado.');
  return token;
}

app.use(cors());
app.use((req, _res, next) => {
  delete req.headers['x-tenant-id'];
  next();
});

app.get('/health', (_req, res) => {
  res.json({ service: 'gateway', status: 'OK' });
});

const QUOTE_RATE_LIMIT = Number(process.env.QUOTE_RATE_LIMIT_PER_MINUTE || 10);
const EMAIL_VERIFICATION_RATE_LIMIT = Number(process.env.EMAIL_VERIFICATION_RATE_LIMIT_PER_MINUTE || 5);
const quoteHits = new Map<string, number[]>();
const registrationHits = new Map<string, number[]>();
const clientTenantLookupHits = new Map<string, number[]>();
const quoteRateLimitCleanup = setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const hits of [quoteHits, registrationHits, clientTenantLookupHits]) {
    for (const [key, timestamps] of hits) {
      if (timestamps.every((timestamp) => timestamp <= cutoff)) hits.delete(key);
    }
  }
}, 60_000);
quoteRateLimitCleanup.unref();

const clientTenantLookupRateLimit: RequestHandler = (req, res, next) => {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (clientTenantLookupHits.get(key) ?? [])
    .filter((timestamp) => now - timestamp < 60_000);
  if (recent.length >= 10) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'Demasiadas consultas. Inténtalo de nuevo en un minuto.' });
    return;
  }
  recent.push(now);
  clientTenantLookupHits.set(key, recent);
  next();
};

const quoteCreateRateLimit: RequestHandler = (req, res, next) => {
  if (req.method !== 'POST') {
    next();
    return;
  }
  const path = req.path.split('?')[0];
  const isQuoteCreation = path === '/quotes' || path === '/quotes/';
  const isQuoteAcceptance = /^\/quotes\/[^/]+\/accept\/?$/.test(path);
  if (!isQuoteCreation && !isQuoteAcceptance) {
    next();
    return;
  }

  const routeKey = isQuoteCreation ? 'create' : 'accept';
  const key = `${routeKey}:${req.socket.remoteAddress || 'unknown'}`;
  const limit = isQuoteCreation ? QUOTE_RATE_LIMIT : EMAIL_VERIFICATION_RATE_LIMIT;
  const now = Date.now();
  const recent = (quoteHits.get(key) ?? []).filter((timestamp) => now - timestamp < 60_000);
  if (recent.length >= limit) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'Demasiadas solicitudes. Probá de nuevo en un minuto.' });
    return;
  }
  recent.push(now);
  quoteHits.set(key, recent);
  next();
};

const registrationRateLimit: RequestHandler = (req, res, next) => {
  if (req.method !== 'POST') {
    next();
    return;
  }
  const route = req.path === '/register'
    ? 'request'
    : req.path === '/register/verify'
      ? 'verify'
      : null;
  if (!route) {
    next();
    return;
  }

  const ip = req.socket.remoteAddress || 'unknown';
  const slug = req.params.slug;
  const now = Date.now();
  const buckets = [
    { key: `${route}:ip:${ip}`, limit: route === 'request' ? 3 : 10 },
    { key: `${route}:tenant:${slug}`, limit: route === 'request' ? 20 : 60 },
  ];
  const recentHits = buckets.map((bucket) => ({
    ...bucket,
    recent: (registrationHits.get(bucket.key) ?? [])
      .filter((timestamp) => now - timestamp < 60_000),
  }));
  for (const bucket of recentHits) {
    if (bucket.recent.length >= bucket.limit) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'Demasiadas solicitudes de registro. Inténtalo de nuevo en un minuto.' });
      return;
    }
  }
  for (const bucket of recentHits) {
    bucket.recent.push(now);
    registrationHits.set(bucket.key, bucket.recent);
  }
  next();
};

const slugCache = new Map<string, { tenantId: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function resolveTenantSlug(slug: string): Promise<string | null> {
  if (!isValidTenantSlug(slug)) return null;
  const cached = slugCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.tenantId;

  const response = await fetch(
    `${AUTH_SERVICE_URL}/api/auth/internal/tenant/${encodeURIComponent(slug)}`,
    { headers: { 'x-internal-service-token': internalServiceToken() } }
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Tenant resolver returned HTTP ${response.status}`);
  const data = await response.json() as { tenant_id?: string };
  if (!data.tenant_id) throw new Error('Tenant resolver response did not include tenant_id.');
  slugCache.set(slug, { tenantId: data.tenant_id, expiresAt: Date.now() + CACHE_TTL_MS });
  return data.tenant_id;
}

function tenantScopedProxy(
  targetUrl: string,
  apiPrefix: string,
  limitRegistrations = false
): RequestHandler[] {
  const resolve: RequestHandler = async (req, res, next) => {
    try {
      const tenantId = await resolveTenantSlug(req.params.slug);
      if (!tenantId) {
        res.status(404).json({ error: `Negocio '${req.params.slug}' no encontrado.` });
        return;
      }
      req.headers['x-tenant-id'] = tenantId;
      const secret = process.env.JWT_SECRET;
      if (!secret) throw new Error('JWT_SECRET debe estar configurado en API Gateway.');
      assertTenantToken(req.header('authorization'), tenantId, secret);
      next();
    } catch (error) {
      if (error instanceof TenantTokenError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message.includes('JWT_SECRET')) {
        console.error('[Gateway] Falta configurar JWT_SECRET:', error);
        res.status(500).json({ error: 'La autenticación no está configurada correctamente.' });
        return;
      }
      console.error('[Gateway] No se pudo resolver el negocio:', error);
      res.status(502).json({ error: 'No fue posible resolver el negocio.' });
    }
  };

  const handlers: RequestHandler[] = [resolve];
  if (limitRegistrations) handlers.push(registrationRateLimit);
  handlers.push(proxy(targetUrl, {
      parseReqBody: false,
      proxyReqPathResolver: (req) => `${apiPrefix}${req.url}`,
      proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
        proxyReqOpts.headers = proxyReqOpts.headers ?? {};
        proxyReqOpts.headers['x-tenant-id'] = srcReq.headers['x-tenant-id'] as string;
        return proxyReqOpts;
      },
    }));
  return handlers;
}

app.use('/recicla/:slug/quotation', quoteCreateRateLimit, ...tenantScopedProxy(QUOTATION_SERVICE_URL, '/api/quotation'));
app.use('/recicla/:slug/catalog', ...tenantScopedProxy(CATALOG_SERVICE_URL, '/api/catalog'));
app.use('/recicla/:slug/auth', ...tenantScopedProxy(AUTH_SERVICE_URL, '/api/auth', true));
app.use('/recicla/:slug/orders', ...tenantScopedProxy(ORDERS_SERVICE_URL, '/api/orders'));
app.use('/recicla/:slug/inspections', ...tenantScopedProxy(INSPECTION_SERVICE_URL, '/api/inspections'));

app.use('/recicla/:slug/api/quotation', quoteCreateRateLimit, ...tenantScopedProxy(QUOTATION_SERVICE_URL, '/api/quotation'));
app.use('/recicla/:slug/api/catalog', ...tenantScopedProxy(CATALOG_SERVICE_URL, '/api/catalog'));
app.use('/recicla/:slug/api/auth', ...tenantScopedProxy(AUTH_SERVICE_URL, '/api/auth', true));
app.use('/recicla/:slug/api/orders', ...tenantScopedProxy(ORDERS_SERVICE_URL, '/api/orders'));
app.use('/recicla/:slug/api/inspections', ...tenantScopedProxy(INSPECTION_SERVICE_URL, '/api/inspections'));

app.post('/api/auth/client-tenants', clientTenantLookupRateLimit, proxy(AUTH_SERVICE_URL, {
  parseReqBody: false,
  proxyReqPathResolver: (req) => req.originalUrl,
}));
app.use('/api/auth', proxy(AUTH_SERVICE_URL, {
  parseReqBody: false,
  proxyReqPathResolver: (req) => req.originalUrl,
}));
app.use('/api/quotation', quoteCreateRateLimit, proxy(QUOTATION_SERVICE_URL, {
  parseReqBody: false,
  proxyReqPathResolver: (req) => req.originalUrl,
}));
app.use('/api/catalog', proxy(CATALOG_SERVICE_URL, {
  parseReqBody: false,
  proxyReqPathResolver: (req) => req.originalUrl,
}));
app.use('/api/orders', proxy(ORDERS_SERVICE_URL, {
  parseReqBody: false,
  proxyReqPathResolver: (req) => req.originalUrl,
}));
app.use('/api/inspections', proxy(INSPECTION_SERVICE_URL, {
  parseReqBody: false,
  proxyReqPathResolver: (req) => req.originalUrl,
}));

app.listen(PORT, () => {
  console.log(`[API Gateway] Running on port ${PORT}`);
  console.log(`[API Gateway] Auth proxy -> ${AUTH_SERVICE_URL}`);
  console.log(`[API Gateway] Quotation proxy -> ${QUOTATION_SERVICE_URL}`);
  console.log(`[API Gateway] Catalog proxy -> ${CATALOG_SERVICE_URL}`);
  console.log(`[API Gateway] Orders proxy -> ${ORDERS_SERVICE_URL}`);
  console.log(`[API Gateway] Inspection proxy -> ${INSPECTION_SERVICE_URL}`);
});
