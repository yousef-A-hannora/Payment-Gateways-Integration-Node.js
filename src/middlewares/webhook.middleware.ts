import crypto                       from 'crypto';
import { Request, Response, NextFunction } from 'express';
import Stripe                        from 'stripe';

// ─────────────────────────────────────────────────────────────────────────────
// Paymob HMAC verification middleware
//
// Paymob concatenates specific transaction fields in a fixed order,
// then signs with HMAC-SHA512 using your HMAC secret.
// ─────────────────────────────────────────────────────────────────────────────

export function verifyPaymobWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const hmacSecret = process.env.PAYMOB_HMAC_SECRET;

  if (!hmacSecret) {
    res.status(500).json({ error: 'PAYMOB_HMAC_SECRET not configured' });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const obj  = body.obj as Record<string, unknown>;

  if (!obj) {
    res.status(400).json({ error: 'Invalid Paymob webhook payload' });
    return;
  }

  // Field order is fixed by Paymob — do NOT change it
  const sourceData = obj.source_data as Record<string, unknown>;
  const order      = obj.order as Record<string, unknown>;

  const hashString = [
    obj.amount_cents,
    obj.created_at,
    obj.currency,
    obj.error_occured,
    obj.has_parent_transaction,
    obj.id,
    obj.integration_id,
    obj.is_3d_secure,
    obj.is_auth,
    obj.is_capture,
    obj.is_refunded,
    obj.is_standalone_payment,
    obj.is_voided,
    order?.id,
    obj.owner,
    obj.pending,
    sourceData?.pan,
    sourceData?.sub_type,
    sourceData?.type,
    obj.success,
  ].join('');

  const computed = crypto
    .createHmac('sha512', hmacSecret)
    .update(hashString)
    .digest('hex');

  const received = req.query.hmac as string;

  if (computed !== received) {
    res.status(401).json({ error: 'Invalid Paymob HMAC signature' });
    return;
  }

  next();
}

export function verifyPaymobSubscriptionWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const secret = process.env.PAYMOB_HMAC_SECRET;

  if (!secret) {
    return res.status(500).json({
      error: "PAYMOB_HMAC_SECRET not configured",
    });
  }

  const {
    trigger_type,
    subscription_data,
    hmac
  } = req.body;
  console.log(`${trigger_type}for${subscription_data.id}`)
  // console.log("req.body:\n",req.body)
  if (!trigger_type || !subscription_data.id) {
    return res.status(400).json({
      error: "Invalid subscription webhook",
    });
  }

  const hashString = `${trigger_type}for${subscription_data.id}`;

  const calculated = crypto
    .createHmac("sha512", secret)
    .update(hashString)
    .digest("hex");

  console.log("calculated !== received",`${calculated} !== ${hmac}`)
  if (calculated !== hmac) {
    return res.status(401).json({
      error: "Invalid HMAC",
    });
  }

  next();
}
// ─────────────────────────────────────────────────────────────────────────────
// Stripe webhook signature verification middleware
//
// Stripe signs the raw request body — must use express.raw() for this route,
// NOT express.json(). See payment.route.ts for the setup.
// ─────────────────────────────────────────────────────────────────────────────

export function verifyStripeWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET not configured' });
    return;
  }

  const sig = req.headers['stripe-signature'];

  if (!sig) {
    res.status(400).json({ error: 'Missing Stripe-Signature header' });
    return;
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-02-24.acacia',
  });

  try {
    const event = stripe.webhooks.constructEvent(
      req.body as Buffer,   // raw body — requires express.raw()
      sig,
      webhookSecret,
    );

    // Attach the verified event so the route handler can use it
    (req as Request & { stripeEvent: Stripe.Event }).stripeEvent = event;
    next();
    }catch (err) {
      console.error(err);

      const message = err instanceof Error ? err.message : "Unknown error";
      res.status(400).json({
        error: `Stripe webhook verification failed: ${message}`,
      });
    }
}
