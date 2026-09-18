# Pricing: the X-Ray packs

The catalogue is `backend/apps/billing/subscriptions/management/commands/seed_plans.py`
and the amounts in it are the owner's, from the pricing table supplied on
2026-09-18. `PRICING_CONFIRMED` is `True`, so the seeder will run against a
production environment without an override.

| Plan | Coverage | DIY | DFY | Credits |
| --- | --- | --- | --- | --- |
| X-Ray Free | 30 students, 1 assessment | free | free | 30 |
| X-Ray Single | 50 students, 1 assessment | ₹3,500 | ₹4,500 | 50 |
| X-Ray Multi | 50 students, 5 assessments | ₹17,500 | ₹22,500 | 250 |
| X-Ray Bulk | 500 students, 1 assessment | ₹30,000 | ₹40,000 | 500 |

All paid prices are **exclusive of GST**, which the checkout adds and the
invoice itemises. DIY and DFY are separate plan codes (`xray_single_diy`,
`xray_single_dfy`, …) because they are different prices for different work; both
are on sale.

## What these are, in the model

**Packs, not subscriptions.** Nothing renews. A school buys capacity once and
buys again when it runs out. The row in `subscriptions` is still how a school's
entitlement is resolved, and it carries `cancel_at_period_end = true`, which is
that table's way of saying "this does not renew".

**Capacity lasts 12 months** (`services.PACK_VALIDITY_MONTHS`).
`current_period_end` is the date the capacity lapses, not a renewal boundary.
Capacity bought two years ago should not be redeemable at two-year-old prices.

**A credit is one student's answer sheet analysed**, which is where the AI cost
is actually incurred — so a pack's `credits_included` is its coverage:
50 students × 1 assessment = 50 credits; 50 × 5 = 250; 500 × 1 = 500.

**Credits land on the school's first administrator.** They are metered per user
(`consume_credit(p_user_id, …)`, and `schools` has no balance column), so a
pack has to be credited to somebody; it goes to the account that registered the
school, which is the one holding "Assign credits" for handing capacity to
teachers. `payments` records the school and not the payer, so the buyer cannot
be recovered from the payment row — if the paying administrator should get the
balance instead, that needs a payer column, which is a migration.

**X-Ray Free is granted, never sold.** Approving a school puts it on the free
tier with no checkout: no order, no invoice, no GST — which is why it works
before the payment gateway exists. `start_school_checkout` refuses any
zero-amount plan, because an order for ₹0 at the gateway is an error rather than
a free trial. A school that already holds a paid pack keeps it, so re-approving
after a suspension never hands out a second free allowance.

## Applying a price change

**Never by editing an amount in place.** `seed_plans` refuses it once anyone
holds the plan, and the refusal is the point: a renewal prices itself from the
row, credits are granted from it, and the invoice PDF prints the plan's name.
The supported change is a new code beside an archived old one:

```python
{ "code": "xray_single_diy",    ..., "status": Plan.Status.ARCHIVED },
{ "code": "xray_single_diy_v2", ..., "amount_paise": 399_900 },
```

Archiving takes a plan off the pricing page and out of checkout while leaving it
resolvable for the history that points at it. `description`, `sort_order` and
`status` stay editable. `backend/apps/billing/subscriptions/tests/test_seed_plans.py`
is this section as tests.

## Still open

1. **Feature flags per tier.** `exports`, `advanced_reports` and
   `priority_support` are the product's own switches; the table's "Includes"
   column is prose. Only what the table states plainly is set: the school-wide
   insight view on Bulk, and priority support on the done-for-you tiers. Confirm
   the rest.
2. **What "done for you" commits your team to.** A DFY order is an ordinary
   order today: it activates the same capacity at a higher price and tells
   nobody to do any work. If it should raise a task or notify someone, say so.
3. **B2C parent pricing.** The table covers schools. The two parent top-up plans
   are **archived** rather than left on sale at invented prices; price them and
   set `Plan.Status.ACTIVE` when the B2C side is decided.
4. **The GST settings.** `GST_RATE_BPS`, `GST_SELLER_STATE_CODE`, `GST_SAC_CODE`
   and `GST_SELLER_GSTIN` in `backend/.env`. Until they are set, **every
   checkout returns 503** — zero is a legitimate tax rate for an exempt supply,
   so an unset rate cannot be read as zero and charged.
5. **Whether a pack stacks.** Buying a second pack while one is live currently
   extends the window and adds its credits. If a school should instead hold two
   separate expiries, that is a different model.

## What does not exist, deliberately

* **No proration**, and no refunds — there is no refund path to honour one with.
* **No per-school pricing.** A negotiated rate is a new plan code.
* **No trials.** `Subscription.Status.TRIALING` exists in the schema and nothing
  creates one; the free tier is the trial.
* **No currency but INR.**
