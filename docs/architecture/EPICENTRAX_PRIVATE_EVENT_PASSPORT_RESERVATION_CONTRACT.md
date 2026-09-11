# EpicentraX Private Event Passport Reservation Contract

## Status

Accepted product and architecture contract. It records Pap's approved Passport
rules and the first-provider decision; it does not itself authorize payment
integration, money movement, launch, refunds, renewal, invitations, or guest
access implementation.

## Purpose

A private Event Passport preserves a paid pre-launch Event and permits its
canonical organizer to begin another private Event. Passport entitlement is an
EpicentraX concern, not an Event operational-lifecycle concern and not a
payment-provider concern.

## Product rules

- The initial Passport price is **USD $24.00 per Event**.
- An unpaid unfinished private Event consumes the organizer's one-unpaid-event
  slot.
- A checkout that is merely pending still consumes that slot. It grants no
  entitlement.
- Confirmed payment creates a **reserved** Passport: the Event remains private,
  Draft, inactive, and pre-launch, but no longer consumes the one-unpaid-event
  slot.
- The 12-month active period begins only when the Event is successfully
  launched, never when payment is initiated or confirmed.
- There is no automatic renewal.
- A reserved or active Passport Event is not eligible for the ordinary
  unfinished-Event Delete or Replace commands. Cancellation/refund is a later,
  governed workflow; it must not be inferred from the ordinary deletion path.
- A live provider checkout must be cancelled or expired through a governed
  server path before its pending Event can be deleted or replaced. If the
  provider reports that payment completed during that request, the Event is
  preserved rather than deleted.

## Independent entitlement model

Passport state must be represented by a small, independent Event-entitlement
record. It must not reuse or derive commercial access from `events.status`,
`events.is_active`, `events.visible_to_members`, or the date-driven operational
`events.lifecycle_state` model.

The future model must distinguish at least:

| State | Meaning | Counts against unpaid slot |
| --- | --- | --- |
| no Passport record | ordinary unpaid unfinished draft | Yes |
| payment pending | checkout initiated, provider not confirmed | Yes |
| reserved | payment confirmed, pre-launch | No |
| active | launched; 12-month period running | No |
| expired | future non-renewed historical entitlement | No |

The authoritative entitlement record owns the paid-confirmation timestamp,
launch-start timestamp, and active-period end timestamp. Provider identifiers
are references only, never the source of authorization truth.

## Provider boundary

**Stripe Checkout** is the first payment provider. The implementation must keep
the provider behind a narrow adapter so a later provider change affects future
checkout creation and webhook normalization, not existing Passport truth,
receipt history, or entitlement decisions.

- Browser code may request checkout initiation and read its own Passport state.
- Browser redirects, query parameters, or client-side “success” signals never
  mark an Event paid.
- Only a server endpoint that verifies the Stripe webhook signature may confirm
  payment and transition a Passport to `reserved`.
- Webhook processing must be idempotent on Stripe's provider event identifier
  and record an immutable EpicentraX receipt/audit fact before entitlement is
  granted.
- Stripe secrets remain server-only and never enter a client bundle.
- Only one open provider Checkout Session may exist for an Event at a time.
  A later attempt is permitted only after the prior session is durably recorded
  as expired or cancelled; abandoned attempt evidence is retained.

Stripe's provider receipt is sufficient for the first release. Tax calculation,
tax collection, and accounting treatment are deferred pending Pap's accountant
advice; deferral does not remove any legal obligation that may apply.

## Delivery sequence

1. **Entitlement state model:** independent Passport records, governed capacity
   and Delete/Replace eligibility changes, audit/idempotency proof; no external
   payment call and no money movement.
2. **Stripe checkout and webhook:** server-side Checkout-session creation,
   signature-verified idempotent webhook confirmation, receipt/audit; no
   browser-confirmed payment state.
3. **Launch:** separately governed launch action changes `reserved` to `active`
   and starts the 12-month clock.
4. **Cancellation, refund, renewal, and expiry:** separately designed governed
   lifecycle work. No automatic renewal.

The detailed, approved Checkout / webhook / cancellation design is recorded in
[the Stripe Passport Checkout Implementation Specification](EPICENTRAX_STRIPE_PASSPORT_CHECKOUT_IMPLEMENTATION_SPECIFICATION.md).

## Explicitly out of scope

This contract does not authorize a payment-provider account change, secrets,
Checkout integration, webhooks, refunds, tax automation, launch, invitations,
guest access, storage changes, or any contribution from private Events to shared
catalogs.
