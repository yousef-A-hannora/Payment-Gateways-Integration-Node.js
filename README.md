# Payment Gateway Integration (Node.js + Express + TypeScript)

A unified payment-gateway abstraction layer that supports **Paymob** and **Stripe** through a single factory pattern. Swap providers with an environment variable — no code changes required.

---

## Features

### Payments
- Create payment sessions
- Check payment status
- Full and partial refunds

### Paymob — Subscription Plans
- Create, suspend, and resume plans
- List subscriptions for a plan

### Paymob — Subscriptions
- Enroll customers, get details, suspend, resume, cancel, update

### Security
- Paymob webhook verification (HMAC-SHA512)
- Paymob subscription webhook verification
- Stripe webhook signature verification

---

## Architecture

Built around three core ideas:

1. **`IPaymentGateway` interface** — a common contract every provider must implement (`createPayment`, `getPaymentStatus`, `refund`).
2. **Factory function** (`createPaymentGateway`) — returns the correct gateway instance based on the `PAYMENT_PROVIDER` env var.
3. **Route handlers** — call the gateway through the interface, so the provider can be swapped without touching route logic.

## Project Structure

```
src/
├── app.ts                          # Express app setup, global middleware, error handler
├── gateways/
│   ├── payment.factory.ts          # Factory — creates the right gateway from env config
│   ├── paymob.gateway.ts           # Paymob implementation (Intention API)
│   └── stripe.gateway.ts           # Stripe implementation (Checkout Sessions)
├── middlewares/
│   └── webhook.middleware.ts       # HMAC / signature verification for webhooks
├── routes/
│   └── payment.route.ts            # All /api/payments endpoints
└── types/
    └── payment.ts                  # Shared types: PaymentRequest, PaymentResult, etc.
```

---

## How to Use

```typescript
import { createPaymentGateway } from './gateways/payment.factory';

const gateway = createPaymentGateway();          // reads PAYMENT_PROVIDER from .env
const gateway = createPaymentGateway('stripe');  // explicit override
```

The factory validates all required env vars at startup and throws immediately if any are missing.

---

## Gateway Methods

### Common (both providers)

| Method | Description |
|---|---|
| `createPayment(request)` | Creates a new payment session |
| `getPaymentStatus(transactionId)` | Returns the current payment status |
| `refund(transactionId, amount)` | Refunds a payment |

### Paymob — Plan Methods

| Method | Description |
|---|---|
| `createPlan(plan)` | Creates a subscription plan |
| `stopPlan(planId)` | Suspends a plan |
| `resumePlan(planId)` | Resumes a suspended plan |
| `getSubscriptionsByPlan(planId)` | Returns all subscriptions for a plan |

### Paymob — Subscription Methods

| Method | Description |
|---|---|
| `enrollSubscription(request, planId, startDate?)` | Enrolls a customer into a subscription plan |
| `getSubscription(subscriptionId)` | Returns subscription details |
| `stopSubscription(subscriptionId)` | Suspends a subscription |
| `resumeSubscription(subscriptionId)` | Resumes a suspended subscription |
| `cancelSubscription(subscriptionId)` | Cancels a subscription permanently |
| `updateSubscription(subscriptionId, updates)` | Updates subscription properties |

---

## Webhook Middleware

| Middleware | Description |
|---|---|
| `verifyPaymobWebhook()` | Verifies Paymob transaction webhooks via HMAC-SHA512 |
| `verifyPaymobSubscriptionWebhook()` | Verifies Paymob subscription webhooks |
| `verifyStripeWebhook()` | Verifies Stripe webhook signatures; attaches verified event to `req.stripeEvent` |

---

## Configuration

Copy `.env.example` to `.env` and fill in your credentials:

| Variable | Provider | Description |
|---|---|---|
| `PORT` | Both | Server port (default `3000`) |
| `PAYMENT_PROVIDER` | Both | `paymob` or `stripe` (default `paymob`) |
| `PAYMOB_API_KEY` | Paymob | Settings → API Keys → API Key |
| `PAYMOB_SECRET_KEY` | Paymob | Settings → API Keys → Secret Key |
| `PAYMOB_PUBLIC_KEY` | Paymob | Settings → API Keys → Public Key |
| `PAYMOB_INTEGRATION_ID` | Paymob | Settings → Payment Integrations → Integration ID |
| `PAYMOB_IFRAME_ID` | Paymob | Settings → Iframes |
| `PAYMOB_HMAC_SECRET` | Paymob | Settings → API Keys → HMAC |
| `API_BASE_URL` | Paymob | Base URL used for subscription webhook default |
| `STRIPE_SECRET_KEY` | Stripe | Stripe dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe | Stripe dashboard → Developers → Webhooks |

