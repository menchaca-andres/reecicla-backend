import express from 'express';
import dotenv from 'dotenv';
import proxy from 'express-http-proxy';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
const QUOTATION_SERVICE_URL = process.env.QUOTATION_SERVICE_URL || 'http://quotation-service:3002';

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: 'gateway', status: 'OK' });
});

app.use('/api/auth', proxy(AUTH_SERVICE_URL));
app.use('/api/quotations', proxy(QUOTATION_SERVICE_URL));

app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});
