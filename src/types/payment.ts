// ─────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export enum PaymentStatus {
  Pending  = 'pending',
  Paid     = 'paid',
  Failed   = 'failed',
  Refunded = 'refunded',
}

export interface PaymentItem {
  name:     string;
  price:    number;  // in EGP/USD (e.g. 50.00)
  quantity: number;
}

export type paymobCreateOrderRessponce = {
  payment_keys: {
    integration: number;
    key: string;
    gateway_type: string;
    iframe_id: number | null;
    order_id: number;
  }[];
  intention_order_id: number;
  id: string;
  intention_detail: {
    amount: number;
    items: {
      name: string;
      amount: number;
      description: string;
      quantity: number;
      image: string | null;
    }[];
    currency: string;
    billing_data: {
      apartment: string;
      floor: string;
      first_name: string;
      last_name: string;
      street: string;
      building: string;
      phone_number: string;
      shipping_method: string;
      city: string;
      country: string;
      state: string;
      email: string;
      postal_code: string;
    };
  };
  client_secret: string;
  payment_methods: {
    integration_id: number;
    alias: string | null;
    name: string;
    method_type: string;
    currency: string;
    live: boolean;
    use_cvc_with_moto: boolean;
  }[];
  special_reference: string;
  extras: {
    creation_extras: {
      ee: number;
    };
    confirmation_extras: null;
  };
  confirmed: boolean;
  status: string;
  created: string;
  card_detail: null;
  card_tokens: unknown[];
  object: string;
};

export interface PaymentRequest {
  amount:          number;       // in major currency unit (e.g. 50.00 EGP)
  currency?:       string;       // default: 'EGP' for Paymob, 'USD' for Stripe
  customerName:    string;
  customerEmail:   string;
  customerPhone:   string;
  successUrl?:     string;
  failUrl?:        string;
  pendingUrl?:     string;
  notificationUrl?: string;      // webhook per-payment (Paymob)
  specialReference?: string;     // your internal order/reference ID
  items?:          PaymentItem[];
  state: string;
  city:string;
  address:string;
}

export interface PaymentResult {
  transactionId: string;         // stable ID to use for status & refunds
  paymentUrl:    string;         // redirect or embed URL
  clientSecret?: string;         // Stripe: for frontend SDK / Paymob: client_secret
  status:        PaymentStatus;
  raw?:          Record<string, unknown>; // full provider response (useful for debugging)
}

export interface IPaymentGateway {
  /** Whether this provider supports API-initiated refunds */
  readonly supportsRefund: boolean;

  createPayment(request: PaymentRequest):        Promise<PaymentResult|null>;
  getPaymentStatus(transactionId: string):       Promise<PaymentStatus|null>;
  refund(transactionId: string, amount: number): Promise<boolean>;
}
