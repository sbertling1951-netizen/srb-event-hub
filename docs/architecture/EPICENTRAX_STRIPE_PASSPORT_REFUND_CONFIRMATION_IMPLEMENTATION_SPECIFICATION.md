# EpicentraX Stripe Passport Refund Confirmation Implementation Specification

**Status:** Accepted — Pap approved 2026-09-13

**Date:** 2026-09-13

## 1. Purpose and scope

This document defines the smallest governed completion path for a Passport
refund request that already exists under the accepted Private Event Passport
Reservation Contract. It is limited to the current first-release policy:

- a Platform Super-Admin initiates the request;
- only one reserved, pre-launch Passport with one verified USD $24.00 receipt
  is eligible;
- only a full USD $24.00 Stripe test-mode refund is supported; and
- a verified refund returns that Event to the ordinary unpaid Delete/Replace
  cycle while preserving payment and refund evidence.

It does not authorize live Stripe credentials, a browser refund UI, partial
refunds, chargeback handling, renewal, launch, invitations, receipt display,
or any general administrative discovery surface.

## 2. Governing invariants

The independent `self_service_event_passports` record remains the sole
entitlement truth. Stripe is provider evidence only; a successful browser
response, a Stripe object identifier, or a server-route response cannot itself
change Passport state.

The existing `self_service_event_passport_refund_requests` row is an
idempotent, auditable intent. It is not a refund, a receipt, or permission to
write Passport state directly. The immutable
`self_service_event_passport_refund_audit` row remains the one durable fact
that a full refund was verified.

## 3. Exact server flow

```text
Authorized Super-Admin creates the existing request
  -> trusted server refund boundary reads that exact request service-only
  -> Stripe Checkout Session is retrieved from the original immutable receipt
  -> server verifies the original paid Passport payment facts
  -> server asks Stripe for one full test-mode refund with request-based idempotency
  -> Stripe delivers a signed refund webhook
  -> server retrieves and verifies the Refund object
  -> service-only database command writes immutable refund evidence first
  -> the same transaction changes Passport reserved -> refunded
```

The route must never trust a browser-supplied Event id, receipt id, amount,
currency, PaymentIntent id, Refund id, or entitlement state. The opaque refund
request id is the only caller input; all other facts come from the governed
request/receipt records and Stripe's server API.

## 4. Provider operation

The server retrieves the Checkout Session named by the immutable original
receipt and proves that it is the same one-time, paid Passport payment:

- `mode='payment'`, `payment_status='paid'`, USD, and total 2400;
- exactly the configured Passport Price at quantity one;
- its PaymentIntent is present and is the only Stripe payment target; and
- the receipt's Session id, request's receipt id, and event remain the exact
  governed chain already established at payment confirmation.

It then creates a Stripe Refund against that PaymentIntent with no caller
supplied amount, `reason='requested_by_customer'`, metadata carrying only the
opaque EpicentraX refund-request id, and Stripe idempotency key
`epicentrax-passport-refund:<request-id>`. The same request retried after an
ambiguous network outcome must reuse that key. Stripe documents that a refund
must identify a Charge or PaymentIntent and that only the unrefunded amount can
be refunded; its Refund object reports the provider refund id, amount,
currency, PaymentIntent, and status. [Stripe refund API](https://docs.stripe.com/api/refunds/create)

The immediate Stripe API response is informational. Even `status='succeeded'`
does not write EpicentraX evidence or transition the Passport; only the signed
webhook path below may do that.

## 5. Webhook confirmation

The existing raw-body, signature-first Stripe webhook route is extended only
for `refund.created`, `refund.updated`, and `refund.failed`. Stripe recommends
listening to `refund.updated` for changes across refunds. [Stripe refund
events](https://docs.stripe.com/refunds?locale=en-GB)

Before any database mutation, the route must:

1. verify the raw-body signature with the server-only webhook secret;
2. retrieve the Stripe Refund by its provider id rather than trusting the
   embedded event object;
3. require the refund metadata's opaque request id and resolve exactly that
   request through a service-only reader;
4. re-retrieve the original Checkout Session and require its PaymentIntent to
   equal the Refund's PaymentIntent;
5. require provider `stripe`, amount `2400`, currency `usd`, and a full
   successful refund status; and
6. call the sole service-only confirmation command with the Stripe Refund id
   and Stripe webhook event id.

`refund.failed` records no refund evidence and never changes the Passport. It
is acknowledged after signature verification and logged server-side without
returning provider detail to a browser. The request remains retryable with the
same Stripe idempotency key unless a later accepted design adds durable failure
state and operator recovery.

## 6. Required database migration

One additive migration must add the smallest service-only completion command.
It must lock the request, original receipt, and Passport together; require the
request to be `requested`, the Passport to be `reserved`, and the exact one
receipt relationship; insert the immutable refund-audit row before changing
the Passport to `refunded`; set `refunded_at`; and advance the request to a
terminal `confirmed` state in the same transaction.

The command accepts only the request id, provider refund id, and provider event
id. It does not accept Event id, amount, currency, receipt id, Passport state,
or any browser-controlled fact. It is executable by `service_role` only;
`PUBLIC`, `anon`, and `authenticated` receive no execute grant.

Its idempotency is durable at both provider identities: replay of the same
provider event or provider refund returns the existing confirmed result without
a second audit row or state change. A different provider refund for the same
receipt fails closed through the refund-audit uniqueness invariant. Browser
roles retain no direct table access.

## 7. Authority and operator boundary

No browser route, client component, or browser table grant is in this scope.
The only user-originated action remains the existing authenticated,
Platform-Super-Admin-only request command. A trusted server boundary may
consume that request only after it verifies the caller's Platform authority and
uses the service-only request reader; a later administrator workspace, if any,
requires its own approved UI scope.

The existing production request created for the sandbox Event remains a
legitimate test fixture. This specification does not authorize consuming it
until the implementation and its sandbox proof are complete.

## 8. Required proof before any live credential or money movement

The implementation must provide structural and rollback tests for:

- Super-Admin-only request consumption and denial of ordinary users;
- reserved-only eligibility and exact receipt/Session/PaymentIntent binding;
- full USD $24.00-only provider facts and no partial-refund parameter;
- Stripe API retry using the same request-derived idempotency key;
- invalid signature, mismatched metadata, mismatched PaymentIntent, failed
  refund, and duplicate provider event all leaving Passport/audit facts intact;
- one successful signed refund writing exactly one immutable audit row,
  transitioning only the intended Passport to `refunded`, and freeing its
  ordinary Delete/Replace eligibility; and
- no browser grant, reader, writer, or direct mutation path on refund request
  or refund audit data.

Sandbox proof must use test-mode credentials and demonstrate one signed Stripe
refund confirmation against the existing test request. It must show the
request's terminal state, the immutable audit record, `refunded` Passport
state, and the returned ordinary Delete/Replace eligibility. This is still not
approval for live-mode credentials or a real-money refund.
