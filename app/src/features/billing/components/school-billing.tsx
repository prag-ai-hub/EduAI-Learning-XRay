/**
 * Billing - a school administrator's plan, and the way to change it.
 *
 * Plan row 14.1, "B2B checkout UI". New; the web app never had a billing
 * screen. It is a module of the SchoolAdmin workspace rather than a route of
 * its own, because subscribing is something an administrator does from inside
 * the school they administer.
 *
 * ---------------------------------------------------------------------------
 * THE FLOW, AND WHY THE LAST STEP IS WAITING
 * ---------------------------------------------------------------------------
 *   choose a plan -> invoice details -> review the total -> pay -> confirmation
 *
 * 1. **Invoice details come before any order exists.** An invoice has to show
 *    the buyer as they stood at the sale, and `place_of_supply` decides whether
 *    GST is charged as CGST+SGST or as IGST, so the server needs them to price
 *    the order at all.
 * 2. **The total, tax included, is shown before the payment sheet opens.** The
 *    order is created at step 2 so the figure on screen is the server's, not
 *    arithmetic done here. Reopening the review does not create a second order:
 *    each attempt carries one idempotency key, and the server returns the first
 *    answer for it.
 * 3. **Finishing the payment sheet is not success.** Razorpay calls back when
 *    the customer completes the sheet; money is settled when Razorpay's signed
 *    webhook reaches the backend, and only the webhook can mark a payment
 *    captured or start a subscription. So this screen polls the payment until
 *    the server says captured or failed, and if the webhook is slow it says so
 *    and offers to check again - it never shows "Subscribed" on the strength of
 *    a browser callback.
 *
 * Nothing here is prorated, and the copy does not imply it: an upgrade starts a
 * new period from capture (plan row 13.1). There is no immediate cancellation
 * either - cancelling stops the renewal at the end of the period already paid
 * for.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * The payment sheet is web-only; see `@/features/billing/lib/razorpay` for why
 * a device says so instead of opening a native module this app does not ship.
 * Everything before the sheet - plans, details, the priced order - works on
 * every platform, so a device can still see exactly what it would pay.
 */

import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import {
  PERIOD_LABEL,
  cancelAtPeriodEnd,
  formatRupees,
  listPlans,
  paymentById,
  schoolSubscription,
  startSubscriptionCheckout,
  type Checkout,
  type Entitlement,
  type Plan,
  type Subscription,
  type SubscriptionStatus,
} from '@/features/billing/api/billingApi';
import { checkoutSupported, openCheckout } from '@/features/billing/lib/razorpay';
import { ApiError } from '@/shared/api/django';
import { AppButton, ButtonRow } from '@/shared/components/buttons';
import {
  Field,
  Form,
  FormError,
  FormGrid,
  Select,
  SubmitButton,
  useFormContext,
  type FormValues,
} from '@/shared/components/form';
import { ConfirmDialog, ModalShell } from '@/shared/components/modal';
import { Card, CardHead, CardSpan2, PageHead } from '@/shared/components/primitives';
import { EmptyState, StatusPill, type StatusTone } from '@/shared/components/status';
import { useAppPalette, useAppStyles } from '@/shared/theme/styles';
import type { W } from '@/shared/types/workspace';

/** How often, and for how long, to ask whether the webhook has arrived. */
const POLL_EVERY_MS = 3000;
const POLL_ATTEMPTS = 20;

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/;

/**
 * GST state codes as GSTN publishes them, for codes in current use. 25 (Daman
 * & Diu) merged into 26 in 2020 and 28 is Andhra Pradesh before 2014, so
 * neither is offered for a new invoice. The server accepts any two digits; it
 * does not need this list, a person choosing does.
 */