> **Stripe webhook:** enable these events in the dashboard:
> `charge.refunded`, `checkout.session.completed`, `checkout.session.expired`, `refund.created`, `refund.updated`

---

## Notes

- All gateways implement the shared `IPaymentGateway` interface.
- Switching providers requires only changing `PAYMENT_PROVIDER` — no code changes.
- Stripe webhook verification requires the raw request body (`express.raw()`). Keep this in `app.ts` to bypass global JSON parsing for that route only:
  ```js
  app.use((req, res, next) => {
    if (req.originalUrl === "/api/payments/webhooks/stripe") {
      next();
    } else {
      express.json()(req, res, next);
    }
  });
  ```
- Paymob subscription features (`plans`, `subscriptions`) are available only through `PaymobGateway`. If `PAYMENT_PROVIDER=stripe`, these routes are registered but will fail at runtime.

---

## API Endpoints

### POST /api/payments — Create a Payment

**Request**
```json
{
  "amount": 150.00,
  "currency": "EGP",
  "customerName": "Ahmed Ali",
  "customerEmail": "ahmed@example.com",
  "customerPhone": "+201234567890",
  "state": "Cairo",
  "city": "Cairo",
  "address": "123 Tahrir Street",
  "specialReference": "ORD-2024-001",
  "items": [
    { "name": "T-Shirt", "price": 100.00, "quantity": 1 },
    { "name": "Mug",     "price": 50.00,  "quantity": 1 }
  ],
  "successUrl": "https://yoursite.com/success",
  "failUrl": "https://yoursite.com/cancel"
}
```

> `amount`, `customerName`, `customerEmail` are required. Paymob additionally requires `customerPhone`, `state`, `city`, and `address`.

**Response `201`**
```json
{
  "transactionId": "intention_xxxxxxx",
  "paymentUrl": "https://accept.paymob.com/api/acceptance/iframes/88888888?payment_token=xxxx",
  "clientSecret": "secret_xxxxxxx",
  "status": "pending",
  "raw": {}
}
```

---

### GET /api/payments/:transactionId/status — Check Payment Status

> **Note:** Paymob `transactionId` looks like `45586211`; Stripe looks like `pi_3Tms3nBWbvFyGICz0HOMz7av`.

**Request**
```
GET /api/payments/45586211/status
```

**Response `200`**
```json
{
  "transactionId": "45586211",
  "status": "paid"
}
```

Status values: `pending` | `paid` | `failed` | `refunded`

---

### POST /api/payments/:transactionId/refund — Refund a Payment

> **Note:** Paymob `transactionId` looks like `45586211`; Stripe looks like `pi_3Tms3nBWbvFyGICz0HOMz7av`. For Stripe, if the ID starts with `cs_` (Checkout Session), the gateway automatically retrieves the underlying `PaymentIntent` before refunding.

**Request**
```json
{ "amount": 50.00 }
```

**Response `200`**
```json
{ "success": true }
```

---

### POST /api/payments/webhooks/paymob — Paymob Webhook

Verifies HMAC-SHA512 signature from the `hmac` query parameter before processing.

HMAC is computed by concatenating these `obj` fields in order: `amount_cents`, `created_at`, `currency`, `error_occured`, `has_parent_transaction`, `id`, `integration_id`, `is_3d_secure`, `is_auth`, `is_capture`, `is_refunded`, `is_standalone_payment`, `is_voided`, `order.id`, `owner`, `pending`, `source_data.pan`, `source_data.sub_type`, `source_data.type`, `success` — then HMAC-SHA512 signed with `PAYMOB_HMAC_SECRET`.

**Request**
```json
{
  "type": "TRANSACTION",
  "obj": {
    "id": 123456789,
    "success": true,
    "pending": false,
    "is_refunded": false,
    "amount_cents": 15000,
    "currency": "EGP",
    "order": { "id": 987654321 },
    "source_data": { "type": "card", "sub_type": "MasterCard", "pan": "************1234" }
  }
}
```

**Response `200`** — empty body on success.

---

### POST /api/payments/webhooks/paymob/subscription — Paymob Subscription Webhook

Verifies HMAC-SHA512 from the `hmac` field in the request body. Hash string is: `` `${trigger_type}for${subscription_data.id}` ``

**Request**
```json
{
  "trigger_type": "Subscription Created",
  "subscription_data": { "id": 12345 },
  "subscription_plan_id": 678,
  "customer_id": 999,
  "payment_status": "paid",
  "hmac": "computed_hmac_sha512_hex_string"
}
```

**Response `200`** — `{}` (empty JSON; Paymob expects a 200 to acknowledge receipt).

