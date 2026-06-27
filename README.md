
# Payment Gateway Integration (Node.js + Express + TypeScript)

A unified payment-gateway abstraction layer that supports **Paymob** and **Stripe** through a single factory pattern. Swap providers with an environment variable — no code changes required.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [How to Use in Your Code](#how-to-use-in-your-code)
  - [Factory Pattern](#factory-pattern)
  - [Using the Gateway in Service Classes](#using-the-gateway-in-service-classes)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
  - [POST /api/payments — Create a Payment](#post-apipayments--create-a-payment)
  - [GET /api/payments/:transactionId/status — Check Payment Status](#get-apipaymentstransactionidstatus--check-payment-status)
  - [POST /api/payments/:transactionId/refund — Refund a Payment](#post-apipaymentstransactionidrefund--refund-a-payment)
  - [POST /api/payments/webhooks/paymob — Paymob Webhook](#post-apipaymentswebhookspaymob--paymob-webhook)
  - [POST /api/payments/webhooks/stripe — Stripe Webhook](#post-apipaymentswebhooksstripe--stripe-webhook)


---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                      Express App (app.ts)                 │
│                          │                                │
│                     /api/payments                          │
│                          │                                │
│                   payment.route.ts                        │
│                   (route handlers)                         │
│                          │                                │
│            ┌─────────────┴──────────────┐                 │
│            │   createPaymentGateway()   │  ← Factory      │
│            └─────────────┬──────────────┘                 │
│                           │                               │
│              ┌────────────┴────────────┐                  │
│              │                         │                  │
│      PaymobGateway              StripeGateway             │
│      (paymob.gateway.ts)       (stripe.gateway.ts)        │
│              │                         │                  │
│              └────────────┬────────────┘                  │
│                           │                               │
│                  IPaymentGateway                          │
│                  (shared interface)                        │
└──────────────────────────────────────────────────────────┘
```

The system is built around three core ideas:

1. **`IPaymentGateway` interface** — a common contract every provider must implement (`createPayment`, `getPaymentStatus`, `refund`).
2. **Factory function** (`createPaymentGateway`) — returns the correct gateway instance based on the `PAYMENT_PROVIDER` env var.
3. **Route handlers** — call the gateway through the interface, so the provider can be swapped without touching route logic.

---

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

## How to Use in Your Code

### Factory Pattern

The gateway is created through a **factory function** — `createPaymentGateway()` — which reads the `PAYMENT_PROVIDER` environment variable and returns the appropriate `IPaymentGateway` instance. This means your business logic never depends on a concrete provider class.

```typescript
import { createPaymentGateway } from './gateways/payment.factory';
import { IPaymentGateway } from './types/payment';

// Option 1: Let the factory read PAYMENT_PROVIDER from .env
const gateway: IPaymentGateway = createPaymentGateway();

// Option 2: Explicitly pass a provider (overrides env var)
const gateway: IPaymentGateway = createPaymentGateway('stripe');
```

The factory handles all credential validation at startup — if a required env var is missing, it throws immediately with a clear message.

## Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

| Variable | Provider | Description |
|---|---|---|
| `PORT` | Both | Server port (default `3000`) |
| `PAYMENT_PROVIDER` | Both | `paymob` or `stripe` (default `paymob`) |
| `PAYMOB_API_KEY` | Paymob | Settings → API Keys → API Key |
| `PAYMOB_SECRET_KEY` | Paymob | Settings → API Keys → Secret Key |
| `PAYMOB_PUBLIC_KEY` | Paymob | Settings → API Keys → Public Key |
| `PAYMOB_INTEGRATION_ID` | Paymob | Settings → Payment Integrations → Integration ID |
| `PAYMOB_IFRAME_ID` | Paymob | Settings → Iframes  |
| `PAYMOB_HMAC_SECRET` | Paymob | Settings → API Keys → HMAC |
| `STRIPE_SECRET_KEY` | Stripe | Stripe dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe | Stripe dashboard → Developers → Webhooks |
---


> ## *Note:* in stripe webhook select events
>
>
> - ✅ `charge.refunded`
> - ✅ `checkout.session.completed`
> - ✅ `checkout.session.expired`
> - ✅ `refund.created`
> - ✅ `refund.updated`
## API Endpoints


### POST /api/payments — Create a Payment

Creates a payment session with the active provider and returns a URL to redirect or embed for the customer.

**Headers**

| Header | Value | Required |
|---|---|---|
| `Content-Type` | `application/json` | Yes |

**Request Body** (`PaymentRequest`)

| Field | Type | Required | Description |
|---|---|---|---|
| `amount` | `number` | Yes | Amount in major currency unit (e.g. `50.00`) |
| `currency` | `string` | No | `EGP` (Paymob default) or `USD` (Stripe default) |
| `customerName` | `string` | Yes | Full customer name |
| `customerEmail` | `string` | Yes | Customer email |
| `customerPhone` | `string` | Yes* | Customer phone number (required by Paymob) |
| `state` | `string` | Yes* | Customer state / governorate |
| `city` | `string` | Yes* | Customer city |
| `address` | `string` | Yes* | Customer street address |
| `successUrl` | `string` | No | Redirect URL on success |
| `failUrl` | `string` | No | Redirect URL on failure / cancel |
| `pendingUrl` | `string` | No | Redirect URL when payment is pending |
| `notificationUrl` | `string` | No | Per-payment webhook URL (Paymob only) |
| `specialReference` | `string` | No | Your internal order / reference ID |
| `items` | `PaymentItem[]` | No | Line items; defaults to a single "Order" item |

\* The route only validates `amount`, `customerName`, and `customerEmail`, but Paymob requires `customerPhone`, `state`, `city`, and `address` in the billing data.

**`PaymentItem` shape**

```json
{
  "name": "Product Name",
  "price": 50.00,
  "quantity": 2
}
```

**Example Request**

```bash
curl -X POST http://localhost:3000/api/payments \
  -H "Content-Type: application/json" \
  -d '{
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
  }'
```

**Response — `201 Created`** (`PaymentResult`)

```json
{
  "transactionId": "intention_xxxxxxx",
  "paymentUrl": "https://accept.paymob.com/api/acceptance/iframes/88888888?payment_token=xxxx",
  "clientSecret": "secret_xxxxxxx",
  "status": "pending",
  "raw": { "...full provider response..." }
}
```

| Field | Type | Description |
|---|---|---|
| `transactionId` | `string` | Stable ID — use for status checks and refunds |
| `paymentUrl` | `string` | Redirect or embed URL for the customer |
| `clientSecret` | `string \| undefined` | Stripe: for frontend SDK; Paymob: `client_secret` |
| `status` | `PaymentStatus` | Always `pending` on creation |
| `raw` | `object \| undefined` | Full raw provider response (for debugging) |

**Error — `400 Bad Request`**

```json
{
  "error": "amount, customerName, and customerEmail are required"
}
```

**Error — `500 Internal Server Error`**

```json
{
  "error": "Paymob createPayment failed: { ... }"
}
```

---

### GET /api/payments/:transactionId/status — Check Payment Status

Retrieves the current status of a payment from the provider.

**Headers**

No special headers required.

**URL Parameters**

| Param | Type | Description |
|---|---|---|
| `transactionId` | `string` | The ID returned in `PaymentResult.transactionId` |

**Example Request**

```bash
curl http://localhost:3000/api/payments/transaction_xxxxxxx/status
```
**Note: in paymob, transactionID is like:45586211, and in stripe: pi_3Tms3nBWbvFyGICz0HOMz7av**

**Response — `200 OK`**

```json
{
  "transactionId": "transaction_xxxxxxx",
  "status": "paid"
}
```

The `status` field is one of the `PaymentStatus` enum values:

| Value | Description |
|---|---|
| `pending` | Payment initiated, awaiting completion |
| `paid` | Payment successfully completed |
| `failed` | Payment failed or expired |
| `refunded` | Payment has been refunded |

---

### POST /api/payments/:transactionId/refund — Refund a Payment

Issues a full or partial refund for a completed payment.

**Headers**

| Header | Value | Required |
|---|---|---|
| `Content-Type` | `application/json` | Yes |

**URL Parameters**

| Param | Type | Description |
|---|---|---|
| `transactionId` | `string` | The provider transaction ID |

**Request Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `amount` | `number` | Yes | Amount to refund in major currency unit (must be > 0) |

**Example Request**

```bash
curl -X POST http://localhost:3000/api/payments/transaction_xxxxxxx/refund \
  -H "Content-Type: application/json" \
  -d '{ "amount": 50.00 }'
```
**Note: in paymob, transactionID is like:45586211, and in stripe: pi_3Tms3nBWbvFyGICz0HOMz7av**

**Response — `200 OK`**

```json
{
  "success": true
}
```

**Error — `400 Bad Request`**

```json
{
  "error": "amount is required and must be greater than 0"
}
```

**Error — `501 Not Implemented`** (provider doesn't support API refunds)

```json
{
  "success": false,
  "error": "The current payment provider does not support API refunds. Use the dashboard instead."
}
```

> **Note:** For Stripe, if the `transactionId` starts with `cs_` (Checkout Session ID), the gateway automatically retrieves the underlying `PaymentIntent` ID before issuing the refund.

---

### POST /api/payments/webhooks/paymob — Paymob Webhook

Receives Paymob transaction callbacks. Verifies the HMAC-SHA512 signature before processing.

**Headers**

| Header | Value | Required |
|---|---|---|
| `Content-Type` | `application/json` | Yes |

**Query Parameters**

| Param | Type | Description |
|---|---|---|
| `hmac` | `string` | HMAC signature sent by Paymob |

**Request Body** (Paymob callback payload)

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
    "source_data": {
      "type": "card",
      "sub_type": "MasterCard",
      "pan": "************1234"
    },
    "...": "other Paymob fields"
  }
}
```

**Response — `200 OK`** 

**Error — `401 Unauthorized`** (HMAC mismatch)

```json
{
  "error": "Invalid Paymob HMAC signature"
}
```

**HMAC Verification Details**

The middleware concatenates the following fields from `obj` in this exact order (defined by Paymob — do not change):

`amount_cents`, `created_at`, `currency`, `error_occured`, `has_parent_transaction`, `id`, `integration_id`, `is_3d_secure`, `is_auth`, `is_capture`, `is_refunded`, `is_standalone_payment`, `is_voided`, `order.id`, `owner`, `pending`, `source_data.pan`, `source_data.sub_type`, `source_data.type`, `success`

The resulting string is HMAC-SHA512 signed with `PAYMOB_HMAC_SECRET` and compared to the `hmac` query parameter.

---

### POST /api/payments/webhooks/stripe — Stripe Webhook
--
**Note** *in stripe webhook it reqires the request body to be a buffer or text,not json, so in the src/app.js keep:*
```bash

app.use((req, res, next) => {
  if (req.originalUrl === "/api/payments/webhooks/stripe") {
    next();
  } else {
    express.json()(req, res, next);
  }
});
```
*so it gives the req.body to stripe webhook as buffer and to the rest of the api as json*
-
Receives Stripe event webhooks. Verifies the signature using the raw request body.

> **Important:** This route uses `express.raw({ type: 'application/json' })` instead of `express.json()`. The global JSON middleware in `app.ts` skips this route so Stripe can verify the raw body signature.

**Headers**

| Header | Value | Required |
|---|---|---|
| `Content-Type` | `application/json` | Yes |
| `stripe-signature` | `string` | Yes — Stripe-generated signature |

**Request Body**

Raw JSON body (as sent by Stripe — do not parse before verification).

**Handled Event Types**

| Event Type | Action |
|---|---|
| `checkout.session.completed` | Log success; placeholder for marking order as `paid` |
| `checkout.session.expired` | Log expiry; placeholder for marking order as `failed` |
| `charge.refunded` | Log refund; placeholder for marking order as `refunded` |
| *(other)* | Logged as unhandled |

**Response — `200 OK`** 

**Error — `400 Bad Request`** (signature verification failed)

```json
{
  "error": "Stripe webhook verification failed: No signatures found matching the expected signature for payload"
}
```

**Verification Details**

The middleware uses `stripe.webhooks.constructEvent()` with:
- The raw request body (`Buffer`)
- The `stripe-signature` header
- The `STRIPE_WEBHOOK_SECRET` env var

The verified `Stripe.Event` is attached to `req.stripeEvent` for the route handler to process.
