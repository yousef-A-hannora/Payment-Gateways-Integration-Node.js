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

  private readonly baseUrl = "https://accept.paymob.com";
  private readonly secretKey: string;
  private readonly apiKey: string;
  private readonly integrationId: string;
  private readonly iframeId: string;

  constructor(config: {
    API_Key: string;
    secretKey: string;
    publicKey: string;
    integrationId: string;
    iframeId: string;
  }) {
    this.apiKey = config.API_Key
    this.secretKey = config.secretKey;
    this.integrationId = config.integrationId;
    this.iframeId = config.iframeId;
  }

  // ── Public interface ──────────────────────────────────────────────────────

  async createPayment(request: PaymentRequest): Promise<PaymentResult | null> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/intention/`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          amount: Math.round(request.amount * 100), // convert to cents
          currency: request.currency ?? "EGP",
          payment_methods: JSON.parse(this.integrationId),
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
          billing_data: this.mapBillingData(request),
          special_reference: request.specialReference,
          ...(request.successUrl && { redirection_url: request.successUrl }),
          ...(request.notificationUrl && {
            notification_url: request.notificationUrl,
          }),
        }),
      });

      const data = (await res.json()) as paymobCreateOrderRessponce;
      if (!res.ok) {
        throw new Error(`Paymob createPayment failed: ${JSON.stringify(data)}`);
      }

      return {
        transactionId: data.id,
        // iFrame URL — embed in your page
        paymentUrl: `${this.baseUrl}/api/acceptance/iframes/${this.iframeId}?payment_token=${data.payment_keys[0].key}`,
        clientSecret: data.client_secret,
        status: PaymentStatus.Pending,
        raw: data as unknown as Record<string, unknown>,
      };
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  async getPaymentStatus(transactionId: string): Promise<PaymentStatus> {
    try {
      // transactionId here is the numeric transaction ID from the webhook (obj.id)
      const token = await this.getLegacyAuthToken();
      const res = await fetch(
        `${this.baseUrl}/api/acceptance/transactions/${transactionId}?token=${token}`,
      );
      const data = (await res.json()) as PaymobTransactionResponse;

      if (!res.ok) {
        throw new Error(
          `Paymob getPaymentStatus failed: ${JSON.stringify(data)}`,
        );
      }

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
      // Refund uses the legacy endpoint but same secret key in Authorization header
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

      if (!res.ok) {
        throw new Error(`Paymob refund failed: ${JSON.stringify(data)}`);
      }

      return data.success === true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Token ${this.secretKey}`,
    };
  }

  private mapBillingData(request: PaymentRequest) {
    const [firstName, ...rest] = request.customerName.split(" ");
    return {
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
    };
  }

  // Needed only for getPaymentStatus (transaction lookup uses legacy auth)
  private async getLegacyAuthToken(): Promise<string | null> {
    var requestOptions = {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ api_key: this.apiKey }),
    };

    const res = await fetch(
      "https://accept.paymob.com/api/auth/tokens",
      requestOptions,
    );
    const data = (await res.json()) as { profile: any; token: string };
    if (data) return JSON.stringify(data.token);
    return null;
  }
}
