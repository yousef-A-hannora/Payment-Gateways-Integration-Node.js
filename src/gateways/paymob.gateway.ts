import {
  IPaymentGateway,
  PaymentRequest,
  PaymentResult,
  PaymentStatus,
} from "../types/payment";
import type { paymobCreateOrderRessponce } from "../types/payment";
// ─────────────────────────────────────────────────────────────────────────────
// Paymob Gateway  (Intention API — single call to start a payment)
//
// Docs:
//   Create intention : https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention
//   Refund           : https://developers.paymob.com/paymob-docs/developers/manage-payment-apis/refund
//
// Required env vars:
//   PAYMOB_SECRET_KEY      – Settings → Account Info → Secret Key
//   PAYMOB_INTEGRATION_ID  – Developers → Payment Integrations
//   PAYMOB_IFRAME_ID       – Developers → iFrames
//   PAYMOB_PUBLIC_KEY      – Settings → Account Info → Public Key  (for unified checkout)
// ─────────────────────────────────────────────────────────────────────────────

interface PaymobTransactionResponse {
  success: boolean;
  pending: boolean;
  is_refunded: boolean;
}

export class PaymobGateway implements IPaymentGateway {
  readonly supportsRefund = true;

  constructor(
    private readonly config: {
      myURL:string;
      apiKey: string;
      secretKey: string;
      publicKey: string;
      integrationId: string; // array string e.g. "[5377225]"
      iframeId: string;
    },
  ) {}
  private readonly baseUrl = 'https://accept.paymob.com';
  // ─────────────────────────────────────────────────────────────────────────
  // Payment
  // ─────────────────────────────────────────────────────────────────────────

  async createPayment(request: PaymentRequest): Promise<PaymentResult | null> {
    return this.createIntention(request, null);
  }

  async getPaymentStatus(transactionId: string): Promise<PaymentStatus> {
    try {
      const token = await this.getAuthToken();
      const res = await fetch(
        `${this.baseUrl}/api/acceptance/transactions/${transactionId}?token=${token}`,
      );
      const data = (await res.json()) as PaymobTransactionResponse;

      if (!res.ok)
        throw new Error(`getPaymentStatus failed: ${JSON.stringify(data)}`);

      if (data.is_refunded) return PaymentStatus.Refunded;
      if (data.success) return PaymentStatus.Paid;
      if (data.pending) return PaymentStatus.Pending;
      return PaymentStatus.Failed;
    } catch (error) {
      console.error(error);
      return PaymentStatus.Failed;
    }
  }

  async refund(transactionId: string, amount: number): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/acceptance/void_refund/refund`,
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({
            transaction_id: Number(transactionId),
            amount_cents: Math.round(amount * 100),
          }),
        },
      );
      const data = (await res.json()) as { success: boolean };

      if (!res.ok) throw new Error(`refund failed: ${JSON.stringify(data)}`);
      return data.success === true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Subscription Plans  (auth: Bearer token from API key)
  // ─────────────────────────────────────────────────────────────────────────

  async createPlan(plan: {
    name: string;
    frequency: 7 | 15 | 30 | 90 | 180 | 360;
    amountCents: number;
    motoIntegration: number;
    reminderDays?: number;
    retrialDays?: number;
    webhookUrl?: string;
  }) {
    const token = await this.getAuthToken();
    const res = await fetch(
      `${this.baseUrl}/api/acceptance/subscription-plans`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: plan.name,
          frequency: plan.frequency,
          amount_cents: plan.amountCents,
          integration: plan.motoIntegration,
          reminder_days: plan.reminderDays ?? 2,
          retrial_days: plan.retrialDays ?? 2,
          number_of_deductions: null,
          use_transaction_amount: false,
          plan_type: "rent",
          is_active: true,
          ...(plan.webhookUrl ? {webhook_url:plan.webhookUrl} : {webhook_url :`${this.config.myURL}/api/payments/webhooks/paymob/subscription`})
        }),
      },
    );

    const data = await res.json();
    if (!res.ok) throw new Error(`createPlan failed: ${JSON.stringify(data)}`);
    return data as {
      id: number;
      name: string;
      frequency: number;
      amount_cents: number;
      is_active: boolean;
    };
  }

  async stopPlan(planId: number): Promise<void> {
    const token = await this.getAuthToken();
    const res = await fetch(
      `${this.baseUrl}/api/acceptance/subscription-plans/${planId}/suspend`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`stopPlan failed: ${res.status}`);
  }

  async resumePlan(planId: number): Promise<void> {
    const token = await this.getAuthToken();
    const res = await fetch(
      `${this.baseUrl}/api/acceptance/subscription-plans/${planId}/resume`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`resumePlan failed: ${res.status}`);
  }

  async getSubscriptionsByPlan(planId: number) {
    const token = await this.getAuthToken();
    const res = await fetch(
      `${this.baseUrl}/api/acceptance/subscriptions?plan_id=${planId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await res.json();
    if (!res.ok)
      throw new Error(`getSubscriptionsByPlan failed: ${JSON.stringify(data)}`);
    return data as {
      next: string | null;
      previous: string | null;
      results: Array<{
        id: number; // subscription ID
        state: string;
        amount_cents: number;
        starts_at: string;
        next_billing: string;
        ends_at: string | null;
        plan_id: number;
        integration: number;
        initial_transaction: number;
        client_info: {
          full_name: string;
          email: string;
          phone_number: string;
        };
      }>;
    };
  }
  // ─────────────────────────────────────────────────────────────────────────
  // Subscription enrollment  (same Intention API, just adds subscription_plan_id)
  // ─────────────────────────────────────────────────────────────────────────