Handled `trigger_type` values: `Subscription Created`, `Successful Transaction`, `canceled`, `suspended`, `resumed`, `Failed Transaction`.

---

### POST /api/payments/webhooks/stripe — Stripe Webhook

Verifies signature using `stripe.webhooks.constructEvent()` with the raw body buffer, `stripe-signature` header, and `STRIPE_WEBHOOK_SECRET`.

**Request headers:** `Content-Type: application/json`, `stripe-signature: <value>`

**Request body:** Raw JSON as sent by Stripe — do not parse before verification.

**Response `200`** — empty body on success.

Handled events: `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`.

---

## Subscription & Plan Endpoints (Paymob-only)

> **Note:** These endpoints call methods directly on `PaymobGateway`. If `PAYMENT_PROVIDER=stripe`, the routes are registered but the underlying calls will fail — these features are Paymob-specific.

---

### POST /api/payments/plans — Create a Subscription Plan

**Request**
```json
{
  "name": "Monthly Pro Plan",
  "frequency": 30,
  "amountCents": 5000,
  "motoIntegration": 5377225,
  "reminderDays": 3,
  "retrialDays": 2
}
```

> `name`, `frequency`, `amountCents`, `motoIntegration` are required. `frequency` allowed values: `7`, `15`, `30`, `90`, `180`, `360` (days). `webhookUrl` defaults to `/api/payments/webhooks/paymob/subscription`.

**Response `201`**
```json
{
  "id": 678,
  "name": "Monthly Pro Plan",
  "frequency": 30,
  "amount_cents": 5000,
  "is_active": true
}
```

---

### POST /api/payments/plans/:planId/suspend — Suspend a Plan

**Response `200`**
```json
{ "success": true }
```

---

### POST /api/payments/plans/:planId/resume — Resume a Plan

**Response `200`**
```json
{ "success": true }
```

---

### GET /api/payments/plans/:planId/subscriptions — List Subscriptions for a Plan

**Response `200`**
```json
{
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 12345,
      "state": "active",
      "amount_cents": 5000,
      "starts_at": "2024-06-01T00:00:00Z",
      "next_billing": "2024-07-01T00:00:00Z",
      "ends_at": null,
      "plan_id": 678,
      "integration": 5377225,
      "initial_transaction": 987654321,
      "client_info": {
        "full_name": "Ahmed Ali",
        "email": "ahmed@example.com",
        "phone_number": "+201234567890"
      }
    }
  ]
}
```

---

### POST /api/payments/subscriptions/enroll — Enroll a Customer into a Plan

Returns a payment URL the customer must visit to complete the initial charge and activate the subscription.

**Request**
```json
{
  "paymentRequest": {
    "amount": 50.00,
    "currency": "EGP",
    "customerName": "Ahmed Ali",
    "customerEmail": "ahmed@example.com",
    "customerPhone": "+201234567890",
    "state": "Cairo",
    "city": "Cairo",
    "address": "123 Tahrir Street",
    "successUrl": "https://yoursite.com/success"
  },
  "planId": 678,
  "startDate": "2024-07-01"
}
```

**Response `201`**
```json
{
  "transactionId": "intention_xxxxxxx",
  "paymentUrl": "https://accept.paymob.com/api/acceptance/iframes/88888888?payment_token=xxxx",
  "clientSecret": "secret_xxxxxxx",
  "status": "pending",
  "raw": {}
}
```

---

### GET /api/payments/subscriptions/:subscriptionId — Get Subscription Details

**Response `200`**
```json
{
  "id": 12345,
  "state": "active",
  "amount_cents": 5000,
  "next_billing": "2024-07-01T00:00:00Z",
  "starts_at": "2024-06-01T00:00:00Z",
  "ends_at": null,
  "plan_id": 678
}
```

---

### POST /api/payments/subscriptions/:subscriptionId/suspend — Suspend a Subscription

Pauses billing. Can be resumed later.

**Response `200`**
```json
{ "success": true }
```

---

### POST /api/payments/subscriptions/:subscriptionId/resume — Resume a Subscription

Billing cycles continue from the next scheduled date.

**Response `200`**
```json
{ "success": true }
```

---

### POST /api/payments/subscriptions/:subscriptionId/cancel — Cancel a Subscription

> **Note:** This is irreversible. The customer must re-enroll to subscribe again.

**Response `200`**
```json
{ "success": true }
```

---

### PUT /api/payments/subscriptions/:subscriptionId — Update a Subscription

> At least one of `amountCents` or `endsAt` is required.

**Request**
```json
{
  "amountCents": 7000,
  "endsAt": "2025-12-31"
}
```

**Response `200`**
```json
{ "success": true }
```