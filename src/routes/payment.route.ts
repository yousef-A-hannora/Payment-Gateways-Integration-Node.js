import { Router, Request, Response } from 'express';
import express                        from 'express';
import Stripe                         from 'stripe';
import { createPaymentGateway }       from '../gateways/payment.factory';
import { PaymobGateway }              from '../gateways/paymob.gateway';
import { PaymentRequest }             from '../types/payment';
import {
  verifyPaymobSubscriptionWebhook,
  verifyPaymobWebhook,
  verifyStripeWebhook,
} from '../middlewares/webhook.middleware';

const router  = Router();
const gateway = createPaymentGateway('paymob');   // reads PAYMENT_PROVIDER from env

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

router.post(
  "/webhooks/paymob/subscription",
  verifyPaymobSubscriptionWebhook,
  (req, res) => {
    const body = req.body;

    // console.log("Subscription Webhook");
    // console.log(body);

    const {
      trigger_type,
      subscription_data,
      plan_id,
      customer_id,
      payment_status,
    } = body;
    console.log({
      trigger_type,
      subscription_data,
      plan_id,
      customer_id,
      payment_status,
    })
    switch (trigger_type) {
      case "Subscription Created":
        console.log(`Subscription ${subscription_data.id} created`);
        break;

      case "Successful Transaction":
        console.log(`Subscription ${subscription_data.id} renewed`);
        break;

      case "canceled":
        console.log(`Subscription ${subscription_data.id} cancelled`);
        break;

      case "suspended":
        console.log(`Subscription ${subscription_data.id} paused`);
        break;

      case "resumed":
        console.log(`Subscription ${subscription_data.id} resumed`);
        break;

      case "Failed Transaction":
        console.log(`Renewal payment failed`);
        break;

      default:
        console.log("Unknown event:", trigger_type);
    }

    res.sendStatus(200);
  }
);

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

// ─────────────────────────────────────────────────────────────────────────────
// Subscription & Plan routes  (Paymob-specific)
// The IPaymentGateway interface covers payments & refunds only; subscription
// methods live on PaymobGateway, so we cast here.
// ─────────────────────────────────────────────────────────────────────────────
const paymob = gateway as PaymobGateway;

// ── Plans ────────────────────────────────────────────────────────────────────

// POST /api/payments/plans — create a new subscription plan
router.post('/plans', async (req: Request, res: Response) => {
  const { name, frequency, amountCents, motoIntegration, reminderDays, retrialDays, webhookUrl } = req.body;

  if (!name || !frequency || !amountCents || !motoIntegration) {
    res.status(400).json({
      error: 'name, frequency, amountCents, and motoIntegration are required',
    });
    return;
  }

  try {
    const plan = await paymob.createPlan({
      name,
      frequency,
      amountCents,
      motoIntegration,
      reminderDays,
      retrialDays,
      webhookUrl,
    });
    res.status(201).json(plan);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/payments/plans/:planId/suspend — pause the plan
router.post('/plans/:planId/suspend', async (req: Request, res: Response) => {
  const planId = Number(req.params.planId);

  try {
    await paymob.stopPlan(planId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/payments/plans/:planId/resume — resume the plan
router.post('/plans/:planId/resume', async (req: Request, res: Response) => {
  const planId = Number(req.params.planId);

  try {
    await paymob.resumePlan(planId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/payments/plans/:planId/subscriptions — list subscriptions for a plan
router.get('/plans/:planId/subscriptions', async (req: Request, res: Response) => {
  const planId = Number(req.params.planId);

  try {
    const subs = await paymob.getSubscriptionsByPlan(planId);
    res.json(subs);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Subscriptions ─────────────────────────────────────────────────────────────

// POST /api/payments/subscriptions/enroll — customer subscribes to a plan
router.post('/subscriptions/enroll', async (req: Request, res: Response) => {
  const { paymentRequest, planId, startDate } = req.body as {
    paymentRequest: PaymentRequest;
    planId: number;
    startDate?: string;
  };

  if (!paymentRequest || !planId) {
    res.status(400).json({ error: 'paymentRequest and planId are required' });
    return;
  }

  const result = await paymob.enrollSubscription(paymentRequest, planId, startDate);
  res.status(201).json(result);
});

// GET /api/payments/subscriptions/:subscriptionId — get subscription details
router.get('/subscriptions/:subscriptionId', async (req: Request, res: Response) => {
  const subscriptionId = Number(req.params.subscriptionId);

  try {
    const sub = await paymob.getSubscription(subscriptionId);
    res.json(sub);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/payments/subscriptions/:subscriptionId/suspend — pause a subscription
router.post('/subscriptions/:subscriptionId/suspend', async (req: Request, res: Response) => {
  const subscriptionId = Number(req.params.subscriptionId);

  try {
    await paymob.stopSubscription(subscriptionId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/payments/subscriptions/:subscriptionId/resume — resume a subscription
router.post('/subscriptions/:subscriptionId/resume', async (req: Request, res: Response) => {
  const subscriptionId = Number(req.params.subscriptionId);

  try {
    await paymob.resumeSubscription(subscriptionId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/payments/subscriptions/:subscriptionId/cancel — cancel a subscription
router.post('/subscriptions/:subscriptionId/cancel', async (req: Request, res: Response) => {
  const subscriptionId = Number(req.params.subscriptionId);

  try {
    await paymob.cancelSubscription(subscriptionId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /api/payments/subscriptions/:subscriptionId — update amount or end date
router.put('/subscriptions/:subscriptionId', async (req: Request, res: Response) => {
  const subscriptionId = Number(req.params.subscriptionId);
  const { amountCents, endsAt } = req.body as { amountCents?: number; endsAt?: string };

  if (!amountCents && !endsAt) {
    res.status(400).json({ error: 'amountCents or endsAt is required' });
    return;
  }

  try {
    await paymob.updateSubscription(subscriptionId, { amountCents, endsAt });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
