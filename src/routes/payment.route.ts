import { Router, Request, Response } from 'express';
import express                        from 'express';
import Stripe                         from 'stripe';
import { createPaymentGateway }       from '../gateways/payment.factory';
import { PaymentRequest }             from '../types/payment';
import {
  verifyPaymobWebhook,
  verifyStripeWebhook,
} from '../middlewares/webhook.middleware';

const router  = Router();
const gateway = createPaymentGateway('stripe');   // reads PAYMENT_PROVIDER from env

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments
// Create a payment session — returns a URL to redirect or embed
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const request = req.body as PaymentRequest;

  if (!request.amount || !request.customerName || !request.customerEmail) {
    res.status(400).json({
      error: 'amount, customerName, and customerEmail are required',
    });
    return;
  }

  const result = await gateway.createPayment(request);
  res.status(201).json(result);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/:transactionId/status
// Check the current status of a payment
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:transactionId/status', async (req: Request, res: Response) => {
  const { transactionId } = req.params;

  const status = await gateway.getPaymentStatus(transactionId);
  res.json({ transactionId, status });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/:transactionId/refund
// Refund a payment (full or partial)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:transactionId/refund', async (req: Request, res: Response) => {
  if (!gateway.supportsRefund) {
    res.status(501).json({
      success: false,
      error:   'The current payment provider does not support API refunds. Use the dashboard instead.',
    });
    return;
  }

  const { amount } = req.body as { amount: number };

  if (!amount || amount <= 0) {
    res.status(400).json({ error: 'amount is required and must be greater than 0' });
    return;
  }

  const success = await gateway.refund(req.params.transactionId, amount);
  res.json({ success });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/webhooks/paymob
// Paymob transaction callback — verifies HMAC, then processes the event
// ─────────────────────────────────────────────────────────────────────────────
router.post('/webhooks/paymob', verifyPaymobWebhook, (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  
  const obj  = body.obj as Record<string, {
    success:     boolean;
    is_refunded: boolean;
    id:          number;
    order:       { id: number };
    amount_cents: number;
  }>;

  const { success, is_refunded, id, order, amount_cents } = obj as unknown as {
    success:     boolean;
    is_refunded: boolean;
    id:          number;
    order:       { id: number };
    amount_cents: number;
  };

  if (is_refunded) {
    console.log(`[Paymob] Refund confirmed — transaction: ${id}, order: ${order.id}`);
    // TODO: update order status to 'refunded' in your DB
  } else if (success) {
    console.log(`[Paymob] Payment succeeded — transaction: ${id}, order: ${order.id}, amount: ${amount_cents / 100} EGP`);
    // TODO: update order status to 'paid' in your DB
  } else {
    console.log(`[Paymob] Payment failed — transaction: ${id}, order: ${order.id}`);
    // TODO: update order status to 'failed' in your DB
  }

  res.sendStatus(200);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/webhooks/stripe
// Stripe event webhook — MUST use express.raw() (see app.ts)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/webhooks/stripe',
  express.raw({ type: 'application/json' }),   // override json() for this route
  verifyStripeWebhook,
  (req: Request, res: Response) => {
    const event = (req as Request & { stripeEvent: Stripe.Event }).stripeEvent;

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log(`[Stripe] Payment succeeded — session: ${session.id}, amount: ${(session.amount_total ?? 0) / 100} ${session.currency?.toUpperCase()}`);
        // TODO: update order status to 'paid' in your DB using session.metadata.specialReference
        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log(`[Stripe] Session expired — session: ${session.id}`);
        // TODO: update order status to 'failed' in your DB
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        console.log(`[Stripe] Refund processed — charge: ${charge.id}`);
        // TODO: update order status to 'refunded' in your DB
        break;
      }

      default:
        console.log(`[Stripe] Unhandled event type: ${event.type}`);
    }

    res.sendStatus(200);
  },
);

export default router;
