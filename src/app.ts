import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import paymentRouter from './routes/payment.route';
const cors = require('cors');

const app  = express();
const PORT = process.env.PORT ?? 3000;

// ─────────────────────────────────────────────────────────────────────────────
// Global middleware
// NOTE: Stripe webhook route overrides this with express.raw() — see payment.route.ts
// ─────────────────────────────────────────────────────────────────────────────
app.use(cors());
app.use((req, res, next) => {
  if (req.originalUrl === "/api/payments/webhooks/stripe") {
    next();
  } else {
    express.json()(req, res, next);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Static files (test page at /test.html)
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api/payments', paymentRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', provider: process.env.PAYMENT_PROVIDER ?? 'paymob' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Global error handler
// ─────────────────────────────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Payment provider: ${process.env.PAYMENT_PROVIDER ?? 'paymob'}`);
});

export default app;
