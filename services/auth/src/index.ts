import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: 'auth-service', status: 'OK' });
});

app.listen(PORT, () => {
  console.log(`Auth Service running on port ${PORT}`);
});
