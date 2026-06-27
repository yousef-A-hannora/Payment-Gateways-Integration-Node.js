import Stripe from 'stripe';
import {
  IPaymentGateway,
  PaymentRequest,
  PaymentResult,
  PaymentStatus,
} from '../types/payment';

// ─────────────────────────────────────────────────────────────────────────────
// Stripe Gateway  (Checkout Sessions)
//
// Docs:
//   Checkout Sessions : https://stripe.com/docs/api/checkout/sessions
//   Refunds           : https://stripe.com/docs/api/refunds
//
// Required env vars:
//   STRIPE_SECRET_KEY        – Stripe dashboard → Developers → API keys
//   STRIPE_WEBHOOK_SECRET    – Stripe dashboard → Developers → Webhooks
//
// Install:
//   npm install stripe
// ─────────────────────────────────────────────────────────────────────────────

export class StripeGateway implements IPaymentGateway {
  readonly supportsRefund = true;

  private readonly stripe: Stripe;

  constructor(config: { secretKey: string }) {
    this.stripe = new Stripe(config.secretKey, {
      apiVersion: '2025-02-24.acacia',
    });
  }

  // ── Public interface ──────────────────────────────────────────────────────

  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    const session = await this.stripe.checkout.sessions.create({
      mode:          'payment',
      currency:      (request.currency ?? 'usd').toLowerCase(),
      customer_email: request.customerEmail,
      metadata: {
        customerName:    request.customerName,
        customerPhone:   request.customerPhone,
        specialReference: request.specialReference ?? '',
      },
      line_items: request.items?.map((item) => ({
        quantity:   item.quantity,
        price_data: {
          currency:     (request.currency ?? 'usd').toLowerCase(),
          unit_amount:  Math.round(item.price * 100),
          product_data: { name: item.name },
        },
      })) ?? [{
        quantity:   1,
        price_data: {
          currency:    (request.currency ?? 'usd').toLowerCase(),
          unit_amount: Math.round(request.amount * 100),
          product_data: { name: 'Order' },
        },
      }],
      success_url: request.successUrl ?? 'https://yoursite.com/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  request.failUrl    ?? 'https://yoursite.com/cancel',
    });

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL');
    }

    return {
      transactionId: session.id,           // use this for status checks & refunds
      paymentUrl:    session.url,          // redirect customer here
      clientSecret:  session.client_secret ?? undefined,
      status:        PaymentStatus.Pending,
      raw:           session as unknown as Record<string, unknown>,
    };
  }

  async getPaymentStatus(transactionId: string): Promise<PaymentStatus|null> {
    // transactionId is the Checkout Session ID (cs_xxx)
    try{
    const session = await this.stripe.paymentIntents.retrieve(transactionId);
    
    const map: Record<string, PaymentStatus> = {
      complete:  PaymentStatus.Paid,
      expired:   PaymentStatus.Failed,
      open:      PaymentStatus.Pending,
    };

    return map[session.status ?? 'open'] ?? PaymentStatus.Pending;
    }catch(err){console.error(err); return null}
  }

  async refund(transactionId: string, amount: number): Promise<boolean> {
    // transactionId here must be the PaymentIntent ID (pi_xxx)
    // If you stored the Session ID, retrieve the PaymentIntent from it first
    let paymentIntentId = transactionId;

    if (transactionId.startsWith('cs_')) {
      const session     = await this.stripe.checkout.sessions.retrieve(transactionId);
      paymentIntentId   = session.payment_intent as string;
    }

    const refund = await this.stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount:         Math.round(amount * 100),  // partial refund — omit for full
    });

    return refund.status === 'succeeded';
  }
}
