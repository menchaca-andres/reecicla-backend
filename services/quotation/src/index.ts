import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: 'quotation-service', status: 'OK' });
});

app.listen(PORT, () => {
  console.log(`Quotation Service running on port ${PORT}`);
});