const GST_STATES: readonly { label: string; value: string }[] = [
  ['01', 'Jammu and Kashmir'],
  ['02', 'Himachal Pradesh'],
  ['03', 'Punjab'],
  ['04', 'Chandigarh'],
  ['05', 'Uttarakhand'],
  ['06', 'Haryana'],
  ['07', 'Delhi'],
  ['08', 'Rajasthan'],
  ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'],
  ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'],
  ['13', 'Nagaland'],
  ['14', 'Manipur'],
  ['15', 'Mizoram'],
  ['16', 'Tripura'],
  ['17', 'Meghalaya'],
  ['18', 'Assam'],
  ['19', 'West Bengal'],
  ['20', 'Jharkhand'],
  ['21', 'Odisha'],
  ['22', 'Chhattisgarh'],
  ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'],
  ['26', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['27', 'Maharashtra'],
  ['29', 'Karnataka'],
  ['30', 'Goa'],
  ['31', 'Lakshadweep'],
  ['32', 'Kerala'],
  ['33', 'Tamil Nadu'],
  ['34', 'Puducherry'],
  ['35', 'Andaman and Nicobar Islands'],
  ['36', 'Telangana'],
  ['37', 'Andhra Pradesh'],
  ['38', 'Ladakh'],
  ['97', 'Other Territory'],
].map(([value, name]) => ({ value, label: `${value} · ${name}` }));

const STATUS_COPY: Record<SubscriptionStatus, { label: string; tone: StatusTone }> = {
  trialing: { label: 'Trial', tone: 'neutral' },
  active: { label: 'Active', tone: 'success' },
  past_due: { label: 'Payment due', tone: 'warning' },
  grace: { label: 'Grace period', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'red' },
};

/** "2026-10-15T..." -> "15 Oct 2026". */
function formatDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * One key per attempt. Printable, under the server's 64-character limit, and
 * unique enough that two administrators of one school cannot collide - which
 * would return one of them the other's order.
 */
function newAttemptKey(planCode: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `web-${planCode}-${Date.now().toString(36)}-${random}`.slice(0, 64);
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback;
}

type Attempt = {
  plan: Plan;
  key: string;
  checkout: Checkout | null;
};

type Phase = 'browse' | 'details' | 'review' | 'waiting';

export function SchoolBilling({ notify }: W<'notify'>) {
  const s = useAppStyles();
  const palette = useAppPalette();

  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);

  const [phase, setPhase] = useState<Phase>('browse');
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  /** The poll must stop when the administrator leaves the module. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const [catalogue, mine] = await Promise.all([listPlans(), schoolSubscription()]);
        if (!current) return;
        setPlans(catalogue.results);
        setSubscription(mine.subscription);
        setEntitlement(mine.entitlement);
        setLoadError('');
      } catch (cause) {
        if (current) setLoadError(messageOf(cause, 'Billing could not be loaded right now.'));
      }
    })();
    return () => {
      current = false;
    };
  }, [reload]);

  const reset = () => {
    setPhase('browse');
    setAttempt(null);
    setMessage('');
    setNotice('');
  };

  const choose = (plan: Plan) => {
    setMessage('');
    setNotice('');
    setAttempt({ plan, key: newAttemptKey(plan.code), checkout: null });
    setPhase('details');
  };

  const submitDetails = async (values: FormValues) => {
    if (!attempt) return;
    setMessage('');
    const gstin = values.trimmed('gstin').toUpperCase();
    const place = values.get('place_of_supply');
    // The server refuses this too. Said here first because it is the one
    // mistake a person makes most - a GSTIN from the head office in another
    // state - and it reads better beside the field than after a round trip.
    if (gstin && gstin.slice(0, 2) !== place) {
      setMessage(
        `This GSTIN is registered in state ${gstin.slice(0, 2)}. Choose that state, or leave the GSTIN blank.`,
      );
      return;
    }
    const address: Record<string, string> = {};
    for (const key of ['line1', 'city', 'pincode'] as const) {
      const value = values.trimmed(key);
      if (value) address[key] = value;
    }
    try {
      const checkout = await startSubscriptionCheckout({
        plan_code: attempt.plan.code,
        idempotency_key: attempt.key,
        billing: {
          billing_name: values.trimmed('billing_name'),
          place_of_supply: place,
          ...(gstin ? { gstin } : {}),
          ...(Object.keys(address).length ? { billing_address: address } : {}),
        },
      });
      setAttempt({ ...attempt, checkout });
      setPhase('review');
    } catch (cause) {
      setMessage(messageOf(cause, 'The order could not be created. No money has moved.'));
    }
  };

  /** Ask the server, not the browser, whether the payment settled. */
  const awaitCapture = async (paymentId: string) => {
    setPhase('waiting');
    setNotice('Confirming your payment with the gateway…');
    for (let attemptNo = 0; attemptNo < POLL_ATTEMPTS; attemptNo += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_EVERY_MS));
      if (!alive.current) return;
      try {
        const payment = await paymentById(paymentId);
        if (!alive.current) return;
        if (payment.status === 'captured') {
          notify(`Payment received. ${payment.plan_name ?? 'Your plan'} is now active.`);
          reset();
          setReload((n) => n + 1);
          return;
        }
        if (payment.status === 'failed') {
          setPhase('review');
          setNotice('');
          setMessage(
            payment.failure_reason || 'The payment did not go through. No money has moved.',
          );
          return;
        }
      } catch {
        // A dropped poll is not an answer. Keep asking until the window closes.
      }
    }
    if (!alive.current) return;
    setNotice(
      'The gateway has your payment, but its confirmation has not reached us yet. That usually takes under a minute - your plan updates as soon as it does.',
    );
  };

  const pay = async () => {
    const checkout = attempt?.checkout;
    if (!checkout) return;
    setMessage('');
    if (!checkoutSupported()) {
      setMessage('Payments are completed in the web app. Open Learning X-Ray in a browser to pay.');
      return;
    }
    setBusy(true);
    try {
      const outcome = await openCheckout({
        keyId: checkout.gateway_key_id,
        orderId: checkout.order_id,
        amountPaise: checkout.total_paise,
        currency: checkout.currency,
        description: `${checkout.plan.name} · ${PERIOD_LABEL[checkout.plan.billing_period]}`,
        themeColor: palette.navy,
        onFailure: (reason) => {
          if (alive.current) setMessage(reason);
        },
      });
      if (!alive.current) return;
      if (outcome === 'completed') await awaitCapture(checkout.payment_id);
    } catch (cause) {
      if (alive.current)
        setMessage(
          cause instanceof Error ? cause.message : 'The payment window could not be opened.',
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const checkAgain = async () => {
    const paymentId = attempt?.checkout?.payment_id;
    if (!paymentId) return;
    await awaitCapture(paymentId);
  };

  const cancel = async () => {
    setConfirmCancel(false);
    try {
      const updated = await cancelAtPeriodEnd();
      setSubscription(updated);
      notify(
        `Renewal stopped. Your plan stays active until ${formatDate(updated.current_period_end)}.`,
      );
    } catch (cause) {
      notify(messageOf(cause, 'The renewal could not be stopped. Please try again.'), 'error');
    }
  };

  const head = (
    <PageHead
      eyebrow="Billing"
      title="Your school's plan"
      subtitle="Choose a plan, pay securely, and download GST invoices. Nothing is charged until you confirm the total."
    />
  );

  if (loadError)
    return (
      <>
        {head}
        <Card>
          <EmptyState title="Billing is unavailable" body={loadError}>
            <ButtonRow>
              <AppButton title="Try again" onPress={() => setReload((n) => n + 1)} />
            </ButtonRow>
          </EmptyState>
        </Card>
      </>
    );

  if (!plans)
    return (
      <>
        {head}
        <Card>
          <Text style={s.cardBody}>Loading your plan…</Text>
        </Card>
      </>
    );

  const currentCode = subscription?.plan.code ?? null;
  const status = subscription ? STATUS_COPY[subscription.status] : null;

  return (
    <>
      {head}

      {/* One grid for the whole page, as the teacher home uses: the 18px gap
          between cards comes from `dashboardGrid`, so no card carries its own
          margin and a card that appears or disappears never leaves a seam. */}
      <View style={s.dashboardGrid}>
        <CardSpan2>
          <CardHead eyebrow="Current plan" title={subscription?.plan.name ?? 'No plan yet'}>
            {status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
          </CardHead>
          {subscription ? (
            <View style={s.listItemBody}>
              <Text style={s.cardBody}>
                {formatRupees(subscription.plan.amount_paise, subscription.plan.currency)}{' '}
                {PERIOD_LABEL[subscription.plan.billing_period]} ·{' '}
                {subscription.plan.credits_included} analysis credits
              </Text>
              {subscription.current_period_end ? (
                <Text style={s.metricCaption}>
                  {subscription.cancel_at_period_end
                    ? `Renewal stopped. Active until ${formatDate(subscription.current_period_end)}.`
                    : `Current period ends ${formatDate(subscription.current_period_end)}.`}
                </Text>
              ) : null}
              {subscription.grace_until && entitlement?.has_entitlement ? (
                <Text style={s.metricCaption}>
                  Payment is overdue. Access continues until {formatDate(subscription.grace_until)}.
                </Text>
              ) : null}
              {entitlement && !entitlement.has_entitlement ? (
                <Text style={s.formErrorText}>
                  This plan no longer permits new work. Renew or choose a plan below - everything
                  already done stays readable.
                </Text>
              ) : null}
              {subscription.status === 'active' && !subscription.cancel_at_period_end ? (
                <ButtonRow>
                  <AppButton
                    variant="link"
                    title="Stop renewal"
                    onPress={() => setConfirmCancel(true)}
                  />
                </ButtonRow>
              ) : null}
            </View>
          ) : (
            <Text style={s.cardBody}>
              Your school is not on a paid plan. Choose one below to start grading with your staff.
            </Text>
          )}
        </CardSpan2>

        {phase === 'browse' ? (
          !plans.length ? (
            <CardSpan2>
              <EmptyState
                title="No plans are on sale yet"
                body="Pricing is being finalised. Your current access is unaffected - check back soon."
              />
            </CardSpan2>
          ) : (
            plans.map((plan) => {
              const current = plan.code === currentCode;
              return (
                <View key={plan.id} style={s.dashboardTrack}>
                  <Card selected={current}>
                    <CardHead eyebrow={PERIOD_LABEL[plan.billing_period]} title={plan.name}>
                      {current ? <StatusPill tone="success">Current</StatusPill> : null}
                    </CardHead>
                    <View style={s.listItemBody}>
                      <Text style={s.metricValue}>
                        {formatRupees(plan.amount_paise, plan.currency)}
                      </Text>
                      <Text style={s.metricCaption}>
                        plus GST · {PERIOD_LABEL[plan.billing_period]}
                      </Text>
                    </View>
                    <View style={[s.listItemBody, { marginTop: s.cardHead.marginBottom }]}>
                      {plan.description ? <Text style={s.cardBody}>{plan.description}</Text> : null}
                      <Text style={s.cardBody}>
                        {plan.credits_included} analysis credits
                        {plan.max_teachers ? ` · up to ${plan.max_teachers} teachers` : ''}
                        {plan.max_students ? ` · up to ${plan.max_students} students` : ''}
                      </Text>
                    </View>
                    <AppButton
                      full
                      variant={current ? 'secondary' : 'primary'}
                      title={
                        current
                          ? 'Renew this plan'
                          : currentCode
                            ? 'Switch to this plan'
                            : 'Choose plan'
                      }
                      onPress={() => choose(plan)}
                    />
                  </Card>
                </View>
              );
            })
          )
        ) : null}

        {phase === 'details' && attempt ? (
          <CardSpan2>
            <CardHead eyebrow="Step 1 of 2 · Invoice details" title={attempt.plan.name} />
            <Text style={s.cardBody}>
              These appear on your GST invoice exactly as entered, and cannot be changed after
              payment.
            </Text>
            <Form onSubmit={submitDetails}>
              <Field
                name="billing_name"
                label="Billed to (school or trust name)"
                required
                minLength={2}
                autoComplete="organization"
              />
              <FormGrid>
                <Select
                  name="place_of_supply"
                  label="State (place of supply)"
                  options={GST_STATES}
                  placeholder="Choose the state"
                  required
                  requiredMessage="Choose the state the school is registered in."
                />
                <Field
                  name="gstin"
                  label="GSTIN (optional)"
                  maxLength={15}
                  inputProps={{ autoCapitalize: 'characters', autoCorrect: false }}
                  validate={(value) =>
                    value.trim() && !GSTIN.test(value.trim().toUpperCase())
                      ? 'That is not a valid 15-character GSTIN.'
                      : null
                  }
                />
              </FormGrid>
              <Field name="line1" label="Address" autoComplete="street-address" />
              <FormGrid>
                <Field name="city" label="City" autoComplete="postal-address-locality" />
                <Field
                  name="pincode"
                  label="PIN code"
                  type="number"
                  maxLength={6}
                  autoComplete="postal-code"
                />
              </FormGrid>
              <FormError>{message}</FormError>
              <DetailsButton />
            </Form>
            <ButtonRow>
              <AppButton variant="link" title="Back to plans" onPress={reset} />
            </ButtonRow>
          </CardSpan2>
        ) : null}

        {(phase === 'review' || phase === 'waiting') && attempt?.checkout ? (
          <CardSpan2>
            <CardHead eyebrow="Step 2 of 2 · Review and pay" title={attempt.checkout.plan.name} />
            <View style={s.listItemBody}>
              <Text style={s.cardBody}>
                Plan: {formatRupees(attempt.checkout.amount_paise, attempt.checkout.currency)}
              </Text>
              <Text style={s.cardBody}>
                GST: {formatRupees(attempt.checkout.tax_paise, attempt.checkout.currency)}
              </Text>
              <Text style={s.metricValue}>
                {formatRupees(attempt.checkout.total_paise, attempt.checkout.currency)}
              </Text>
              <Text style={s.metricCaption}>
                Total payable today. The new period starts when the payment is confirmed; nothing is
                prorated.
              </Text>
            </View>
            {notice ? (
              <View role="status" style={s.insight}>
                <Text style={s.insightText}>{notice}</Text>
              </View>
            ) : null}
            <FormError>{message}</FormError>
            <ButtonRow>
              {phase === 'review' ? (
                <AppButton
                  variant="primary"
                  title={
                    busy
                      ? 'Opening payment…'
                      : `Pay ${formatRupees(attempt.checkout.total_paise, attempt.checkout.currency)}`
                  }
                  disabled={busy}
                  onPress={() => void pay()}
                />
              ) : (
                <AppButton title="Check again" onPress={() => void checkAgain()} />
              )}
              <AppButton variant="link" title="Cancel" onPress={reset} disabled={busy} />
            </ButtonRow>
          </CardSpan2>
        ) : null}
      </View>

      {confirmCancel && subscription ? (
        <ModalShell label="Stop renewal" onClose={() => setConfirmCancel(false)}>
          <ConfirmDialog
            eyebrow="Billing"
            title="Stop renewing this plan?"
            text={`${subscription.plan.name} stays active until ${formatDate(subscription.current_period_end) || 'the end of the current period'}, and then ends. Work already done stays readable. There is no refund for the period already paid for.`}
            action="Stop renewal"
            onConfirm={() => void cancel()}
          />
        </ModalShell>
      ) : null}
    </>
  );
}

/** The label changes while the order is being created; see `useFormContext`. */
function DetailsButton() {
  const form = useFormContext();
  return <SubmitButton title={form.submitting ? 'Pricing your order…' : 'Continue to review'} />;
}