  async enrollSubscription(
    request: PaymentRequest,
    planId: number,
    startDate?: string, // YYYY-MM-DD, optional — omit to start immediately
  ): Promise<PaymentResult | null> {
      return this.createIntention(request, planId, startDate);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Subscription management  (auth: Bearer token from API key)
  // ─────────────────────────────────────────────────────────────────────────

  async getSubscription(subscriptionId: number) {
    const token = await this.getAuthToken();
    const res = await fetch(
      `${this.baseUrl}/api/acceptance/subscriptions/${subscriptionId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await res.json();
    if (!res.ok)
      throw new Error(`getSubscription failed: ${JSON.stringify(data)}`);
    return data as {
      id: number;
      state: string;
      amount_cents: number;
      next_billing: string;
      starts_at: string;
      ends_at: string | null;
      plan_id: number;
    };
  }

  async stopSubscription(subscriptionId: number): Promise<void> {
    const token = await this.getAuthToken();
        console.log(`${this.baseUrl}/api/acceptance/subscriptions/${subscriptionId}/suspend`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } })
    const res = await fetch(
      
      `${this.baseUrl}/api/acceptance/subscriptions/${subscriptionId}/suspend`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );

    if (!res.ok) throw new Error(`stopSubscription failed: ${res.status}`);
  }

  async resumeSubscription(subscriptionId: number): Promise<void> {
    const token = await this.getAuthToken();
    const res = await fetch(
      `${this.baseUrl}/api/acceptance/subscriptions/${subscriptionId}/resume`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`resumeSubscription failed: ${res.status}`);
  }

  async cancelSubscription(subscriptionId: number): Promise<void> {
    const token = await this.getAuthToken();
    const res = await fetch(
      `${this.baseUrl}/api/acceptance/subscriptions/${subscriptionId}/cancel`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`cancelSubscription failed: ${res.status}`);
  }

  async updateSubscription(
    subscriptionId: number,
    updates: { amountCents?: number; endsAt?: string },
  ): Promise<void> {
    const token = await this.getAuthToken();
    const res = await fetch(
      `${this.baseUrl}/api/acceptance/subscriptions/${subscriptionId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...(updates.amountCents && { amount_cents: updates.amountCents }),
          ...(updates.endsAt && { ends_at: updates.endsAt }),
        }),
      },
    );
    if (!res.ok) throw new Error(`updateSubscription failed: ${res.status}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Shared private helpers
  // ─────────────────────────────────────────────────────────────────────────

  // Single Intention builder — used by both createPayment and enrollSubscription
  private async createIntention(
    request: PaymentRequest,
    planId: number | null,
    startDate?: string,
  ): Promise<PaymentResult | null> {
    try {
      const [firstName, ...rest] = request.customerName.split(" ");

      const res = await fetch(`${this.baseUrl}/v1/intention/`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          amount: Math.round(request.amount * 100),
          currency: request.currency ?? "EGP",
          payment_methods: JSON.parse(this.config.integrationId),
          // subscription fields — only included when planId is provided
          ...(planId && { subscription_plan_id: planId }),
          ...(planId && startDate && { subscription_start_date: startDate }),
          items: request.items?.map((i) => ({
            name: i.name,
            amount: Math.round(i.price * 100),
            quantity: i.quantity,
          })) ?? [
            {
              name: "Order",
              amount: Math.round(request.amount * 100),
              quantity: 1,
            },
          ],
          billing_data: {
            first_name: firstName,
            last_name: rest.join(" ") || "NA",
            email: request.customerEmail,
            phone_number: request.customerPhone,
            apartment: "NA",
            floor: "NA",
            street: "NA",
            building: request.address,
            city: request.city,
            country: "EGP",
            state: request.state,
            postal_code: "NA",
          },
          special_reference: request.specialReference,
          ...(request.successUrl && { redirection_url: request.successUrl }),
          ...(request.notificationUrl && {
            notification_url: request.notificationUrl,
          }),
        }),
      });
      
      const data = (await res.json()) as paymobCreateOrderRessponce;
      if (!res.ok)
        throw new Error(`createIntention failed: ${JSON.stringify(data)}`);

      return {
        transactionId: data.id,
        paymentUrl: `${this.baseUrl}/api/acceptance/iframes/${this.config.iframeId}?payment_token=${data.payment_keys[0].key}`,
        clientSecret: data.client_secret,
        status: PaymentStatus.Pending,
        raw: data as unknown as Record<string, unknown>,
      };
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Token ${this.config.secretKey}`,
    };
  }

  private async getAuthToken(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/auth/tokens`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ api_key: this.config.apiKey }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[Paymob getAuthToken] Non-OK response:', res.status, text);
      throw new Error(`getAuthToken failed: ${res.status} — ${text}`);
    }

    const data = (await res.json()) as { token: string };
    return data.token;
  }
}
