/**
 * The billing slice's network surface - the Django billing API, typed.
 *
 * The one thing worth knowing before reading a call below: **no call in this
 * file can move money into a settled state.** Checkout creates a gateway order
 * and nothing else. A payment becomes `captured` only when Razorpay's webhook
 * arrives at the backend with a valid HMAC signature, and a subscription starts
 * only from that capture. So the client never tells the server a payment
 * succeeded - it asks, and waits (`paymentById`). A client that could say "paid"
 * would be a client that could lie.
 *
 * Money is integer paise end to end. `formatRupees` is the only place it
 * becomes a decimal, and only for display.
 */

import { api, type Paginated } from '@/shared/api/django';

export type BillingPeriod = 'monthly' | 'quarterly' | 'annual' | 'one_time';

export type Plan = {
  id: string;
  code: string;
  name: string;
  description: string;
  audience: 'school' | 'parent';
  billing_period: BillingPeriod;
  amount_paise: number;
  currency: string;
  credits_included: number;
  max_teachers: number | null;
  max_students: number | null;
  features: Record<string, unknown>;
  sort_order: number;
};

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'grace'
  | 'cancelled'
  | 'expired';

export type Subscription = {
  id: string;
  plan: Plan;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  grace_until: string | null;
  cancel_at_period_end: boolean;
  started_at: string | null;
  cancelled_at: string | null;
  ended_at: string | null;
};

/**
 * Whether the subscription currently permits anything. Different from the
 * subscription's status: a `past_due` subscription past its grace window is
 * still a subscription and no longer an entitlement.
 */
export type Entitlement = {
  has_entitlement: boolean;
  status: string;
  plan_code: string | null;
  plan_name: string | null;
  features: Record<string, unknown>;
  credits_included: number;
  period_end: string | null;
  grace_until: string | null;
};

export type PaymentStatus =
  | 'created'
  | 'authorized'
  | 'captured'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export type Payment = {
  id: string;
  purpose: string;
  status: PaymentStatus;
  plan_code: string | null;
  plan_name: string | null;
  amount_paise: number;
  tax_paise: number;
  total_paise: number;
  currency: string;
  failure_reason?: string | null;
  captured_at: string | null;
};

/**
 * Who the invoice is made out to. `place_of_supply` is the two-digit GST state
 * code, and it is what decides CGST+SGST against IGST - it is the buyer's
 * declaration, so it is asked for rather than guessed from a city.
 */
export type BillingDetails = {
  billing_name: string;
  gstin?: string;
  place_of_supply: string;
  billing_address?: Record<string, string>;
};

export type Checkout = {
  payment_id: string;
  gateway: string;
  /** Razorpay's publishable key id. Identifies the merchant; authorises nothing. */
  gateway_key_id: string;
  order_id: string;
  amount_paise: number;
  tax_paise: number;
  total_paise: number;
  currency: string;
  purpose: string;
  plan: Plan;
  change: string;
  /** True when this is the same order as a moment ago, not a second one. */
  reused: boolean;
};

export function listPlans() {
  return api.get<Paginated<Plan>>('/api/v1/billing/plans/');
}

export function schoolSubscription() {
  return api.get<{
    school_id: string;
    subscription: Subscription | null;
    entitlement: Entitlement;
  }>('/api/v1/billing/subscription');
}

/**
 * Create - or, within the reuse window, return - the gateway order for a plan.
 *
 * `idempotency_key` is the strongest form of the double-click guarantee: the
 * same key returns the first answer rather than a second order. The screen
 * mints one per attempt, so a retry after a dropped response is not a new
 * charge waiting to happen.
 */
export function startSubscriptionCheckout(input: {
  plan_code: string;
  billing: BillingDetails;
  idempotency_key: string;
}) {
  return api.post<Checkout>('/api/v1/billing/checkout/subscription', input);
}

/** Stop renewing at the end of the current period. There is no immediate cancel. */
export function cancelAtPeriodEnd() {
  return api.post<Subscription>('/api/v1/billing/subscription/cancel');
}

export function paymentById(id: string) {
  return api.get<Payment>(`/api/v1/billing/payments/${encodeURIComponent(id)}/`);
}

/** 150000 -> "₹1,500". Paise are integers; a remainder is shown, never rounded away. */
export function formatRupees(paise: number, currency = 'INR'): string {
  const rupees = paise / 100;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    }).format(rupees);
  } catch {
    return `${currency} ${rupees.toFixed(2)}`;
  }
}

export const PERIOD_LABEL: Record<BillingPeriod, string> = {
  monthly: 'per month',
  quarterly: 'per quarter',
  annual: 'per year',
  one_time: 'one time',
};
