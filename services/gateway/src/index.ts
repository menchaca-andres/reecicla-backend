import express from 'express';
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

app.use(cors());

app.get('/health', (_req, res) => {
  res.json({ service: 'gateway', status: 'OK' });
});

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
