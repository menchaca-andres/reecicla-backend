import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import proxy from 'express-http-proxy';
import type { RequestHandler } from 'express';

dotenv.config();
if (!process.env.INTERNAL_SERVICE_TOKEN) {
  throw new Error('INTERNAL_SERVICE_TOKEN debe estar configurado.');
}

const app = express();
const PORT = process.env.PORT || 3000;

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
const QUOTATION_SERVICE_URL = process.env.QUOTATION_SERVICE_URL || 'http://quotation-service:3002';
const CATALOG_SERVICE_URL = process.env.CATALOG_SERVICE_URL || 'http://catalog-service:3003';
const ORDERS_SERVICE_URL = process.env.ORDERS_SERVICE_URL || 'http://orders-service:3004';
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
const quoteRateLimitCleanup = setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [ip, timestamps] of quoteHits) {
    if (timestamps.every((timestamp) => timestamp <= cutoff)) quoteHits.delete(ip);
  }
}, 60_000);
quoteRateLimitCleanup.unref();

function clientIp(req: express.Request): string {
  return req.socket.remoteAddress || 'unknown';
}

const quoteCreateRateLimit: RequestHandler = (req, res, next) => {
  if (req.method !== 'POST') {
    next();
    return;
  }
  const path = (req.path || '').split('?')[0];
  const isQuoteCreation = path === '/quotes' || path === '/quotes/';
  const isQuoteAcceptance = /^\/quotes\/[^/]+\/accept\/?$/.test(path);
  if (!isQuoteCreation && !isQuoteAcceptance) {
    next();
    return;
  }

  const now = Date.now();
  const windowMs = 60_000;
  const routeKey = isQuoteCreation ? 'create' : 'accept';
  const key = `${routeKey}:${clientIp(req)}`;
  const limit = isQuoteCreation ? QUOTE_RATE_LIMIT : EMAIL_VERIFICATION_RATE_LIMIT;
  const recent = (quoteHits.get(key) ?? []).filter((ts) => now - ts < windowMs);
  if (recent.length >= limit) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'Demasiadas cotizaciones. Probá de nuevo en un minuto.' });
    return;
  }
  recent.push(now);
  quoteHits.set(key, recent);
  next();
};

const slugCache = new Map<string, { tenantId: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function resolveTenantSlug(slug: string): Promise<string | null> {
  const cached = slugCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tenantId;
  }

  try {
    const response = await fetch(
      `${AUTH_SERVICE_URL}/api/auth/internal/tenant/${encodeURIComponent(slug)}`,
      { headers: { 'x-internal-service-token': internalServiceToken() } }
    );
    if (!response.ok) return null;

    const data = await response.json() as { tenant_id: string };
    slugCache.set(slug, { tenantId: data.tenant_id, expiresAt: Date.now() + CACHE_TTL_MS });
    return data.tenant_id;
  } catch {
    return null;
  }
}

function tenantScopedProxy(targetUrl: string, apiPrefix: string): RequestHandler[] {
  const resolve: RequestHandler = async (req, res, next) => {
    const { slug } = req.params;
    const tenantId = await resolveTenantSlug(slug);
    if (!tenantId) {
      res.status(404).json({ error: `Negocio '${slug}' no encontrado.` });
      return;
    }
    req.headers['x-tenant-id'] = tenantId;
    next();
  };

  return [
    resolve,
    proxy(targetUrl, {
      parseReqBody: false,
      proxyReqPathResolver: (req) => `${apiPrefix}${req.url}`,
      proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
        proxyReqOpts.headers = proxyReqOpts.headers ?? {};
        proxyReqOpts.headers['x-tenant-id'] = srcReq.headers['x-tenant-id'] as string;
        return proxyReqOpts;
      },
    }),
  ];
}

app.use('/recicla/:slug/quotation', quoteCreateRateLimit, ...tenantScopedProxy(QUOTATION_SERVICE_URL, '/api/quotation'));
app.use('/recicla/:slug/catalog', ...tenantScopedProxy(CATALOG_SERVICE_URL, '/api/catalog'));
app.use('/recicla/:slug/auth', ...tenantScopedProxy(AUTH_SERVICE_URL, '/api/auth'));
app.use('/recicla/:slug/orders', ...tenantScopedProxy(ORDERS_SERVICE_URL, '/api/orders'));

app.use(
  '/api/auth',
  proxy(AUTH_SERVICE_URL, {
    parseReqBody: false,
    proxyReqPathResolver: (req) => req.originalUrl,
  })
);

app.use(
  '/api/quotation',
  proxy(QUOTATION_SERVICE_URL, {
    parseReqBody: false,
    proxyReqPathResolver: (req) => req.originalUrl,
  })
);

app.use(
  '/api/catalog',
  proxy(CATALOG_SERVICE_URL, {
    parseReqBody: false,
    proxyReqPathResolver: (req) => req.originalUrl,
  })
);

app.use(
  '/api/orders',
  proxy(ORDERS_SERVICE_URL, {
    parseReqBody: false,
    proxyReqPathResolver: (req) => req.originalUrl,
  })
);

app.use(express.json());

app.listen(PORT, () => {
  console.log(`[API Gateway] Running on port ${PORT}`);
  console.log(`[API Gateway] Auth proxy -> ${AUTH_SERVICE_URL}`);
  console.log(`[API Gateway] Quotation proxy -> ${QUOTATION_SERVICE_URL}`);
  console.log(`[API Gateway] Catalog proxy -> ${CATALOG_SERVICE_URL}`);
  console.log(`[API Gateway] Orders proxy -> ${ORDERS_SERVICE_URL}`);
});
