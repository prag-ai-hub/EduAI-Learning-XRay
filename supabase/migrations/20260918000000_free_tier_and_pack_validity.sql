-- M20 — a plan may cost nothing, and a pack says when its capacity lapses
--
-- The pricing table supplied on 2026-09-18 has a free tier ("X-Ray Free", up to
-- 30 students, one assessment) and three paid packs sold in two service levels.
-- Two things in the schema were written when every plan was a paid subscription
-- and now say otherwise.
--
-- 1. `plans_amount_paise_check` required `amount_paise > 0`, so the free tier
--    could not exist as a row at all. It has to be a row: the Billing page
--    lists it beside the paid packs, an entitlement resolves through it, and a
--    school on the free tier is a school on a plan rather than a school with no
--    plan, which is a different thing and reads differently everywhere.
--
--    Zero is now allowed and nothing else changes. A zero-amount plan is
--    GRANTED, never sold - `services.start_school_checkout` refuses one, because
--    an order for ₹0 at the gateway is an error, not a free trial.
--
-- 2. Packs expire. `subscriptions.current_period_end` already carries the date;
--    what was missing is the statement that for a one-off purchase that date is
--    an expiry rather than a renewal boundary. `cancel_at_period_end` is how a
--    row says "this does not renew", so a pack is written with it set. That is
--    application behaviour, not a constraint - the comment below is the record,
--    since a future reader will otherwise see an annual-looking subscription.

alter table public.plans drop constraint if exists plans_amount_paise_check;
alter table public.plans
  add constraint plans_amount_paise_check check (amount_paise >= 0);

comment on column public.plans.amount_paise is
  'Price in paise, exclusive of GST. Zero means a granted tier (the free plan): it is activated without a payment and checkout refuses it, because a zero-value order at the gateway is an error.';

comment on column public.subscriptions.cancel_at_period_end is
  'True on a one-off pack, which never renews: current_period_end is the date its capacity lapses. False on a renewing subscription unless the school has cancelled.';
