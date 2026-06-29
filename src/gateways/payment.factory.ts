import { IPaymentGateway } from '../types/payment';
import { PaymobGateway }   from './paymob.gateway';
import { StripeGateway }   from './stripe.gateway';

// ─────────────────────────────────────────────────────────────────────────────
// Factory — swap providers via PAYMENT_PROVIDER env var, zero code changes
// ─────────────────────────────────────────────────────────────────────────────

type Provider = 'paymob' | 'stripe';

export function createPaymentGateway(provider?: Provider): IPaymentGateway {
  const active = (provider ?? process.env.PAYMENT_PROVIDER ?? 'paymob') as Provider;

  switch (active) {
    case 'paymob':
      return new PaymobGateway({
        myURL:      requiredEnv('API_BASE_URL'),
        apiKey:       requiredEnv('PAYMOB_API_KEY'),
        secretKey:     requiredEnv('PAYMOB_SECRET_KEY'),
        publicKey:     requiredEnv('PAYMOB_PUBLIC_KEY'),
        integrationId: requiredEnv('PAYMOB_INTEGRATION_ID'),
        iframeId:      requiredEnv('PAYMOB_IFRAME_ID'),
      });

    case 'stripe':
      return new StripeGateway({
        secretKey: requiredEnv('STRIPE_SECRET_KEY'),
      });

    default:
      throw new Error(`Unknown payment provider: "${active}". Supported: paymob, stripe`);
  }
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}
