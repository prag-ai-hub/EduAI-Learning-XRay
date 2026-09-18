/**
 * Opening Razorpay's checkout for an order the backend already created.
 *
 * Web only, for now, and deliberately so. Razorpay's browser checkout is a
 * script from their CDN that draws its own payment sheet. The native
 * equivalent is `react-native-razorpay`, a native module: adding it means
 * leaving Expo Go for development builds on every developer's phone, which is a
 * product decision rather than something to slip in with a screen. Until that
 * decision is made, a device says plainly that billing is completed on the web
 * rather than half-working.
 *
 * What this module never does is decide that a payment succeeded. Razorpay's
 * `handler` firing means the customer finished the sheet; it does not mean the
 * money is captured. The backend learns that from the signed webhook, and the
 * screen waits for it. See `@/features/billing/api/billingApi`.
 */

import { Platform } from 'react-native';

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

type RazorpayOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill?: { name?: string; email?: string };
  theme?: { color?: string };
  handler: () => void;
  modal: { ondismiss: () => void };
};

type RazorpayInstance = {
  open: () => void;
  on: (event: 'payment.failed', callback: (response: { error?: { description?: string } }) => void) => void;
};

type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance;

export function checkoutSupported(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined';
}

let loading: Promise<RazorpayConstructor> | null = null;

/** Loads the checkout script once, however many times checkout is opened. */
function loadCheckout(): Promise<RazorpayConstructor> {
  const existing = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
  if (existing) return Promise.resolve(existing);
  if (loading) return loading;

  loading = new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      const loaded = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
      if (loaded) resolve(loaded);
      else reject(new Error('The payment window could not be loaded.'));
    };
    script.onerror = () => {
      // Forget the failure, so the next attempt tries again instead of
      // replaying a rejection from a network blip.
      loading = null;
      script.remove();
      reject(new Error('The payment window could not be loaded. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export type CheckoutOutcome = 'completed' | 'dismissed';

/**
 * Open the payment sheet and settle when the customer leaves it.
 *
 * `completed` means they finished the sheet - not that money moved. A card
 * decline inside the sheet is reported through `onFailure` while the sheet
 * stays open for another attempt, which is how Razorpay behaves.
 */
export async function openCheckout(input: {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  description: string;
  prefill?: { name?: string; email?: string };
  themeColor?: string;
  onFailure?: (message: string) => void;
}): Promise<CheckoutOutcome> {
  if (!checkoutSupported()) throw new Error('Payments are completed in the web app.');
  const Razorpay = await loadCheckout();

  return new Promise<CheckoutOutcome>((resolve) => {
    const sheet = new Razorpay({
      key: input.keyId,
      order_id: input.orderId,
      amount: input.amountPaise,
      currency: input.currency,
      name: 'EduAI Learning X-Ray',
      description: input.description,
      prefill: input.prefill,
      theme: input.themeColor ? { color: input.themeColor } : undefined,
      handler: () => resolve('completed'),
      modal: { ondismiss: () => resolve('dismissed') },
    });
    sheet.on('payment.failed', (response) => {
      input.onFailure?.(response.error?.description || 'The payment was declined.');
    });
    sheet.open();
  });
}
